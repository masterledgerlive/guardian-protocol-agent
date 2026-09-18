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
  fifoKnownLotRemain,
  fifoUnknownLots,
  latchFreshLot,
} from "./lose-zero-gate.js";

export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** WETH `Deposit(address indexed dst, uint256 wad)` — native ETH wrap on SwapRouter02. */
export const WETH_DEPOSIT_TOPIC =
  "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";
export const WETH_BASE = "0x4200000000000000000000000000000000000006";
export const SWAP_ROUTER02_BASE = "0x2626664c2603336e57b271c5c0b26f421741e481";
export const FIFO_LOTS_FILENAME = "fifo-lots.json";

/** Live operator fills. Amounts come from receipts / persist — not invented. */
export const EVIDENCE_BUY_TXS = Object.freeze({
  AERO: "0x94faa542b54eb06804bfde79354701cd0a7fa4964cf230791bfd07fc10a22b25",
  DRB: "0xe0f846a80fe8d5c541b500e51b9cf365866cd97eb5d84a47c674100fac7da6e9",
  BNKR: "0xeef39d62453fd9b09708a5661bd8465d5f2d82cebd0986d01e466f9ac95822e4",
  // Risk-desk VIRTUAL buy on Base. Size is on the receipt (~1.642 VIRTUAL /
  // 0.000407 ETH) — do not invent P&L here; rebuild from the hash.
  VIRTUAL: "0x33aac6524333e37244e12f21454c2aa485a227450272b4c9bdb7aa792cf85879",
  // Risk-desk CLANKER buys on Base (nonce 6009 then 6010). WETH from wallet
  // → CLANKER via SwapRouter02. Sizes on the receipts (~0.17630 + ~0.11289).
  // First fill alone vs rem ~0.289 is unknown-lots. Array sibling +
  // EVIDENCE_ADDON_BUY_TXS.CLANKER both merge the second hash — env-only
  // LOT_REBUILD_TXS cannot (remain>bought*1.02 is unreachable on a usable
  // first lot). Do not invent P&L; rebuild from the hashes.
  CLANKER: Object.freeze([
    "0x23d8a0c5feaf55154abce99f2a395cc23fac26557170acc7b220b83dcf59a87b",
    "0xcb7dd5a6d9d7ea83f5f42e2e640795fa707c3987e959c57c68a7048ab42415f5",
  ]),
});

/**
 * Live #84/#85 DRB trough add-on (nonce 5456) while the bag was FIFO-red.
 * First-lot persist alone leaves chain remaining > tokensIn → unknown-lots.
 * Seed the slice the same way as the #78 fills; merge, do not replace.
 */
export const DRB_TROUGH_BUY_TX =
  "0x53a00788e4cfef87001e02855cb27aee86923e365bfe175347fbe35e753c9b26";

/** CLANKER second fill (nonce 6010, ~0.11289) — merge onto 0x23d8a0c5 like DRB trough. */
export const CLANKER_ADDON_BUY_TX =
  "0xcb7dd5a6d9d7ea83f5f42e2e640795fa707c3987e959c57c68a7048ab42415f5";

export const EVIDENCE_ADDON_BUY_TXS = Object.freeze({
  DRB: DRB_TROUGH_BUY_TX,
  CLANKER: CLANKER_ADDON_BUY_TX,
});

/**
 * Sealed sells auto-append when executeSell / rebuild sees a hash.
 * VIRTUAL desk fill 0x88105ec16606a924c2fe0e0dd6987f4fffa2639a9c183a5da06fbaf79049d1b8
 * is already sealed — persist + ledger receipt rebuild latch it. Do not
 * hardcode-invent amounts or a guessed hash here.
 */
export const EVIDENCE_SELL_TXS = Object.freeze({});

/** WETH `Withdrawal(address indexed src, uint256 wad)` — unwrap after a sell. */
export const WETH_WITHDRAWAL_TOPIC =
  "0x7fcf532c15f0a6db0bd6d0e0088b166e04771d92f256669314c0176a120b3d";

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
    sellTxs: [],
    originalTokensIn: 0,
    piggyDustTokens: 0,
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
  if (!Array.isArray(map[key].sellTxs)) map[key].sellTxs = [];
  if (!(Number(map[key].originalTokensIn) > 0)) map[key].originalTokensIn = 0;
  if (!(Number(map[key].piggyDustTokens) > 0)) map[key].piggyDustTokens = Number(map[key].piggyDustTokens) || 0;
  return { map, lot: map[key], key };
}

/** Original known-lot size (buy fills). Survives partial shrink of tokensIn. */
export function lotOriginalTokensIn(lot) {
  const fromBuys = (Array.isArray(lot?.buyTxs) ? lot.buyTxs : [])
    .reduce((s, b) => s + (Number(b.tokensIn) || 0), 0);
  if (fromBuys > 0) return fromBuys;
  const stored = Number(lot?.originalTokensIn);
  if (stored > 0) return stored;
  return Number(lot?.tokensIn) || 0;
}

/** Latch pre-buy dust as a zero-cost piggy that never blocks known-lot sells. */
export function latchPiggyDust(lot, remainingTokens) {
  if (!lot || typeof lot !== "object") return lot;
  const remain = Number(remainingTokens);
  const known = Number(lot.tokensIn);
  if (!(remain > known) || !(known > 0)) return lot;
  const extra = remain - known;
  const original = lotOriginalTokensIn(lot);
  const evidenceLot = lotIsEvidenceLatched(lot);
  if (fifoUnknownLots({
    remainingTokens: remain,
    tokensIn: known,
    evidenceLot,
    originalTokensIn: original,
    piggyDustTokens: lot.piggyDustTokens,
  })) {
    return lot;
  }
  lot.piggyDustTokens = Math.max(Number(lot.piggyDustTokens) || 0, extra);
  return lot;
}

function rememberBuyTx(lot, { hash, ethIn, tokensIn, price, at, source } = {}) {
  const h = normalizeTxHash(hash);
  if (!h) return lot;
  if (!Array.isArray(lot.buyTxs)) lot.buyTxs = [];
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

function rememberSellTx(lot, { hash, tokensSold, ethOut, at, source } = {}) {
  const h = normalizeTxHash(hash);
  if (!h) return lot;
  if (!Array.isArray(lot.sellTxs)) lot.sellTxs = [];
  const prev = lot.sellTxs.find((b) => normalizeTxHash(b.hash) === h);
  const row = {
    hash: h,
    tokensSold: Number(tokensSold) || 0,
    ethOut: Number(ethOut) || 0,
    at: Number(at) || Date.now(),
    source: source || lot.source || "fill",
  };
  if (prev) Object.assign(prev, row);
  else lot.sellTxs.push(row);
  if (lot.sellTxs.length > 32) lot.sellTxs = lot.sellTxs.slice(-32);
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
  lot.originalTokensIn = (Number(lot.originalTokensIn) || 0) + tok;
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

/**
 * Shrink remaining FIFO after a real sell of the *known-lot* slice.
 * Remaining cost = entry × knownRemain / knownBefore. Pre-buy dust piggy
 * stays separate (unknown/zero cost) and never wipes the known rem lot.
 * Sold-all known lot clears cost; dust piggy may remain on-chain.
 */
export function recordSellFill(lots, {
  symbol,
  tokensSold = 0,
  remainingTokens = null,
  soldFrac = null,
  txHash = "",
  ethOut = 0,
  piggyDustTokens = null,
  at = Date.now(),
  source = "fill",
} = {}) {
  const { map, lot, key } = ensureLot(lots, symbol);
  if (!key || !isUsableLot(lot)) return map;
  const bought = Number(lot.tokensIn);
  const original = lotOriginalTokensIn(lot);
  const evidenceLot = lotIsEvidenceLatched(lot);
  const dustIn = Number(piggyDustTokens);
  const dust = Number.isFinite(dustIn) && dustIn >= 0
    ? dustIn
    : Math.max(0, Number(lot.piggyDustTokens) || 0);

  let knownRemain;
  const sold = Number(tokensSold);
  if (Number.isFinite(sold) && sold > 0) {
    knownRemain = bought - sold;
  } else if (Number.isFinite(Number(soldFrac)) && Number(soldFrac) > 0) {
    knownRemain = bought * Math.max(0, 1 - Number(soldFrac));
  } else if (Number.isFinite(Number(remainingTokens)) && Number(remainingTokens) >= 0) {
    const onChain = Number(remainingTokens);
    knownRemain = fifoKnownLotRemain(onChain, bought, {
      evidenceLot,
      originalTokensIn: original,
      piggyDustTokens: dust,
    });
    if (dust > 0 && onChain > dust && knownRemain > onChain - dust + 1e-9) {
      knownRemain = onChain - dust;
    }
  } else {
    knownRemain = bought;
  }
  if (knownRemain < 0) knownRemain = 0;

  rememberSellTx(lot, {
    hash: txHash,
    tokensSold: Number.isFinite(sold) && sold > 0 ? sold : Math.max(0, bought - knownRemain),
    ethOut,
    at,
    source,
  });
  lot.piggyDustTokens = dust;
  if (!(Number(lot.originalTokensIn) > 0)) lot.originalTokensIn = original;

  if (!(knownRemain > 1e-12)) {
    map[key] = {
      ...emptyLot(key),
      cleared: true,
      updatedAt: Date.now(),
      piggyDustTokens: dust,
      sellTxs: Array.isArray(lot.sellTxs) ? lot.sellTxs.slice() : [],
      buyTxs: Array.isArray(lot.buyTxs) ? lot.buyTxs.slice() : [],
      source: lot.source || source,
    };
    return map;
  }

  const fifo = fifoRemainingCostEth({
    ethIn: Number(lot.fillCostEth) > 0 ? lot.fillCostEth : lot.ethIn,
    tokensIn: bought,
    remainingTokens: knownRemain,
    persistedInvestedEth: 0,
    evidenceLot,
    originalTokensIn: original,
    piggyDustTokens: 0,
  });
  if (fifo.unknown || !(fifo.investedEth > 0)) {
    // Dust on-chain must not wipe a known rem lot — keep proportional slice.
    const fracSafe = Math.min(1, knownRemain / bought);
    const fallback = (Number(lot.fillCostEth) > 0 ? lot.fillCostEth : lot.ethIn) * fracSafe;
    if (!(fallback > 0)) {
      map[key] = emptyLot(key);
      return map;
    }
    lot.tokensIn = knownRemain;
    lot.ethIn = (Number(lot.ethIn) || 0) * fracSafe;
    lot.fillCostEth = (Number(lot.fillCostEth) || 0) * fracSafe;
    lot.remainingCostEth = fallback;
    lot.cleared = false;
    lot.updatedAt = Date.now();
    return map;
  }
  const frac = Math.min(1, knownRemain / bought);
  lot.tokensIn = knownRemain;
  lot.ethIn = (Number(lot.ethIn) || 0) * frac;
  lot.fillCostEth = (Number(lot.fillCostEth) || 0) * frac;
  lot.remainingCostEth = fifo.investedEth;
  if (lot.operatorLot && Number(lot.operatorLot.fillCostEth) > 0) {
    lot.operatorLot = {
      ...lot.operatorLot,
      fillCostEth: fifo.investedEth,
      tokens: knownRemain,
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
      originalTokensIn: Number(lot.originalTokensIn) > 0
        ? Number(lot.originalTokensIn)
        : lotOriginalTokensIn(lot),
      piggyDustTokens: Number(lot.piggyDustTokens) || 0,
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
      sellTxs: (Array.isArray(lot.sellTxs) ? lot.sellTxs : [])
        .map((s) => ({
          hash: normalizeTxHash(s.hash),
          tokensSold: Number(s.tokensSold) || 0,
          ethOut: Number(s.ethOut) || 0,
          at: Number(s.at) || 0,
          source: String(s.source || ""),
        }))
        .filter((s) => s.hash),
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
      sellTxs: Array.isArray(row.sellTxs) ? row.sellTxs.filter((s) => normalizeTxHash(s?.hash)) : [],
      originalTokensIn: Number(row.originalTokensIn) || 0,
      piggyDustTokens: Number(row.piggyDustTokens) || 0,
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

/** Receipt-latched lots (buy hash or onchain-receipt). Not hashless persist. */
export function lotIsEvidenceLatched(lot) {
  return isUsableLot(lot) && (lotHasAnyBuyTx(lot) || lot.source === "onchain-receipt");
}

/**
 * Sell only recorded tokensIn when an evidence lot is latched and wallet
 * extra is pre-buy dust. Leave dust unsold / piggy. Missing add-on bags
 * (remain >> tokensIn) return the wallet balance — apply still HOLDs unknown.
 */
export function knownLotSellTokens(lot, walletBal) {
  const bal = Number(walletBal);
  if (!Number.isFinite(bal) || !(bal > 0)) return bal;
  if (!isUsableLot(lot)) return bal;
  const bought = Number(lot.tokensIn);
  if (!(bought > 0)) return bal;
  if (!lotIsEvidenceLatched(lot)) return bal;
  return fifoKnownLotRemain(bal, bought, {
    evidenceLot: true,
    originalTokensIn: lotOriginalTokensIn(lot),
    piggyDustTokens: Number(lot.piggyDustTokens) || 0,
  });
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
  const evidenceLot = lotIsEvidenceLatched(lot);
  const original = lotOriginalTokensIn(lot);
  latchPiggyDust(lot, remain);
  const dust = Number(lot.piggyDustTokens) || 0;
  // Sized leftover (chain < recorded buy): proportional only. Flooring on
  // remainingCostEth (the full fill) HOLDs a true PLUS on leftover bags.
  const leftover = Number.isFinite(Number(remainingTokens)) && Number(remainingTokens) > 0
    && remain < bought * 0.98;
  const fifo = fifoRemainingCostEth({
    ethIn,
    tokensIn: bought,
    remainingTokens: remain,
    persistedInvestedEth: leftover ? 0 : (Number(lot.remainingCostEth) || 0),
    evidenceLot,
    originalTokensIn: original,
    piggyDustTokens: dust,
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

/** Later hashes in EVIDENCE_BUY_TXS arrays (CLANKER 0xcb7dd5a6) merge like extras. */
export function isEvidenceSiblingBuyTx(symbol, hash, evidence = EVIDENCE_BUY_TXS) {
  const h = normalizeTxHash(hash);
  const hashes = evidenceHashForSymbol(evidence, symbol);
  return !!h && hashes.length > 1 && hashes.includes(h) && hashes[0] !== h;
}

/**
 * Latch a receipt onto persist only when it belongs to this cycle.
 * Empty / unusable → seed (same as #79). Sold-all `cleared` tombstone is
 * not an empty seed. Already-usable → merge seeded add-ons / evidence
 * siblings onto the same first lot only. Never rematerialize #78 first
 * fills onto a later bag.
 */
export function shouldLatchBuyReceipt(existing, hash, {
  remainingTokens,
  evidence = EVIDENCE_BUY_TXS,
  extras = EVIDENCE_ADDON_BUY_TXS,
  rebuildHashes = [],
} = {}) {
  const h = normalizeTxHash(hash);
  if (!h) return false;
  if (lotHasBuyTx(existing, h)) return false;
  if (isClearedLot(existing)) return false;
  if (!isUsableLot(existing)) return true;
  const key = String(existing.symbol || "").toUpperCase();
  const sibling = isEvidenceSiblingBuyTx(key, h, evidence);
  const listed = (Array.isArray(rebuildHashes) ? rebuildHashes : [])
    .map((x) => normalizeTxHash(x))
    .filter(Boolean);
  const rebuildSibling = listed.length > 1 && listed.includes(h) && listed[0] !== h;
  if (!isSeededAddonBuyTx(key, h, extras) && !sibling && !rebuildSibling) return false;
  const parent = evidenceHashForSymbol(evidence, key)[0] || listed[0];
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
  rebuildHashes = [],
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
  if (!shouldLatchBuyReceipt(map[key], hash, { remainingTokens, evidence, extras, rebuildHashes })) return map;
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

/** Sealed sell hashes for rebuild (persist + ledger + evidence — never invented). */
export function collectRebuildSellTxs({
  persistedLots,
  ledgerTrades,
  evidence = EVIDENCE_SELL_TXS,
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
  const persisted = persistedLots && typeof persistedLots === "object" ? persistedLots : {};
  for (const [sym, lot] of Object.entries(persisted)) {
    for (const s of lot?.sellTxs || []) add(sym, s.hash);
  }
  if (Array.isArray(ledgerTrades)) {
    for (const t of ledgerTrades) {
      if (!t || String(t.type || "").toUpperCase() !== "SELL") continue;
      add(t.symbol, t.tx || t.hash);
    }
  }
  return out;
}

/**
 * Rebuild one lot from a successful buy receipt (Transfer to wallet + WETH/ETH in).
 * Returns null when logs cannot prove both legs — do not invent.
 *
 * Native-ETH SwapRouter02 buys (VIRTUAL 0x33aac652 class) wrap via WETH Deposit
 * to the router, then Transfer router→pool. Wallet never sends WETH, so the
 * WETH-from-wallet leg is empty. Count tx.value, else Deposit, else router out
 * — never sum those three (same ETH). Wallet-WETH fills (AERO/BNKR/CLANKER
 * 0x23d8a0c5 / 0xcb7dd5a6) unchanged.
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
  let wethDepositWei = 0n;
  let wethRouterOutWei = 0n;
  for (const log of receipt.logs || []) {
    const topics = log?.topics || [];
    if (!topics.length) continue;
    const topic0 = String(topics[0] || "").toLowerCase();
    const addr = String(log.address || "").toLowerCase();
    let amt = 0n;
    try { amt = BigInt(log.data || "0x0"); } catch { amt = 0n; }
    if (topic0 === WETH_DEPOSIT_TOPIC && addr === WETH_BASE && amt > 0n && topics.length >= 2) {
      const dst = topicAddress(topics[1]);
      if (dst === to || dst === SWAP_ROUTER02_BASE) wethDepositWei += amt;
      continue;
    }
    if (topic0 !== TRANSFER_TOPIC) continue;
    if (topics.length < 3) continue;
    const frm = topicAddress(topics[1]);
    const dest = topicAddress(topics[2]);
    if (amt <= 0n) continue;
    if (addr === token && dest === to) tokenWei += amt;
    if (addr === WETH_BASE && frm === to) wethWei += amt;
    if (addr === WETH_BASE && frm === SWAP_ROUTER02_BASE && dest !== to) wethRouterOutWei += amt;
  }
  let ethValue = 0n;
  try { ethValue = BigInt(tx?.value || receipt?.value || 0); } catch { ethValue = 0n; }
  let ethInWei = wethWei + ethValue;
  if (ethInWei === 0n) {
    ethInWei = wethDepositWei > 0n ? wethDepositWei : wethRouterOutWei;
  }
  const tokensIn = weiToAmount(tokenWei, tokenDecimals);
  const ethIn = weiToAmount(ethInWei, 18);
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

export function lotHasSellTx(lot, hash) {
  const h = normalizeTxHash(hash);
  if (!h || !lot) return false;
  return (Array.isArray(lot.sellTxs) ? lot.sellTxs : [])
    .some((s) => normalizeTxHash(s.hash) === h);
}

/**
 * Rebuild a sell fill from a successful receipt (token Transfer from wallet
 * + WETH to wallet, or WETH Withdrawal). Returns null when both legs cannot
 * be proved — do not invent.
 */
export function lotFromSellReceipt({
  symbol,
  tokenAddress,
  wallet,
  txHash,
  receipt,
  tx,
  tokenDecimals = 18,
} = {}) {
  const key = String(symbol || "").toUpperCase();
  const token = String(tokenAddress || "").toLowerCase();
  const from = String(wallet || "").toLowerCase();
  const hash = normalizeTxHash(txHash || receipt?.transactionHash || tx?.hash);
  if (!key || !token || !from || !hash || !receipt) return null;
  if (!receiptSucceeded(receipt)) return null;

  let tokenWei = 0n;
  let wethWei = 0n;
  let wethWithdrawWei = 0n;
  for (const log of receipt.logs || []) {
    const topics = log?.topics || [];
    if (!topics.length) continue;
    const topic0 = String(topics[0] || "").toLowerCase();
    const addr = String(log.address || "").toLowerCase();
    let amt = 0n;
    try { amt = BigInt(log.data || "0x0"); } catch { amt = 0n; }
    if (topic0 === WETH_WITHDRAWAL_TOPIC && addr === WETH_BASE && amt > 0n && topics.length >= 2) {
      const src = topicAddress(topics[1]);
      if (src === from || src === SWAP_ROUTER02_BASE) wethWithdrawWei += amt;
      continue;
    }
    if (topic0 !== TRANSFER_TOPIC) continue;
    if (topics.length < 3) continue;
    const frm = topicAddress(topics[1]);
    const dest = topicAddress(topics[2]);
    if (amt <= 0n) continue;
    if (addr === token && frm === from) tokenWei += amt;
    if (addr === WETH_BASE && dest === from) wethWei += amt;
  }
  const tokensSold = weiToAmount(tokenWei, tokenDecimals);
  const ethOut = weiToAmount(wethWei > 0n ? wethWei : wethWithdrawWei, 18);
  if (!(tokensSold > 0) || !(ethOut > 0)) return null;
  return {
    symbol: key,
    txHash: hash,
    tokensSold,
    ethOut,
    source: "onchain-receipt",
  };
}

/** Merge a sealed sell receipt onto persist. Skip if that hash is already booked. */
export function mergeSellReceiptIntoLots(lots, sellFill, { remainingTokens } = {}) {
  const map = lots && typeof lots === "object" ? lots : {};
  if (!sellFill || !(Number(sellFill.tokensSold) > 0)) return map;
  const key = String(sellFill.symbol || "").toUpperCase();
  const hash = normalizeTxHash(sellFill.txHash || sellFill.hash);
  if (!key || !hash) return map;
  if (!isUsableLot(map[key])) return map;
  if (lotHasSellTx(map[key], hash)) return map;
  const dust = Number.isFinite(Number(remainingTokens))
    ? Math.max(0, Number(remainingTokens) - Math.max(0, Number(map[key].tokensIn) - Number(sellFill.tokensSold)))
    : Number(map[key].piggyDustTokens) || 0;
  recordSellFill(map, {
    symbol: key,
    tokensSold: Number(sellFill.tokensSold),
    txHash: hash,
    ethOut: Number(sellFill.ethOut) || 0,
    piggyDustTokens: dust > 0 ? dust : (Number(map[key].piggyDustTokens) || 0),
    remainingTokens,
    source: sellFill.source || "onchain-receipt",
  });
  return map;
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
  sellReceipts = [],
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

  const sellCatalog = new Map(
    (Array.isArray(tokens) ? tokens : []).map((t) => [String(t.symbol || "").toUpperCase(), t]),
  );
  for (const row of sellReceipts) {
    if (!row) continue;
    const sym = String(row.symbol || "").toUpperCase();
    const token = sellCatalog.get(sym) || {};
    const sold = lotFromSellReceipt({
      symbol: sym,
      tokenAddress: row.tokenAddress || token.address,
      wallet: row.wallet,
      txHash: row.txHash || row.hash,
      receipt: row.receipt,
      tx: row.tx,
      tokenDecimals: row.tokenDecimals ?? token.decimals ?? 18,
    });
    if (sold) {
      const remain = Number(remainingBySymbol?.[sym]);
      mergeSellReceiptIntoLots(lots, sold, {
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
