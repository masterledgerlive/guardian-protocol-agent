/**
 * Durable FIFO lot cost (tokensIn / ethIn / remaining) across restarts.
 *
 * Operator fills used to latch `operatorLot` / `freshLotCostEth` in memory
 * only. Railway restart dropped the lot floor before the 15-min GitHub save,
 * ledger.json is stale / missing `receivedTokens`, and #69 then HOLDs unknown
 * forever (`entrySold=0`). Always-plus cannot green a true PLUS.
 *
 * Persist lots to GitHub state + disk, and/or rebuild from buy hashes +
 * Transfer/WETH receipts. Never invent P&L — no persist and no receipt →
 * unknown (HOLD).
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import {
  fifoRemainingCostEth,
  latchFreshLot,
} from "./lose-zero-gate.js";

export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const WETH_BASE = "0x4200000000000000000000000000000000000006";
export const FIFO_LOTS_FILENAME = "fifo-lots.json";

/** Live #78 operator fills. Amounts come from receipts / persist — not invented. */
export const EVIDENCE_BUY_TXS = Object.freeze({
  AERO: "0x94faa542b54eb06804bfde79354701cd0a7fa4964cf230791bfd07fc10a22b25",
  DRB: "0xe0f846a80fe8d5c541b500e51b9cf365866cd97eb5d84a47c674100fac7da6e9",
  BNKR: "0xeef39d62453fd9b09708a5661bd8465d5f2d82cebd0986d01e466f9ac95822e4",
});

/**
 * Live #84/#85 DRB trough add-on (nonce 5456) while the bag was FIFO-red.
 * First-lot persist alone leaves chain remaining > tokensIn → unknown-lots.
 * Seed the slice the same way as the #78 fills; merge, do not replace.
 */
export const DRB_TROUGH_BUY_TX =
  "0x53a00788e4cfef87001e02855cb27aee86923e365bfe175347fbe35e753c9b26";

export const EVIDENCE_ADDON_BUY_TXS = Object.freeze({
  DRB: DRB_TROUGH_BUY_TX,
});

export function normalizeTxHash(hash) {
  const s = String(hash || "").trim().toLowerCase();
  if (!s) return "";
  const h = s.startsWith("0x") ? s : `0x${s}`;
  return /^0x[0-9a-f]{64}$/.test(h) ? h : "";
}

export function topicAddress(topic) {
  const s = String(topic || "").toLowerCase().replace(/^0x/, "");
  if (s.length < 40) return "";
  return `0x${s.slice(-40)}`;
}

export function weiToAmount(wei, decimals = 18) {
  const d = Number(decimals);
  const dec = Number.isFinite(d) && d >= 0 && d <= 36 ? Math.floor(d) : 18;
  try {
    const n = typeof wei === "bigint" ? wei : BigInt(wei);
    if (n <= 0n) return 0;
    const base = 10n ** BigInt(dec);
    const whole = n / base;
    const frac = n % base;
    return Number(whole) + Number(frac) / Number(base);
  } catch {
    return 0;
  }
}

export function emptyLot(symbol) {
  return {
    symbol: String(symbol || "").toUpperCase(),
    ethIn: 0,
    tokensIn: 0,
    fillCostEth: 0,
    remainingCostEth: 0,
    lastBuyPrice: 0,
    lastBuyEth: 0,
    lastBuyTime: 0,
    buyTxs: [],
    operatorLot: null,
    freshLotAt: 0,
    freshLotCostEth: 0,
    source: "",
    updatedAt: 0,
    cleared: false,
  };
}

/** Viem receipts use "success" / "reverted"; RPC hex uses 0x1 / 0x0. */
export function receiptSucceeded(receipt) {
  const st = receipt?.status;
  if (st === "reverted" || st === "REVERTED" || st === 0 || st === 0n || st === "0x0" || st === false) {
    return false;
  }
  return st === "success" || st === "SUCCESS"
    || st === 1 || st === 1n || st === "0x1" || st === true;
}

export function lotUpdatedAt(lot) {
  if (!lot || typeof lot !== "object") return 0;
  return Math.max(Number(lot.updatedAt) || 0, Number(lot.lastBuyTime) || 0);
}

export function isClearedLot(lot) {
  return !!(lot && lot.cleared === true && lotUpdatedAt(lot) > 0);
}

/** Apply succeeded: real FIFO ETH is on the token (USD entry is optional). */
export function lotAppliedOk(token, fifo) {
  return !!(fifo && !fifo.unknown && Number(fifo.investedEth) > 0
    && token && token.unknownEntry !== true
    && (Number(token.totalInvestedEth) > 0 || Number(token.operatorLot?.fillCostEth) > 0));
}

export function isUsableLot(lot) {
  if (!lot || typeof lot !== "object") return false;
  const eth = Number(lot.ethIn || lot.fillCostEth);
  const tok = Number(lot.tokensIn);
  return Number.isFinite(eth) && eth > 0 && Number.isFinite(tok) && tok > 0;
}

export function lotProvesCostBasis(lot) {
  return isUsableLot(lot) && (
    (Array.isArray(lot.buyTxs) && lot.buyTxs.some((b) => normalizeTxHash(b.hash)))
    || lot.source === "onchain-receipt"
    || lot.source === "persisted"
    || lot.source === "fill"
  );
}

function ensureLot(lots, symbol) {
  const map = lots && typeof lots === "object" ? lots : {};
  const key = String(symbol || "").toUpperCase();
  if (!key) return { map, lot: emptyLot(""), key };
  if (!map[key] || typeof map[key] !== "object") map[key] = emptyLot(key);
  map[key].symbol = key;
  if (!Array.isArray(map[key].buyTxs)) map[key].buyTxs = [];
  return { map, lot: map[key], key };
}

function rememberBuyTx(lot, { hash, ethIn, tokensIn, price, at, source } = {}) {
  const h = normalizeTxHash(hash);
  if (!h) return lot;
  const prev = lot.buyTxs.find((b) => normalizeTxHash(b.hash) === h);
  const row = {
    hash: h,
    ethIn: Number(ethIn) || 0,
    tokensIn: Number(tokensIn) || 0,
    price: Number(price) || 0,
    at: Number(at) || Date.now(),
    source: source || lot.source || "",
  };
  if (prev) Object.assign(prev, row);
  else lot.buyTxs.push(row);
  if (lot.buyTxs.length > 32) lot.buyTxs = lot.buyTxs.slice(-32);
  return lot;
}

/**
 * Record a real buy fill into the durable lot map.
 * `ethIn` is swap notional; `fillCostEth` is all-in (swap+gas+hitch) when known.
 */
export function recordBuyFill(lots, {
  symbol,
  ethIn = 0,
  tokensIn = 0,
  txHash = "",
  price = 0,
  reason = "",
  fillCostEth = 0,
  at = Date.now(),
  source = "fill",
} = {}) {
  const { map, lot, key } = ensureLot(lots, symbol);
  if (!key) return map;
  const tok = Number(tokensIn);
  const spent = Number(ethIn);
  const allIn = Number(fillCostEth) > 0 ? Number(fillCostEth) : spent;
  if (!(tok > 0) || !(allIn > 0) && !(spent > 0)) return map;
  if (spent > 0) lot.ethIn = (Number(lot.ethIn) || 0) + spent;
  if (allIn > 0) lot.fillCostEth = (Number(lot.fillCostEth) || 0) + allIn;
  lot.tokensIn = (Number(lot.tokensIn) || 0) + tok;
  lot.remainingCostEth = Number(lot.fillCostEth) > 0 ? lot.fillCostEth : lot.ethIn;
  if (Number(price) > 0) lot.lastBuyPrice = Number(price);
  lot.lastBuyEth = spent > 0 ? spent : allIn;
  lot.lastBuyTime = Number(at) || Date.now();
  lot.source = source;
  rememberBuyTx(lot, { hash: txHash, ethIn: spent || allIn, tokensIn: tok, price, at, source });
  latchFreshLot(lot, { fillCostEth: allIn, tokens: tok, reason, now: lot.lastBuyTime });
  lot.cleared = false;
  lot.updatedAt = lot.lastBuyTime;
  return map;
}

/** Shrink remaining FIFO after a real sell. Sold-all clears the lot. */
export function recordSellFill(lots, {
  symbol,
  tokensSold = 0,
  remainingTokens = null,
  soldFrac = null,
} = {}) {
  const { map, lot, key } = ensureLot(lots, symbol);
  if (!key || !isUsableLot(lot)) return map;
  const bought = Number(lot.tokensIn);
  let remain;
  if (Number.isFinite(Number(remainingTokens)) && Number(remainingTokens) >= 0) {
    remain = Number(remainingTokens);
  } else if (Number.isFinite(Number(soldFrac)) && Number(soldFrac) > 0) {
    remain = bought * Math.max(0, 1 - Number(soldFrac));
  } else {
    remain = bought - (Number(tokensSold) || 0);
  }
  if (!(remain > 1e-12)) {
    map[key] = { ...emptyLot(key), cleared: true, updatedAt: Date.now() };
    return map;
  }
  const fifo = fifoRemainingCostEth({
    ethIn: Number(lot.fillCostEth) > 0 ? lot.fillCostEth : lot.ethIn,
    tokensIn: bought,
    remainingTokens: remain,
    // Sized lot: remaining is proportional. Do not floor on the pre-sell
    // remainingCostEth (that would refuse to shrink after a real fill).
    persistedInvestedEth: 0,
  });
  if (fifo.unknown || !(fifo.investedEth > 0)) {
    map[key] = emptyLot(key);
    return map;
  }
  const frac = Math.min(1, remain / bought);
  lot.tokensIn = remain;
  lot.ethIn = (Number(lot.ethIn) || 0) * frac;
  lot.fillCostEth = (Number(lot.fillCostEth) || 0) * frac;
  lot.remainingCostEth = fifo.investedEth;
  if (lot.operatorLot && Number(lot.operatorLot.fillCostEth) > 0) {
    lot.operatorLot = {
      ...lot.operatorLot,
      fillCostEth: fifo.investedEth,
      tokens: remain,
    };
  }
  if (Number(lot.freshLotCostEth) > 0) lot.freshLotCostEth = fifo.investedEth;
  lot.cleared = false;
  lot.updatedAt = Date.now();
  return map;
}

export function serializeFifoLots(lots) {
  const map = lots && typeof lots === "object" ? lots : {};
  const out = {};
  for (const [sym, lot] of Object.entries(map)) {
    if (!lot || typeof lot !== "object") continue;
    if (isClearedLot(lot)) {
      out[String(sym).toUpperCase()] = {
        symbol: String(sym).toUpperCase(),
        cleared: true,
        updatedAt: lotUpdatedAt(lot),
        source: lot.source || "cleared",
      };
      continue;
    }
    if (!isUsableLot(lot)) continue;
    out[String(sym).toUpperCase()] = {
      symbol: String(sym).toUpperCase(),
      ethIn: Number(lot.ethIn) || 0,
      tokensIn: Number(lot.tokensIn) || 0,
      fillCostEth: Number(lot.fillCostEth) || 0,
      remainingCostEth: Number(lot.remainingCostEth) || 0,
      lastBuyPrice: Number(lot.lastBuyPrice) || 0,
      lastBuyEth: Number(lot.lastBuyEth) || 0,
      lastBuyTime: Number(lot.lastBuyTime) || 0,
      updatedAt: lotUpdatedAt(lot),
      cleared: false,
      buyTxs: (Array.isArray(lot.buyTxs) ? lot.buyTxs : [])
        .map((b) => ({
          hash: normalizeTxHash(b.hash),
          ethIn: Number(b.ethIn) || 0,
          tokensIn: Number(b.tokensIn) || 0,
          price: Number(b.price) || 0,
          at: Number(b.at) || 0,
          source: String(b.source || ""),
        }))
        .filter((b) => b.hash),
      operatorLot: lot.operatorLot && Number(lot.operatorLot.fillCostEth) > 0
        ? {
          fillCostEth: Number(lot.operatorLot.fillCostEth),
          tokens: Number(lot.operatorLot.tokens) || 0,
          at: Number(lot.operatorLot.at) || 0,
        }
        : null,
      freshLotAt: Number(lot.freshLotAt) || 0,
      freshLotCostEth: Number(lot.freshLotCostEth) || 0,
      source: lot.source || "persisted",
    };
  }
  return { lastSaved: new Date().toISOString(), lots: out };
}

export function deserializeFifoLots(blob) {
  const lots = {};
  const src = blob && typeof blob === "object"
    ? (blob.lots && typeof blob.lots === "object" ? blob.lots : blob)
    : {};
  for (const [sym, row] of Object.entries(src)) {
    if (!row || typeof row !== "object") continue;
    if (sym === "lastSaved" || sym === "lots") continue;
    const lot = {
      ...emptyLot(sym),
      ...row,
      symbol: String(row.symbol || sym).toUpperCase(),
      buyTxs: Array.isArray(row.buyTxs) ? row.buyTxs.filter((b) => normalizeTxHash(b?.hash)) : [],
      source: row.source || "persisted",
      updatedAt: lotUpdatedAt(row),
      cleared: !!row.cleared,
    };
    if (isClearedLot(lot) || isUsableLot(lot)) lots[lot.symbol] = lot;
  }
  return lots;
}

export function mergeLotMaps(...maps) {
  const out = {};
  for (const map of maps) {
    if (!map || typeof map !== "object") continue;
    for (const [sym, lot] of Object.entries(map)) {
      const key = String(sym).toUpperCase();
      if (!key || (!isUsableLot(lot) && !isClearedLot(lot))) continue;
      const prev = out[key];
      const t = lotUpdatedAt(lot);
      const prevT = lotUpdatedAt(prev);
      if (prev && t < prevT) {
        if (isUsableLot(lot) && prev.buyTxs && lot.buyTxs?.length) {
          for (const b of lot.buyTxs) rememberBuyTx(prev, b);
        }
        continue;
      }
      if (isClearedLot(lot)) {
        out[key] = { ...emptyLot(key), cleared: true, updatedAt: t, source: lot.source || "cleared" };
        continue;
      }
      out[key] = { ...emptyLot(key), ...lot, symbol: key, cleared: false, updatedAt: t };
      if (prev?.buyTxs?.length && !isClearedLot(prev)) {
        for (const b of prev.buyTxs) rememberBuyTx(out[key], b);
      }
    }
  }
  return out;
}

export function applyLotToNet(netPositions, lot) {
  const nets = netPositions && typeof netPositions === "object" ? netPositions : {};
  if (!isUsableLot(lot)) return nets;
  const key = String(lot.symbol || "").toUpperCase();
  if (!key) return nets;
  nets[key] = {
    ethIn: Number(lot.ethIn) > 0 ? Number(lot.ethIn) : Number(lot.fillCostEth) || 0,
    ethOut: Number(nets[key]?.ethOut) || 0,
    tokensIn: Number(lot.tokensIn) || 0,
    lastBuyPrice: Number(lot.lastBuyPrice) || Number(nets[key]?.lastBuyPrice) || 0,
    lastBuyEth: Number(lot.lastBuyEth) || Number(lot.ethIn) || 0,
    lastBuyTime: Number(lot.lastBuyTime) || Date.now(),
  };
  return nets;
}

export function applyLotToToken(token, lot, { remainingTokens } = {}) {
  if (!token || !isUsableLot(lot)) {
    return { unknown: true, investedEth: 0, reason: "unknown-cost" };
  }
  const remain = Number.isFinite(Number(remainingTokens)) && Number(remainingTokens) > 0
    ? Number(remainingTokens)
    : Number(lot.tokensIn);
  const ethIn = Number(lot.fillCostEth) > 0 ? Number(lot.fillCostEth) : Number(lot.ethIn);
  const bought = Number(lot.tokensIn);
  // Sized leftover (chain < recorded buy): proportional only. Flooring on
  // remainingCostEth (the full fill) HOLDs a true PLUS on leftover bags.
  const leftover = Number.isFinite(Number(remainingTokens)) && Number(remainingTokens) > 0
    && remain < bought * 0.98;
  const fifo = fifoRemainingCostEth({
    ethIn,
    tokensIn: bought,
    remainingTokens: remain,
    persistedInvestedEth: leftover ? 0 : (Number(lot.remainingCostEth) || 0),
  });
  if (fifo.unknown || !(fifo.investedEth > 0)) {
    return fifo;
  }
  const hadTrustedPx = token.unknownEntry !== true && Number(token.entryPrice) > 0;
  token.totalInvestedEth = fifo.investedEth;
  token.unknownEntry = false;
  if (Number(lot.lastBuyPrice) > 0) token.entryPrice = Number(lot.lastBuyPrice);
  else if (!hadTrustedPx) token.entryPrice = token.entryPrice || null;
  if (Number(lot.lastBuyTime) > 0) token.entryTime = Number(lot.lastBuyTime);
  if (lot.operatorLot && Number(lot.operatorLot.fillCostEth) > 0) {
    token.operatorLot = { ...lot.operatorLot, fillCostEth: fifo.investedEth };
  }
  if (Number(lot.freshLotCostEth) > 0) {
    token.freshLotCostEth = fifo.investedEth;
    token.freshLotAt = Number(lot.freshLotAt) || Date.now();
  }
  return fifo;
}

/**
 * Desk / boot "known cost" without inventing a USD entryPrice.
 * Proven FIFO ETH (`tokensIn`/`ethIn` applied) is enough. #80 lotAppliedOk
 * is the apply-site check; this is the summary / unknown-basis filter.
 */
export function tokenHasKnownFifoCost(token, lot) {
  if (!token || token.unknownEntry === true) return false;
  const eth = Number(token.totalInvestedEth) || Number(token.operatorLot?.fillCostEth) || 0;
  if (!(eth > 0)) return false;
  return isUsableLot(lot) || lotProvesCostBasis(lot);
}

export function bootKnownCostLabel(token) {
  const px = Number(token?.entryPrice);
  if (Number.isFinite(px) && px > 0) return `${token.symbol}@$${px.toFixed(6)}`;
  const eth = Number(token?.totalInvestedEth);
  if (Number.isFinite(eth) && eth > 0) return `${token.symbol}@${eth.toFixed(6)}ETH`;
  return String(token?.symbol || "?");
}

/** Sized remaining for receipt rebuild. Null = skip (no cache / dust / sold-all). */
export function seededRebuildRemaining(bal) {
  const n = Number(bal);
  if (!Number.isFinite(n) || n <= 0.001) return null;
  return n;
}

export function seedNetPositionsFromFifoLots(netPositions, lots) {
  const nets = netPositions && typeof netPositions === "object" ? netPositions : {};
  const map = lots && typeof lots === "object" ? lots : {};
  for (const lot of Object.values(map)) applyLotToNet(nets, lot);
  return nets;
}

export function parseLotRebuildTxsEnv(env = process.env) {
  const raw = String(env?.LOT_REBUILD_TXS ?? env?.FIFO_LOT_TXS ?? "").trim();
  if (!raw) return {};
  const out = {};
  for (const part of raw.split(/[,;\s]+/)) {
    if (!part) continue;
    const colon = part.indexOf(":");
    if (colon < 1) continue;
    const sym = part.slice(0, colon).trim().toUpperCase();
    const hash = normalizeTxHash(part.slice(colon + 1));
    if (!sym || !hash) continue;
    if (!out[sym]) out[sym] = [];
    if (!out[sym].includes(hash)) out[sym].push(hash);
  }
  return out;
}

export function lotHasBuyTx(lot, hash) {
  const h = normalizeTxHash(hash);
  if (!h || !lot) return false;
  return (Array.isArray(lot.buyTxs) ? lot.buyTxs : [])
    .some((b) => normalizeTxHash(b.hash) === h);
}

export function lotHasAnyBuyTx(lot) {
  return (Array.isArray(lot?.buyTxs) ? lot.buyTxs : [])
    .some((b) => normalizeTxHash(b.hash));
}

function evidenceHashForSymbol(map, symbol) {
  const key = String(symbol || "").toUpperCase();
  const val = map && typeof map === "object" ? map[key] : null;
  if (Array.isArray(val)) return val.map((h) => normalizeTxHash(h)).filter(Boolean);
  const h = normalizeTxHash(val);
  return h ? [h] : [];
}

export function isSeededAddonBuyTx(symbol, hash, extras = EVIDENCE_ADDON_BUY_TXS) {
  const h = normalizeTxHash(hash);
  return !!h && evidenceHashForSymbol(extras, symbol).includes(h);
}

/**
 * Latch a receipt onto persist only when it belongs to this cycle.
 * Empty / unusable → seed (same as #79). Sold-all `cleared` tombstone is
 * not an empty seed. Already-usable → merge seeded add-ons onto the same
 * first lot only. Never rematerialize #78 first fills onto a later bag.
 */
export function shouldLatchBuyReceipt(existing, hash, {
  remainingTokens,
  evidence = EVIDENCE_BUY_TXS,
  extras = EVIDENCE_ADDON_BUY_TXS,
} = {}) {
  const h = normalizeTxHash(hash);
  if (!h) return false;
  if (lotHasBuyTx(existing, h)) return false;
  if (isClearedLot(existing)) return false;
  if (!isUsableLot(existing)) return true;
  const key = String(existing.symbol || "").toUpperCase();
  if (!isSeededAddonBuyTx(key, h, extras)) return false;
  const parent = evidenceHashForSymbol(evidence, key)[0];
  if (parent && lotHasBuyTx(existing, parent)) return true;
  if (lotHasAnyBuyTx(existing)) return false;
  const remain = Number(remainingTokens);
  const bought = Number(existing.tokensIn);
  return Number.isFinite(remain) && bought > 0 && remain > bought * 1.02;
}

/** String or array of hashes per symbol (evidence + trough add-ons). */
export function addEvidenceHashes(add, evidence) {
  if (typeof add !== "function" || !evidence || typeof evidence !== "object") return;
  for (const [sym, val] of Object.entries(evidence)) {
    if (Array.isArray(val)) {
      for (const h of val) add(sym, h);
    } else {
      add(sym, val);
    }
  }
}

/**
 * Merge a receipt-built lot onto persist. Skip if that buy hash is already
 * latched. An already-usable first lot must still accept the add-on slice
 * (DRB 0x53a00788 onto 0xe0f846a8) — do not replace or invent.
 */
export function mergeBuyReceiptIntoLots(lots, receiptLot, {
  remainingTokens,
  evidence = EVIDENCE_BUY_TXS,
  extras = EVIDENCE_ADDON_BUY_TXS,
} = {}) {
  const map = lots && typeof lots === "object" ? lots : {};
  if (!isUsableLot(receiptLot)) return map;
  const key = String(receiptLot.symbol || "").toUpperCase();
  const hash = normalizeTxHash(
    (Array.isArray(receiptLot.buyTxs) ? receiptLot.buyTxs : [])
      .map((b) => b.hash)
      .find((h) => normalizeTxHash(h)),
  );
  if (!key || !hash) return map;
  if (!shouldLatchBuyReceipt(map[key], hash, { remainingTokens, evidence, extras })) return map;
  if (isUsableLot(map[key])) {
    recordBuyFill(map, {
      symbol: key,
      ethIn: Number(receiptLot.ethIn) || 0,
      tokensIn: Number(receiptLot.tokensIn) || 0,
      txHash: hash,
      price: Number(receiptLot.lastBuyPrice) || 0,
      fillCostEth: Number(receiptLot.fillCostEth) || Number(receiptLot.ethIn) || 0,
      at: Number(receiptLot.lastBuyTime) || Date.now(),
      source: receiptLot.source || "onchain-receipt",
    });
    return map;
  }
  map[key] = receiptLot;
  return map;
}

export function collectRebuildTxs({
  persistedLots,
  ledgerTrades,
  env,
  evidence = EVIDENCE_BUY_TXS,
  extras = EVIDENCE_ADDON_BUY_TXS,
} = {}) {
  const out = {};
  const add = (symbol, hash) => {
    const key = String(symbol || "").toUpperCase();
    const h = normalizeTxHash(hash);
    if (!key || !h) return;
    if (!out[key]) out[key] = [];
    if (!out[key].includes(h)) out[key].push(h);
  };
  addEvidenceHashes(add, evidence);
  addEvidenceHashes(add, extras);
  for (const [sym, hashes] of Object.entries(parseLotRebuildTxsEnv(env))) {
    for (const h of hashes) add(sym, h);
  }
  const persisted = persistedLots && typeof persistedLots === "object" ? persistedLots : {};
  for (const [sym, lot] of Object.entries(persisted)) {
    for (const b of lot?.buyTxs || []) add(sym, b.hash);
  }
  if (Array.isArray(ledgerTrades)) {
    for (const t of ledgerTrades) {
      if (!t || String(t.type || "").toUpperCase() !== "BUY") continue;
      add(t.symbol, t.tx || t.hash);
    }
  }
  return out;
}

/**
 * Rebuild one lot from a successful buy receipt (Transfer to wallet + WETH/ETH in).
 * Returns null when logs cannot prove both legs — do not invent.
 */
export function lotFromBuyReceipt({
  symbol,
  tokenAddress,
  wallet,
  txHash,
  receipt,
  tx,
  tokenDecimals = 18,
  price = 0,
  reason = "",
} = {}) {
  const key = String(symbol || "").toUpperCase();
  const token = String(tokenAddress || "").toLowerCase();
  const to = String(wallet || "").toLowerCase();
  const hash = normalizeTxHash(txHash || receipt?.transactionHash || tx?.hash);
  if (!key || !token || !to || !hash || !receipt) return null;
  if (!receiptSucceeded(receipt)) return null;

  let tokenWei = 0n;
  let wethWei = 0n;
  for (const log of receipt.logs || []) {
    const topics = log?.topics || [];
    if (!topics.length) continue;
    if (String(topics[0] || "").toLowerCase() !== TRANSFER_TOPIC) continue;
    if (topics.length < 3) continue;
    const addr = String(log.address || "").toLowerCase();
    const frm = topicAddress(topics[1]);
    const dest = topicAddress(topics[2]);
    let amt = 0n;
    try { amt = BigInt(log.data || "0x0"); } catch { continue; }
    if (amt <= 0n) continue;
    if (addr === token && dest === to) tokenWei += amt;
    if (addr === WETH_BASE && frm === to) wethWei += amt;
  }
  let ethValue = 0n;
  try { ethValue = BigInt(tx?.value || receipt?.value || 0); } catch { ethValue = 0n; }
  const tokensIn = weiToAmount(tokenWei, tokenDecimals);
  const ethIn = weiToAmount(wethWei + ethValue, 18);
  if (!(tokensIn > 0) || !(ethIn > 0)) return null;

  let gasCostEth = 0;
  try {
    const gasUsed = BigInt(receipt.gasUsed || 0);
    const gasPrice = BigInt(receipt.effectiveGasPrice || tx?.gasPrice || 0);
    gasCostEth = weiToAmount(gasUsed * gasPrice, 18);
  } catch { gasCostEth = 0; }

  const lots = {};
  recordBuyFill(lots, {
    symbol: key,
    ethIn,
    tokensIn,
    txHash: hash,
    price,
    reason,
    fillCostEth: ethIn + (gasCostEth > 0 ? gasCostEth : 0),
    at: Date.now(),
    source: "onchain-receipt",
  });
  return lots[key] || null;
}

/** Ledger BUY rows without receivedTokens must not poison tokensIn. */
export function ledgerBuyHasLotSizes(trade) {
  if (!trade || String(trade.type || "").toUpperCase() !== "BUY") return false;
  const tok = Number(trade.receivedTokens || trade.tokensReceived || 0);
  const eth = Number(trade.ethSpent || trade.ethIn || 0);
  return Number.isFinite(tok) && tok > 0 && Number.isFinite(eth) && eth > 0;
}

export function mergeLedgerBuysIntoLots(lots, trades) {
  const map = lots && typeof lots === "object" ? lots : {};
  if (!Array.isArray(trades)) return map;
  for (const t of trades) {
    if (!ledgerBuyHasLotSizes(t)) continue;
    recordBuyFill(map, {
      symbol: t.symbol,
      ethIn: Number(t.ethSpent || t.ethIn),
      tokensIn: Number(t.receivedTokens || t.tokensReceived),
      txHash: t.tx || t.hash,
      price: Number(t.price) || 0,
      reason: t.reason || "",
      fillCostEth: Number(t.ethSpent || t.ethIn),
      at: new Date(t.timestamp || 0).getTime() || Date.now(),
      source: "ledger",
    });
  }
  return map;
}

/**
 * GitHub ledger / fifo-lots / positions 401 (or unreadable): ignore remote
 * trades and rebuild from disk persist + seeded buy-hash receipts only.
 * Do not invent P&L — missing persist and missing receipt → unknown.
 */
export function recoverLotsAfterGithubReadFailure({
  persisted = {},
  receipts = [],
  remainingBySymbol = {},
  tokens = [],
} = {}) {
  return rebuildLotsAfterRestart({
    persisted,
    ledgerTrades: [],
    receipts,
    remainingBySymbol,
    tokens,
  });
}

/**
 * After a simulated / real restart: rebuild lots from persist, then receipts.
 * Missing both → unknown (do not invent).
 */
export function rebuildLotsAfterRestart({
  persisted,
  receipts = [],
  ledgerTrades,
  remainingBySymbol = {},
  tokens = [],
} = {}) {
  let lots = deserializeFifoLots(persisted);
  lots = mergeLedgerBuysIntoLots(lots, ledgerTrades);

  const catalog = new Map(
    (Array.isArray(tokens) ? tokens : []).map((t) => [String(t.symbol || "").toUpperCase(), t]),
  );
  for (const row of receipts) {
    if (!row) continue;
    const sym = String(row.symbol || "").toUpperCase();
    const token = catalog.get(sym) || {};
    const rebuilt = lotFromBuyReceipt({
      symbol: sym,
      tokenAddress: row.tokenAddress || token.address,
      wallet: row.wallet,
      txHash: row.txHash || row.hash,
      receipt: row.receipt,
      tx: row.tx,
      tokenDecimals: row.tokenDecimals ?? token.decimals ?? 18,
      price: row.price || 0,
      reason: row.reason || "MANUAL BUY (operator)",
    });
    if (isUsableLot(rebuilt)) {
      const remain = Number(remainingBySymbol?.[sym]);
      mergeBuyReceiptIntoLots(lots, rebuilt, {
        remainingTokens: Number.isFinite(remain) && remain > 0 ? remain : undefined,
      });
    }
  }

  const applied = {};
  const unknown = [];
  const rebuilt = [];
  const symbols = new Set([
    ...Object.keys(lots),
    ...Object.keys(remainingBySymbol || {}),
  ]);
  for (const sym of symbols) {
    const remain = Number(remainingBySymbol?.[sym]);
    if (Number.isFinite(remain) && remain > 0 && !isUsableLot(lots[sym])) {
      unknown.push(sym);
      continue;
    }
    if (!isUsableLot(lots[sym])) continue;
    const token = { symbol: sym };
    const fifo = applyLotToToken(token, lots[sym], {
      remainingTokens: Number.isFinite(remain) && remain > 0 ? remain : undefined,
    });
    if (fifo.unknown) unknown.push(sym);
    else {
      applied[sym] = token;
      rebuilt.push(sym);
    }
  }
  return { lots, applied, rebuilt, unknown };
}

export function writeFifoLotsSync(filePath, lots) {
  const path = String(filePath || FIFO_LOTS_FILENAME);
  const dir = dirname(path);
  if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(serializeFifoLots(lots), null, 2);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
  return path;
}

export function readFifoLotsSync(filePath) {
  const path = String(filePath || FIFO_LOTS_FILENAME);
  try {
    const raw = readFileSync(path, "utf8");
    return deserializeFifoLots(JSON.parse(raw));
  } catch {
    return {};
  }
}
