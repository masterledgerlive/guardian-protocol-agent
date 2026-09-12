import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TRANSFER_TOPIC,
  WETH_BASE,
  EVIDENCE_BUY_TXS,
  DRB_TROUGH_BUY_TX,
  EVIDENCE_ADDON_BUY_TXS,
  FIFO_LOTS_FILENAME,
  normalizeTxHash,
  isUsableLot,
  lotProvesCostBasis,
  recordBuyFill,
  recordSellFill,
  serializeFifoLots,
  deserializeFifoLots,
  applyLotToNet,
  applyLotToToken,
  seedNetPositionsFromFifoLots,
  lotFromBuyReceipt,
  ledgerBuyHasLotSizes,
  mergeLedgerBuysIntoLots,
  rebuildLotsAfterRestart,
  recoverLotsAfterGithubReadFailure,
  tokenHasKnownFifoCost,
  bootKnownCostLabel,
  seededRebuildRemaining,
  writeFifoLotsSync,
  readFifoLotsSync,
  collectRebuildTxs,
  parseLotRebuildTxsEnv,
  receiptSucceeded,
  lotAppliedOk,
  mergeLotMaps,
  isClearedLot,
  lotHasBuyTx,
  lotHasAnyBuyTx,
  shouldLatchBuyReceipt,
  mergeBuyReceiptIntoLots,
} from "./fifo-lot-store.js";
import {
  fifoRemainingCostEth,
  buildSellGateDecision,
  isDisableDowBias,
  freshLotCostFloor,
  sellEntryEthWithLotFloor,
  isAllowAddOnFifoRed,
} from "./lose-zero-gate.js";
import { hasUsableCostBasis, costBasisEth, blendUsdEntryOnAddOnBuy } from "./price-oracle.js";
import { classifyRecycleBag } from "./inject-revenue.js";

const root = dirname(fileURLToPath(import.meta.url));

const WALLET = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const DRB = "0x3ec2156D4c0A9CBdAB4a016633b7BcF6a8d68Ea2";
const BNKR = "0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b";

/** Live AERO buy 0x94faa542… — WETH from wallet + AERO Transfer in. */
const AERO_ETH_WEI = 786757301107754n;
const AERO_TOK_WEI = 3426611425491222000n;
const AERO_HASH = EVIDENCE_BUY_TXS.AERO;

function padAddr(addr) {
  return `0x${"0".repeat(24)}${addr.slice(2).toLowerCase()}`;
}

function transferLog(token, from, to, amountWei) {
  return {
    address: token,
    topics: [TRANSFER_TOPIC, padAddr(from), padAddr(to)],
    data: `0x${BigInt(amountWei).toString(16).padStart(64, "0")}`,
  };
}

function aeroReceipt() {
  return {
    status: "0x1",
    transactionHash: AERO_HASH,
    gasUsed: "0x19d7b",
    effectiveGasPrice: "0x5b8d80",
    logs: [
      transferLog(AERO, "0x3d5D143381916280ff91407FeBEB52f2b60f33Cf", WALLET, AERO_TOK_WEI),
      transferLog(WETH_BASE, WALLET, "0x2626664c2603336E57B271c5C0b26F421741e481", AERO_ETH_WEI),
    ],
  };
}

function drbReceipt() {
  const tok = 8238193475842487000000n;
  const eth = 785582981130297n;
  return {
    receipt: {
      status: 1,
      transactionHash: EVIDENCE_BUY_TXS.DRB,
      logs: [
        transferLog(DRB, "0x1111111111111111111111111111111111111111", WALLET, tok),
      ],
    },
    tx: { hash: EVIDENCE_BUY_TXS.DRB, value: `0x${eth.toString(16)}` },
    tokenAddress: DRB,
    symbol: "DRB",
    wallet: WALLET,
  };
}

/** Live DRB trough add-on 0x53a00788… nonce 5456 — WETH from wallet + DRB Transfer in. */
const DRB_TROUGH_ETH_WEI = 1103497776848954n;
const DRB_TROUGH_TOK_WEI = 13369674509388161257680n;

function drbTroughReceipt() {
  return {
    receipt: {
      status: "0x1",
      transactionHash: DRB_TROUGH_BUY_TX,
      logs: [
        transferLog(DRB, "0x1111111111111111111111111111111111111111", WALLET, DRB_TROUGH_TOK_WEI),
        transferLog(WETH_BASE, WALLET, "0x2626664c2603336E57B271c5C0b26F421741e481", DRB_TROUGH_ETH_WEI),
      ],
    },
    tx: { hash: DRB_TROUGH_BUY_TX, value: "0x0" },
    tokenAddress: DRB,
    symbol: "DRB",
    wallet: WALLET,
  };
}

function bnkrReceipt() {
  const tok = 8449871739504488000000n;
  const eth = 785641613865003n;
  return {
    receipt: {
      status: "0x1",
      transactionHash: EVIDENCE_BUY_TXS.BNKR,
      logs: [
        transferLog(BNKR, "0x1111111111111111111111111111111111111111", WALLET, tok),
        transferLog(WETH_BASE, WALLET, "0x2626664c2603336E57B271c5C0b26F421741e481", eth),
      ],
    },
    tx: { hash: EVIDENCE_BUY_TXS.BNKR, value: "0x0" },
    tokenAddress: BNKR,
    symbol: "BNKR",
    wallet: WALLET,
  };
}

function plusGate({ symbol, entryEth, proceeds, operatorLot = true }) {
  return buildSellGateDecision({
    symbol,
    reason: "🎯 PEAK RIDE",
    sellPct: 1,
    entryEth,
    lotCostEth: entryEth,
    usdMarkProceedsEth: proceeds,
    operatorLot,
    freshLot: true,
    projectedProceedsEth: proceeds,
    feePct: 0,
    gasCostEth: 0,
    gwei: 0.05,
  });
}

describe("fifo-lot-store — persist + rebuild after restart", () => {
  it("normalizes full hashes and rejects prefixes", () => {
    assert.equal(normalizeTxHash(AERO_HASH), AERO_HASH);
    assert.equal(normalizeTxHash("0x94faa542"), "");
    assert.equal(EVIDENCE_BUY_TXS.AERO.startsWith("0x94faa542"), true);
    assert.equal(EVIDENCE_BUY_TXS.DRB.startsWith("0xe0f846a8"), true);
    assert.equal(EVIDENCE_BUY_TXS.BNKR.startsWith("0xeef39d62"), true);
    assert.equal(DRB_TROUGH_BUY_TX.startsWith("0x53a00788"), true);
    assert.equal(EVIDENCE_ADDON_BUY_TXS.DRB, DRB_TROUGH_BUY_TX);
    assert.equal(normalizeTxHash(DRB_TROUGH_BUY_TX), DRB_TROUGH_BUY_TX);
  });

  it("after simulated restart, persisted lots rebuild FIFO so always-plus can evaluate", () => {
    const live = {};
    recordBuyFill(live, {
      symbol: "AERO",
      ethIn: 0.000786757301107754,
      tokensIn: 3.426611425491222,
      txHash: AERO_HASH,
      price: 0.94,
      reason: "MANUAL BUY (operator) $2",
      fillCostEth: 0.000786757301107754,
    });
    assert.equal(isUsableLot(live.AERO), true);
    assert.ok(live.AERO.operatorLot?.fillCostEth > 0);

    const blob = serializeFifoLots(live);
    // Restart: in-memory lots gone (Railway drop).
    const memory = {};
    assert.equal(isUsableLot(memory.AERO), false);

    const rebuilt = rebuildLotsAfterRestart({
      persisted: blob,
      remainingBySymbol: { AERO: 3.426611425491222 },
    });
    assert.deepEqual(rebuilt.unknown, []);
    assert.ok(rebuilt.rebuilt.includes("AERO"));
    const token = rebuilt.applied.AERO;
    assert.equal(token.unknownEntry, false);
    assert.ok(token.totalInvestedEth > 0);
    assert.ok(freshLotCostFloor(token) > 0);

    const fifo = fifoRemainingCostEth({
      ethIn: rebuilt.lots.AERO.ethIn,
      tokensIn: rebuilt.lots.AERO.tokensIn,
      remainingTokens: 3.426611425491222,
    });
    assert.equal(fifo.unknown, false);
    assert.ok(fifo.investedEth > 0);

    const red = plusGate({ symbol: "AERO", entryEth: fifo.investedEth, proceeds: fifo.investedEth * 0.7 });
    assert.equal(red.allow, false);
    assert.equal(red.verdict, "HOLD");

    const green = plusGate({ symbol: "AERO", entryEth: fifo.investedEth, proceeds: fifo.investedEth * 1.2 });
    assert.equal(green.allow, true);
    assert.ok(green.verdict === "PLUS" || green.verdict === "SKIP_HITCH");
    assert.ok(green.leftover > 0);
  });

  it("rebuilds AERO / DRB / BNKR from buy receipt when persist is missing", () => {
    const rebuilt = rebuildLotsAfterRestart({
      persisted: {},
      remainingBySymbol: { AERO: 3.42, DRB: 8238, BNKR: 8449 },
      receipts: [
        {
          symbol: "AERO",
          tokenAddress: AERO,
          wallet: WALLET,
          txHash: AERO_HASH,
          receipt: aeroReceipt(),
          tx: { hash: AERO_HASH, value: "0x0" },
          reason: "MANUAL BUY (operator) $2",
        },
        drbReceipt(),
        bnkrReceipt(),
      ],
      tokens: [
        { symbol: "AERO", address: AERO },
        { symbol: "DRB", address: DRB },
        { symbol: "BNKR", address: BNKR },
      ],
    });
    assert.deepEqual(rebuilt.unknown, []);
    for (const sym of ["AERO", "DRB", "BNKR"]) {
      assert.ok(isUsableLot(rebuilt.lots[sym]), sym);
      assert.equal(rebuilt.lots[sym].source, "onchain-receipt");
      assert.ok(rebuilt.applied[sym].totalInvestedEth > 0, sym);
      assert.equal(rebuilt.applied[sym].unknownEntry, false);
      const fifo = fifoRemainingCostEth({
        ethIn: rebuilt.lots[sym].ethIn,
        tokensIn: rebuilt.lots[sym].tokensIn,
        remainingTokens: rebuilt.lots[sym].tokensIn,
      });
      assert.equal(fifo.unknown, false, sym);
      const green = plusGate({
        symbol: sym,
        entryEth: fifo.investedEth,
        proceeds: fifo.investedEth * 1.15,
      });
      assert.equal(green.allow, true, `${sym} true PLUS must green`);
    }
    const aero = lotFromBuyReceipt({
      symbol: "AERO",
      tokenAddress: AERO,
      wallet: WALLET,
      txHash: AERO_HASH,
      receipt: aeroReceipt(),
      tx: { value: "0x0" },
    });
    assert.ok(Math.abs(aero.tokensIn - 3.426611425491222) < 1e-9);
    assert.ok(Math.abs(aero.ethIn - 0.000786757301107754) < 1e-15);
  });

  it("GitHub 401: seeded buy-hash rebuild still produces known cost", () => {
    const github = { status: 401, content: null, sha: null };
    assert.equal(github.content, null);
    const rebuilt = recoverLotsAfterGithubReadFailure({
      persisted: {},
      remainingBySymbol: { AERO: 3.42, DRB: 8238, BNKR: 8449 },
      receipts: [
        {
          symbol: "AERO",
          tokenAddress: AERO,
          wallet: WALLET,
          txHash: AERO_HASH,
          receipt: aeroReceipt(),
          tx: { hash: AERO_HASH, value: "0x0" },
          reason: "MANUAL BUY (operator) $2",
        },
        drbReceipt(),
        bnkrReceipt(),
      ],
      tokens: [
        { symbol: "AERO", address: AERO },
        { symbol: "DRB", address: DRB },
        { symbol: "BNKR", address: BNKR },
      ],
    });
    assert.deepEqual(rebuilt.unknown, []);
    for (const sym of ["AERO", "DRB", "BNKR"]) {
      assert.ok(isUsableLot(rebuilt.lots[sym]), `${sym} lot after GitHub 401`);
      assert.equal(rebuilt.lots[sym].source, "onchain-receipt");
      assert.equal(rebuilt.applied[sym].unknownEntry, false);
      assert.ok(rebuilt.applied[sym].totalInvestedEth > 0, `${sym} known ETH cost`);
      assert.ok(rebuilt.lots[sym].tokensIn > 0 && rebuilt.lots[sym].ethIn > 0, `${sym} latched tokensIn/ethIn`);
      assert.equal(tokenHasKnownFifoCost(rebuilt.applied[sym], rebuilt.lots[sym]), true, `${sym} desk known cost`);
      assert.match(bootKnownCostLabel(rebuilt.applied[sym]), new RegExp(`${sym}@`));
    }
    assert.equal(seededRebuildRemaining(undefined), null);
    assert.equal(seededRebuildRemaining(0), null);
    assert.equal(seededRebuildRemaining(0.0004), null);
    assert.equal(seededRebuildRemaining(3.42), 3.42);
  });

  it("missing persist and missing receipt stays unknown — does not invent P&L", () => {
    const rebuilt = rebuildLotsAfterRestart({
      persisted: {},
      remainingBySymbol: { AERO: 3.42, DRB: 100, BNKR: 100 },
      receipts: [],
    });
    assert.ok(rebuilt.unknown.includes("AERO"));
    assert.ok(rebuilt.unknown.includes("DRB"));
    assert.ok(rebuilt.unknown.includes("BNKR"));
    const fifo = fifoRemainingCostEth({
      ethIn: 0,
      tokensIn: 0,
      remainingTokens: 3.42,
      persistedInvestedEth: 0.002, // stale cash-flow leftover
    });
    assert.equal(fifo.unknown, true);
    const d = plusGate({ symbol: "AERO", entryEth: 0, proceeds: 0.001, operatorLot: false });
    assert.equal(d.allow, false);
    assert.equal(d.verdict, "HOLD");
    assert.match(d.log, /unknown cost/i);
  });

  it("tokenless ledger BUY does not poison tokensIn", () => {
    assert.equal(ledgerBuyHasLotSizes({
      type: "BUY", symbol: "AERO", ethSpent: 0.001, price: 0.94,
    }), false);
    const lots = mergeLedgerBuysIntoLots({}, [
      { type: "BUY", symbol: "AERO", ethSpent: 0.001, price: 0.94, tx: AERO_HASH },
      { type: "BUY", symbol: "AERO", ethSpent: 0.000786757301107754, receivedTokens: 3.426611425491222, price: 0.94, tx: AERO_HASH },
    ]);
    assert.equal(isUsableLot(lots.AERO), true);
    assert.equal(lots.AERO.tokensIn, 3.426611425491222);
  });

  it("disk persist survives a process-local restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "fifo-lots-"));
    const file = join(dir, FIFO_LOTS_FILENAME);
    try {
      const live = {};
      recordBuyFill(live, {
        symbol: "BNKR",
        ethIn: 0.000785641613865003,
        tokensIn: 8449.871739504488,
        txHash: EVIDENCE_BUY_TXS.BNKR,
        reason: "MANUAL BUY (operator) $2",
        fillCostEth: 0.000785641613865003,
      });
      writeFifoLotsSync(file, live);
      const fromDisk = readFifoLotsSync(file);
      assert.equal(isUsableLot(fromDisk.BNKR), true);
      assert.equal(lotProvesCostBasis(fromDisk.BNKR), true);
      const net = seedNetPositionsFromFifoLots({}, fromDisk);
      assert.ok(net.BNKR.tokensIn > 0);
      assert.ok(net.BNKR.ethIn > 0);
      const token = { symbol: "BNKR" };
      applyLotToToken(token, fromDisk.BNKR, { remainingTokens: 8449.871739504488 });
      assert.equal(token.unknownEntry, false);
      assert.ok(sellEntryEthWithLotFloor(0, token) > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("partial sell shrinks remaining FIFO; sold-all clears", () => {
    const lots = {};
    recordBuyFill(lots, {
      symbol: "DRB",
      ethIn: 0.001,
      tokensIn: 1000,
      txHash: EVIDENCE_BUY_TXS.DRB,
      fillCostEth: 0.001,
      reason: "MANUAL BUY (operator) $2",
    });
    recordSellFill(lots, { symbol: "DRB", remainingTokens: 400 });
    assert.ok(Math.abs(lots.DRB.tokensIn - 400) < 1e-9);
    assert.ok(lots.DRB.remainingCostEth > 0.00039 && lots.DRB.remainingCostEth < 0.00041);
    recordSellFill(lots, { symbol: "DRB", remainingTokens: 0 });
    assert.equal(isUsableLot(lots.DRB), false);
  });

  it("collectRebuildTxs includes evidence + env + persisted hashes", () => {
    const env = { LOT_REBUILD_TXS: `AERO:${AERO_HASH}` };
    assert.deepEqual(parseLotRebuildTxsEnv(env), { AERO: [AERO_HASH] });
    const hashes = collectRebuildTxs({
      persistedLots: { AERO: { buyTxs: [{ hash: AERO_HASH }] } },
      env,
    });
    assert.ok(hashes.AERO.includes(AERO_HASH));
    assert.ok(hashes.DRB.includes(EVIDENCE_BUY_TXS.DRB));
    assert.ok(hashes.DRB.includes(DRB_TROUGH_BUY_TX), "DRB trough add-on must be seeded");
    assert.ok(hashes.BNKR.includes(EVIDENCE_BUY_TXS.BNKR));
  });

  it("receipt with only one leg is not a lot (no invented cost)", () => {
    const half = lotFromBuyReceipt({
      symbol: "AERO",
      tokenAddress: AERO,
      wallet: WALLET,
      txHash: AERO_HASH,
      receipt: {
        status: "0x1",
        logs: [transferLog(AERO, "0x3d5D143381916280ff91407FeBEB52f2b60f33Cf", WALLET, AERO_TOK_WEI)],
      },
      tx: { value: "0x0" },
    });
    assert.equal(half, null);
  });

  it("applyLotToNet seeds boot netPositions so #69 FIFO can run", () => {
    const lots = deserializeFifoLots(serializeFifoLots(
      recordBuyFill({}, {
        symbol: "AERO",
        ethIn: 0.0008,
        tokensIn: 3.4,
        txHash: AERO_HASH,
        price: 0.9,
        fillCostEth: 0.0008,
      }),
    ));
    const net = {};
    applyLotToNet(net, lots.AERO);
    const fifo = fifoRemainingCostEth({
      ethIn: net.AERO.ethIn,
      tokensIn: net.AERO.tokensIn,
      remainingTokens: 3.4,
    });
    assert.equal(fifo.unknown, false);
    assert.ok(fifo.investedEth > 0);
  });

  it("accepts viem receipt.status success (live rpcCall shape)", () => {
    const rec = aeroReceipt();
    rec.status = "success";
    assert.equal(receiptSucceeded(rec), true);
    assert.equal(receiptSucceeded({ status: "reverted" }), false);
    const lot = lotFromBuyReceipt({
      symbol: "AERO",
      tokenAddress: AERO,
      wallet: WALLET,
      txHash: AERO_HASH,
      receipt: rec,
      tx: { value: "0x0" },
      reason: "MANUAL BUY (operator) $2",
    });
    assert.equal(isUsableLot(lot), true);
    assert.ok(lot.ethIn > 0 && lot.tokensIn > 0);
  });

  it("leftover chain balance uses proportional FIFO, not the full fill floor", () => {
    const lots = {};
    recordBuyFill(lots, {
      symbol: "AERO",
      ethIn: 0.001,
      tokensIn: 10,
      txHash: AERO_HASH,
      fillCostEth: 0.001,
      reason: "MANUAL BUY (operator) $2",
    });
    assert.ok(lots.AERO.remainingCostEth >= 0.001);
    const token = { symbol: "AERO" };
    const fifo = applyLotToToken(token, lots.AERO, { remainingTokens: 4 });
    assert.equal(fifo.unknown, false);
    assert.ok(Math.abs(token.totalInvestedEth - 0.0004) < 1e-9);
    const green = plusGate({ symbol: "AERO", entryEth: token.totalInvestedEth, proceeds: 0.0005 });
    assert.equal(green.allow, true, "true PLUS on leftover must not HOLD the full-fill floor");
  });

  it("rebuild without USD entryPrice still applies ETH lot (no unknown wipe)", () => {
    const token = { symbol: "BNKR", unknownEntry: true, entryPrice: 0.0003, totalInvestedEth: 0 };
    const lot = lotFromBuyReceipt({
      symbol: "BNKR",
      tokenAddress: BNKR,
      wallet: WALLET,
      txHash: EVIDENCE_BUY_TXS.BNKR,
      receipt: bnkrReceipt().receipt,
      tx: bnkrReceipt().tx,
      price: 0,
      reason: "MANUAL BUY (operator) $2",
    });
    const fifo = applyLotToToken(token, lot, { remainingTokens: 8449.871739504488 });
    assert.equal(lotAppliedOk(token, fifo), true);
    assert.equal(token.unknownEntry, false);
    assert.ok(token.totalInvestedEth > 0);
    assert.ok(freshLotCostFloor(token) > 0);
  });

  it("newer sell shrink / sold-all tombstone beats stale positions.json full lot", () => {
    const stale = {};
    recordBuyFill(stale, {
      symbol: "DRB",
      ethIn: 0.001,
      tokensIn: 1000,
      txHash: EVIDENCE_BUY_TXS.DRB,
      fillCostEth: 0.001,
      reason: "MANUAL BUY (operator) $2",
      at: 1_000,
    });
    const fresh = JSON.parse(JSON.stringify(stale));
    recordSellFill(fresh, { symbol: "DRB", remainingTokens: 400 });
    const merged = mergeLotMaps(stale, fresh);
    assert.ok(merged.DRB.tokensIn < 401);
    assert.ok(merged.DRB.remainingCostEth < 0.0005);

    const sold = JSON.parse(JSON.stringify(stale));
    recordSellFill(sold, { symbol: "DRB", remainingTokens: 0 });
    assert.equal(isClearedLot(sold.DRB), true);
    const afterClear = mergeLotMaps(stale, deserializeFifoLots(serializeFifoLots(sold)));
    assert.equal(isUsableLot(afterClear.DRB), false);
    assert.equal(isClearedLot(afterClear.DRB), true);
  });
});

describe("fifo-lot-store — #78 / #76 / #74 stay armed", () => {
  it("DISABLE_DOW_BIAS remains default ON", () => {
    assert.equal(isDisableDowBias({}), true);
  });

  it("agent.js wires persist + rebuild (no V4 merge)", () => {
    const src = readFileSync(join(root, "agent.js"), "utf8");
    assert.ok(src.includes('from "./fifo-lot-store.js"'));
    assert.ok(src.includes("recordBuyFill"));
    assert.ok(src.includes("persistFifoLotsNow"));
    assert.ok(src.includes("lotAppliedOk"));
    assert.ok(src.includes("rebuildLotsAfterRestart") || src.includes("lotFromBuyReceipt"));
    assert.ok(src.includes("rebuildSeededLotsFromChain"));
    assert.ok(src.includes("github-401"));
    assert.ok(src.includes("liveGithubToken"));
    assert.ok(src.includes("githubAuthHeaders"));
    assert.ok(!src.includes("Bearer ${process.env.GITHUB_TOKEN}"), "ledger/fifo-lots must not use Bearer");
    assert.ok(src.includes("fifoLots"));
    assert.ok(src.includes("DISABLE_DOW_BIAS"));
    assert.ok(src.includes("isManualOperatorBuy(reason)"));
    assert.ok(src.includes("settleFlushedOperatorBuy"));
    assert.ok(src.includes("0x3d5D143381916280ff91407FeBEB52f2b60f33Cf"));
    assert.ok(src.includes("classifyRecycleBag"));
    assert.ok(src.includes("blendUsdEntryOnAddOnBuy"));
    assert.ok(src.includes("evaluateAddOnFifoRedGate"), "must not add-on into FIFO-red lots");
    assert.ok(src.includes("shouldLatchBuyReceipt"), "must not rematerialize closed-cycle fills");
    assert.ok(src.includes("mergeBuyReceiptIntoLots"), "must merge trough add-on onto first lot");
    assert.ok(!src.includes("from \"./guardian-v4/agent.js\""), "must not merge V4 into agent.js");
  });
});

describe("fifo-lot-store — live DRB/BNKR seed + dust-recycle FIFO eth", () => {
  /** Live wallet leftovers 2026-09-11 after the evidence buys / AERO+DRB reds. */
  const LIVE_REMAIN = Object.freeze({
    AERO: 1.1900154729310743,
    DRB: 2844.726394849007,
    BNKR: 8449.911994345815,
  });

  it("seeded DRB+BNKR rebuild from buy hashes yields usable FIFO cost (no USD entry)", () => {
    const rebuilt = rebuildLotsAfterRestart({
      persisted: {},
      remainingBySymbol: LIVE_REMAIN,
      receipts: [
        {
          symbol: "AERO",
          tokenAddress: AERO,
          wallet: WALLET,
          txHash: AERO_HASH,
          receipt: aeroReceipt(),
          tx: { hash: AERO_HASH, value: "0x0" },
        },
        drbReceipt(),
        bnkrReceipt(),
      ],
      tokens: [
        { symbol: "AERO", address: AERO },
        { symbol: "DRB", address: DRB },
        { symbol: "BNKR", address: BNKR },
      ],
    });
    assert.deepEqual(rebuilt.unknown, []);
    for (const sym of ["DRB", "BNKR"]) {
      const token = rebuilt.applied[sym];
      assert.ok(isUsableLot(rebuilt.lots[sym]), `${sym} lot`);
      assert.equal(token.unknownEntry, false);
      assert.ok(token.totalInvestedEth > 0, `${sym} FIFO eth`);
      assert.ok(token.entryPrice == null || !(token.entryPrice > 0), `${sym} must not invent USD entry`);
      assert.equal(hasUsableCostBasis(token), true, `${sym} usable without USD entryPrice`);
      assert.equal(costBasisEth(token), token.totalInvestedEth);
      assert.equal(tokenHasKnownFifoCost(token, rebuilt.lots[sym]), true);
    }
    // AERO leftover after nonce-5451 red still proportions (half-works class).
    assert.ok(rebuilt.applied.AERO.totalInvestedEth > 0);
    assert.ok(rebuilt.applied.AERO.totalInvestedEth < rebuilt.lots.AERO.fillCostEth);
    assert.ok(rebuilt.applied.DRB.totalInvestedEth < rebuilt.lots.DRB.fillCostEth);
    assert.ok(Math.abs(rebuilt.applied.BNKR.totalInvestedEth - rebuilt.lots.BNKR.fillCostEth) < 1e-9);
  });

  it("dust-recycle with FIFO eth present proceeds and does not say unknown", () => {
    const token = { symbol: "DRB", unknownEntry: true, entryPrice: null, totalInvestedEth: 0 };
    const lot = lotFromBuyReceipt({
      symbol: "DRB",
      tokenAddress: DRB,
      wallet: WALLET,
      txHash: EVIDENCE_BUY_TXS.DRB,
      receipt: drbReceipt().receipt,
      tx: drbReceipt().tx,
      price: 0,
    });
    const fifo = applyLotToToken(token, lot, { remainingTokens: LIVE_REMAIN.DRB });
    assert.equal(lotAppliedOk(token, fifo), true);
    assert.equal(token.entryPrice == null || !(Number(token.entryPrice) > 0), true);

    const kind = classifyRecycleBag({
      unknownEntry: token.unknownEntry,
      totalInvestedEth: token.totalInvestedEth,
      entryPrice: token.entryPrice,
      hasUsdBasis: hasUsableCostBasis(token),
      operatorLotEth: token.operatorLot?.fillCostEth,
    });
    assert.equal(kind.unknownBag, false);
    assert.equal(kind.hasKnownPos, true);
    assert.ok(kind.fifoEth > 0);

    const reason = kind.hasKnownPos
      ? "🌙 INJECT FUEL — recycle known bag for cascade"
      : "🌙 DUST RECYCLE — unknown cost basis";
    assert.ok(!/unknown cost basis/.test(reason));

    const green = plusGate({
      symbol: "DRB",
      entryEth: kind.fifoEth,
      proceeds: kind.fifoEth * 1.2,
    });
    assert.equal(green.allow, true);
    assert.ok(!/unknown cost/i.test(green.log || ""));

    const blockedUnknown = classifyRecycleBag({
      unknownEntry: true,
      totalInvestedEth: 0,
      entryPrice: null,
    });
    assert.equal(blockedUnknown.unknownBag, true);
    assert.match(
      blockedUnknown.unknownBag ? "🌙 DUST RECYCLE — unknown cost basis" : "",
      /unknown cost basis/,
    );
  });

  it("ETH-only DRB add-on keeps FIFO / recycle and does not invent free-token USD", () => {
    const token = { symbol: "DRB", unknownEntry: true, entryPrice: null, totalInvestedEth: 0 };
    const lot = lotFromBuyReceipt({
      symbol: "DRB",
      tokenAddress: DRB,
      wallet: WALLET,
      txHash: EVIDENCE_BUY_TXS.DRB,
      receipt: drbReceipt().receipt,
      tx: drbReceipt().tx,
      price: 0,
    });
    applyLotToToken(token, lot, { remainingTokens: LIVE_REMAIN.DRB });
    assert.equal(hasUsableCostBasis(token), true);
    assert.ok(!(Number(token.entryPrice) > 0));

    const prevInvested = costBasisEth(token);
    const prevTokenBal = LIVE_REMAIN.DRB;
    const fillCostEth = 0.00008;
    const fillPrice = 0.00009;
    const fillTokens = 400;
    token.totalInvestedEth = prevInvested + fillCostEth;
    token.entryPrice = blendUsdEntryOnAddOnBuy({
      prevEntryPrice: token.entryPrice,
      prevTokenBal,
      prevInvestedEth: prevInvested,
      newTokens: fillTokens,
      newPrice: fillPrice,
    });
    token.unknownEntry = false;

    assert.equal(token.entryPrice, null);
    assert.ok(token.totalInvestedEth > prevInvested);
    assert.equal(hasUsableCostBasis(token), true);

    const kind = classifyRecycleBag({
      unknownEntry: token.unknownEntry,
      totalInvestedEth: token.totalInvestedEth,
      entryPrice: token.entryPrice,
      hasUsdBasis: hasUsableCostBasis(token),
    });
    assert.equal(kind.unknownBag, false);
    assert.equal(kind.hasKnownPos, true);
    assert.ok(kind.fifoEth > prevInvested);

    // Fib / peak / USD P&L that require entryPrice must not fire from $0.
    assert.equal(token.entryPrice ? (fillPrice - token.entryPrice) / token.entryPrice : null, null);
    assert.ok(!(token.entryPrice > 0 && fillPrice > token.entryPrice), "no invented peak-vs-entry");
  });
});

describe("fifo-lot-store — latch DRB trough 0x53a00788 FIFO", () => {
  const FIRST_REMAIN = 2844.726394849007;
  const TROUGH_TOKENS = Number(DRB_TROUGH_TOK_WEI) / 1e18;
  const AFTER_TROUGH = FIRST_REMAIN + TROUGH_TOKENS;

  it("first-lot persist + larger chain remaining is unknown until trough merges", () => {
    const first = lotFromBuyReceipt({
      symbol: "DRB",
      tokenAddress: DRB,
      wallet: WALLET,
      txHash: EVIDENCE_BUY_TXS.DRB,
      receipt: drbReceipt().receipt,
      tx: drbReceipt().tx,
    });
    const token = { symbol: "DRB", unknownEntry: true, entryPrice: null, totalInvestedEth: 0 };
    const before = applyLotToToken(token, first, { remainingTokens: AFTER_TROUGH });
    assert.equal(before.unknown, true, "remain >> first tokensIn must be unknown-lots");
    assert.equal(before.reason, "unknown-lots");

    const lots = { DRB: first };
    const trough = lotFromBuyReceipt({
      symbol: "DRB",
      tokenAddress: DRB,
      wallet: WALLET,
      txHash: DRB_TROUGH_BUY_TX,
      receipt: drbTroughReceipt().receipt,
      tx: drbTroughReceipt().tx,
    });
    assert.equal(isUsableLot(trough), true);
    assert.ok(Math.abs(trough.ethIn - Number(DRB_TROUGH_ETH_WEI) / 1e18) < 1e-15);
    mergeBuyReceiptIntoLots(lots, trough);
    assert.equal(lotHasBuyTx(lots.DRB, EVIDENCE_BUY_TXS.DRB), true);
    assert.equal(lotHasBuyTx(lots.DRB, DRB_TROUGH_BUY_TX), true);
    mergeBuyReceiptIntoLots(lots, trough);
    assert.equal(lots.DRB.buyTxs.filter((b) => b.hash === DRB_TROUGH_BUY_TX).length, 1);

    const after = applyLotToToken(token, lots.DRB, { remainingTokens: AFTER_TROUGH });
    assert.equal(after.unknown, false);
    assert.ok(after.investedEth > 0);
    assert.equal(token.unknownEntry, false);
    assert.ok(token.totalInvestedEth > 0);
    assert.equal(lotAppliedOk(token, after), true);
  });

  it("rebuild merges trough onto persisted first lot; dust-recycle sees known FIFO eth", () => {
    const live = {};
    recordBuyFill(live, {
      symbol: "DRB",
      ethIn: 0.000785582981130297,
      tokensIn: 8238.193475842487,
      txHash: EVIDENCE_BUY_TXS.DRB,
      fillCostEth: 0.000785582981130297,
      reason: "MANUAL BUY (operator) $2",
    });
    recordSellFill(live, { symbol: "DRB", remainingTokens: FIRST_REMAIN });
    const firstFifo = Number(live.DRB.remainingCostEth);

    const rebuilt = rebuildLotsAfterRestart({
      persisted: serializeFifoLots(live),
      remainingBySymbol: { DRB: AFTER_TROUGH },
      receipts: [drbTroughReceipt()],
      tokens: [{ symbol: "DRB", address: DRB }],
    });
    assert.deepEqual(rebuilt.unknown, []);
    assert.ok(rebuilt.rebuilt.includes("DRB"));
    assert.equal(lotHasBuyTx(rebuilt.lots.DRB, EVIDENCE_BUY_TXS.DRB), true);
    assert.equal(lotHasBuyTx(rebuilt.lots.DRB, DRB_TROUGH_BUY_TX), true);
    const token = rebuilt.applied.DRB;
    assert.equal(token.unknownEntry, false);
    assert.ok(token.totalInvestedEth > firstFifo, "add-on slice must raise remaining FIFO eth");
    assert.ok(!(Number(token.entryPrice) > 0), "must not invent USD entry");

    const kind = classifyRecycleBag({
      unknownEntry: token.unknownEntry,
      totalInvestedEth: token.totalInvestedEth,
      entryPrice: token.entryPrice,
      hasUsdBasis: hasUsableCostBasis(token),
      operatorLotEth: token.operatorLot?.fillCostEth,
    });
    assert.equal(kind.unknownBag, false);
    assert.equal(kind.hasKnownPos, true);
    assert.ok(kind.fifoEth > 0);
    assert.ok(!/unknown/.test(kind.unknownBag ? "unknown" : "known"));

    const entrySold = sellEntryEthWithLotFloor(token.totalInvestedEth, token);
    assert.ok(entrySold > 0);
    const green = plusGate({
      symbol: "DRB",
      entryEth: entrySold,
      proceeds: entrySold * 1.2,
    });
    assert.equal(green.allow, true);
    assert.ok(!/unknown cost/i.test(green.log || ""));
  });

  it("does not rematerialize #78 first fills onto a later usable lot", () => {
    const later = {};
    recordBuyFill(later, {
      symbol: "DRB",
      ethIn: 0.0004,
      tokensIn: 900,
      txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      fillCostEth: 0.0004,
      reason: "MANUAL BUY (operator) $2",
    });
    const first = lotFromBuyReceipt({
      symbol: "DRB",
      tokenAddress: DRB,
      wallet: WALLET,
      txHash: EVIDENCE_BUY_TXS.DRB,
      receipt: drbReceipt().receipt,
      tx: drbReceipt().tx,
    });
    const trough = lotFromBuyReceipt({
      symbol: "DRB",
      tokenAddress: DRB,
      wallet: WALLET,
      txHash: DRB_TROUGH_BUY_TX,
      receipt: drbTroughReceipt().receipt,
      tx: drbTroughReceipt().tx,
    });
    assert.equal(shouldLatchBuyReceipt(later.DRB, EVIDENCE_BUY_TXS.DRB, { remainingTokens: 900 }), false);
    assert.equal(shouldLatchBuyReceipt(later.DRB, DRB_TROUGH_BUY_TX, { remainingTokens: 900 }), false);
    const beforeEth = later.DRB.ethIn;
    const beforeTok = later.DRB.tokensIn;
    mergeBuyReceiptIntoLots(later, first, { remainingTokens: 900 });
    mergeBuyReceiptIntoLots(later, trough, { remainingTokens: 900 });
    assert.equal(later.DRB.ethIn, beforeEth);
    assert.equal(later.DRB.tokensIn, beforeTok);
    assert.equal(lotHasBuyTx(later.DRB, EVIDENCE_BUY_TXS.DRB), false);
    assert.equal(lotHasBuyTx(later.DRB, DRB_TROUGH_BUY_TX), false);

    const rebuilt = rebuildLotsAfterRestart({
      persisted: serializeFifoLots(later),
      remainingBySymbol: { DRB: 900 },
      receipts: [drbReceipt(), drbTroughReceipt()],
      tokens: [{ symbol: "DRB", address: DRB }],
    });
    assert.equal(rebuilt.applied.DRB.unknownEntry, false);
    assert.ok(Math.abs(rebuilt.lots.DRB.ethIn - beforeEth) < 1e-15);
    assert.ok(Math.abs(rebuilt.lots.DRB.tokensIn - beforeTok) < 1e-9);
    assert.equal(lotHasBuyTx(rebuilt.lots.DRB, EVIDENCE_BUY_TXS.DRB), false);
  });

  it("hashless first-lot persist still merges trough when remaining exceeds tokensIn", () => {
    const first = lotFromBuyReceipt({
      symbol: "DRB",
      tokenAddress: DRB,
      wallet: WALLET,
      txHash: EVIDENCE_BUY_TXS.DRB,
      receipt: drbReceipt().receipt,
      tx: drbReceipt().tx,
    });
    const hashless = { ...first, buyTxs: [] };
    const trough = lotFromBuyReceipt({
      symbol: "DRB",
      tokenAddress: DRB,
      wallet: WALLET,
      txHash: DRB_TROUGH_BUY_TX,
      receipt: drbTroughReceipt().receipt,
      tx: drbTroughReceipt().tx,
    });
    assert.equal(lotHasAnyBuyTx(hashless), false);
    assert.equal(
      shouldLatchBuyReceipt(hashless, DRB_TROUGH_BUY_TX, { remainingTokens: AFTER_TROUGH }),
      true,
    );
    const lots = { DRB: { ...hashless } };
    mergeBuyReceiptIntoLots(lots, trough, { remainingTokens: AFTER_TROUGH });
    assert.equal(lotHasBuyTx(lots.DRB, DRB_TROUGH_BUY_TX), true);
    const after = applyLotToToken(
      { symbol: "DRB", unknownEntry: true, entryPrice: null, totalInvestedEth: 0 },
      lots.DRB,
      { remainingTokens: AFTER_TROUGH },
    );
    assert.equal(after.unknown, false);
    assert.ok(after.investedEth > 0);
  });

  it("ALLOW_ADD_ON_FIFO_RED stays default OFF — latch does not weaken #84", () => {
    assert.equal(isAllowAddOnFifoRed({}), false);
    assert.equal(isAllowAddOnFifoRed({ ALLOW_ADD_ON_FIFO_RED: "" }), false);
    assert.equal(isAllowAddOnFifoRed({ ALLOW_ADD_ON_FIFO_RED: "no" }), false);
    const src = readFileSync(join(root, "agent.js"), "utf8");
    assert.ok(src.includes("evaluateAddOnFifoRedGate"));
    assert.ok(src.includes("ALLOW_ADD_ON_FIFO_RED"));
    const buyFn = src.indexOf("async function executeBuy(");
    const buyEnd = src.indexOf("\nasync function ", buyFn + 1);
    const buy = src.slice(buyFn, buyEnd > 0 ? buyEnd : buyFn + 9000);
    const gate = buy.indexOf("evaluateAddOnFifoRedGate");
    const encode = buy.indexOf("encodeSwap(");
    assert.ok(gate >= 0 && encode > gate, "#84 gate still runs before encodeSwap");
  });
});
