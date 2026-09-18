import { execSync } from "node:child_process";
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
  WETH_DEPOSIT_TOPIC,
  WETH_BASE,
  SWAP_ROUTER02_BASE,
  EVIDENCE_BUY_TXS,
  DRB_TROUGH_BUY_TX,
  EVIDENCE_ADDON_BUY_TXS,
  CLANKER_ADDON_BUY_TX,
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
  isEvidenceSiblingBuyTx,
  mergeBuyReceiptIntoLots,
  knownLotSellTokens,
  lotIsEvidenceLatched,
  lotFromSellReceipt,
  mergeSellReceiptIntoLots,
  lotHasSellTx,
  lotOriginalTokensIn,
  collectRebuildSellTxs,
  latchPiggyDust,
} from "./fifo-lot-store.js";
import { classifySellArmedDisplay } from "./sell-armed-display.js";
import { bankSkipHitchLearnShard } from "./vita/skip-hitch-learn.js";
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
const VIRTUAL = "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b";
/** Live VIRTUAL Uni V3 WETH pool (buy 0x33aac652). */
const VIRTUAL_POOL = "0x9c087eb773291e50cf6c6a90ef0f4500e349b903";
const CLANKER = "0x1bc0c42215582d5A085795f4baDbaC3ff36d1Bcb";
/** Live CLANKER Uni V3 WETH pool (buys 0x23d8a0c5 / 0xcb7dd5a6). */
const CLANKER_POOL = "0xc1a6FBedAE68E1472DbB91fe29b51F7A0bD44F97";

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

function depositLog(dst, amountWei) {
  return {
    address: WETH_BASE,
    topics: [WETH_DEPOSIT_TOPIC, padAddr(dst)],
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

/** Live VIRTUAL buy 0x33aac652 — native ETH via SwapRouter02 (nonce 6011). */
const VIRTUAL_ETH_WEI = 407247374272554n;
const VIRTUAL_TOK_WEI = 1641959873796611381n;

function virtualReceipt({ withTxValue = true } = {}) {
  return {
    receipt: {
      status: "0x1",
      transactionHash: EVIDENCE_BUY_TXS.VIRTUAL,
      gasUsed: "0x1a69f",
      effectiveGasPrice: "0x5b8d80",
      logs: [
        transferLog(VIRTUAL, VIRTUAL_POOL, WALLET, VIRTUAL_TOK_WEI),
        depositLog(SWAP_ROUTER02_BASE, VIRTUAL_ETH_WEI),
        transferLog(WETH_BASE, SWAP_ROUTER02_BASE, VIRTUAL_POOL, VIRTUAL_ETH_WEI),
      ],
    },
    tx: {
      hash: EVIDENCE_BUY_TXS.VIRTUAL,
      value: withTxValue ? `0x${VIRTUAL_ETH_WEI.toString(16)}` : "0x0",
    },
    tokenAddress: VIRTUAL,
    symbol: "VIRTUAL",
    wallet: WALLET,
  };
}

/** Live CLANKER buy 0x23d8a0c5 — WETH from wallet (nonce 6009). */
const CLANKER_ETH1_WEI = 812862739997724n;
const CLANKER_TOK1_WEI = 176300625186131008n;
/** Live CLANKER buy 0xcb7dd5a6 — WETH from wallet (nonce 6010). */
const CLANKER_ETH2_WEI = 520483887364034n;
const CLANKER_TOK2_WEI = 112885574807334430n;
const CLANKER_HASH1 = Array.isArray(EVIDENCE_BUY_TXS.CLANKER)
  ? EVIDENCE_BUY_TXS.CLANKER[0]
  : EVIDENCE_BUY_TXS.CLANKER;
const CLANKER_HASH2 = CLANKER_ADDON_BUY_TX;

function clankerReceipt(which = 1, { nativeEth = false } = {}) {
  const tok = which === 2 ? CLANKER_TOK2_WEI : CLANKER_TOK1_WEI;
  const eth = which === 2 ? CLANKER_ETH2_WEI : CLANKER_ETH1_WEI;
  const hash = which === 2 ? CLANKER_HASH2 : CLANKER_HASH1;
  const logs = nativeEth
    ? [
        transferLog(CLANKER, CLANKER_POOL, WALLET, tok),
        depositLog(SWAP_ROUTER02_BASE, eth),
        transferLog(WETH_BASE, SWAP_ROUTER02_BASE, CLANKER_POOL, eth),
      ]
    : [
        transferLog(CLANKER, CLANKER_POOL, WALLET, tok),
        transferLog(WETH_BASE, WALLET, CLANKER_POOL, eth),
      ];
  return {
    receipt: {
      status: "0x1",
      transactionHash: hash,
      logs,
    },
    tx: {
      hash,
      value: nativeEth ? `0x${eth.toString(16)}` : "0x0",
    },
    tokenAddress: CLANKER,
    symbol: "CLANKER",
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
    assert.equal(
      EVIDENCE_BUY_TXS.VIRTUAL,
      "0x33aac6524333e37244e12f21454c2aa485a227450272b4c9bdb7aa792cf85879",
    );
    assert.equal(
      CLANKER_HASH1,
      "0x23d8a0c5feaf55154abce99f2a395cc23fac26557170acc7b220b83dcf59a87b",
    );
    assert.equal(
      CLANKER_HASH2,
      "0xcb7dd5a6d9d7ea83f5f42e2e640795fa707c3987e959c57c68a7048ab42415f5",
    );
    assert.ok(Array.isArray(EVIDENCE_BUY_TXS.CLANKER));
    assert.ok(EVIDENCE_BUY_TXS.CLANKER.includes(CLANKER_HASH1));
    assert.ok(EVIDENCE_BUY_TXS.CLANKER.includes(CLANKER_HASH2));
    assert.equal(EVIDENCE_ADDON_BUY_TXS.CLANKER, CLANKER_ADDON_BUY_TX);
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

  it("rebuilds AERO / DRB / BNKR / VIRTUAL from buy receipt when persist is missing", () => {
    const rebuilt = rebuildLotsAfterRestart({
      persisted: {},
      remainingBySymbol: { AERO: 3.42, DRB: 8238, BNKR: 8449, VIRTUAL: 1.641959873796611381 },
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
        virtualReceipt(),
      ],
      tokens: [
        { symbol: "AERO", address: AERO },
        { symbol: "DRB", address: DRB },
        { symbol: "BNKR", address: BNKR },
        { symbol: "VIRTUAL", address: VIRTUAL },
      ],
    });
    assert.deepEqual(rebuilt.unknown, []);
    for (const sym of ["AERO", "DRB", "BNKR", "VIRTUAL"]) {
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
      remainingBySymbol: { AERO: 3.42, DRB: 8238, BNKR: 8449, VIRTUAL: 1.641959873796611381 },
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
        virtualReceipt({ withTxValue: false }),
      ],
      tokens: [
        { symbol: "AERO", address: AERO },
        { symbol: "DRB", address: DRB },
        { symbol: "BNKR", address: BNKR },
        { symbol: "VIRTUAL", address: VIRTUAL },
      ],
    });
    assert.deepEqual(rebuilt.unknown, []);
    for (const sym of ["AERO", "DRB", "BNKR", "VIRTUAL"]) {
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
    assert.ok(hashes.VIRTUAL.includes(EVIDENCE_BUY_TXS.VIRTUAL), "VIRTUAL fill-book hash must seed rebuild");
    assert.ok(hashes.CLANKER.includes(CLANKER_HASH1), "CLANKER first fill must seed rebuild");
    assert.ok(hashes.CLANKER.includes(CLANKER_HASH2), "CLANKER add-on fill must seed rebuild");
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
    assert.ok(src.includes("recordSellFill"), "sells persist rem cost");
    assert.ok(src.includes("lotFromSellReceipt"), "sealed sells rebuild from receipt");
    assert.ok(src.includes("mergeSellReceiptIntoLots"), "auto-append sell hashes");
    assert.ok(src.includes("classifySellArmedDisplay"), "green SELLING only when sendable");
    assert.ok(src.includes("bankSkipHitchLearnShard"), "SKIP_HITCH banks learn shard");
    assert.ok(src.includes("allowPartial: true"), "thrift partial unwrap");
    assert.ok(src.includes("OPERATOR_UNWRAP"), "desk unwrap latch");
    assert.ok(src.includes("autoUnwrapTowardCascadeFloor"), "auto gate uses thrift unwrap");
    const snapFn = src.indexOf("function buildEngineWaveRows");
    assert.ok(snapFn >= 0, "live /engine snapshot builder");
    const snapBody = src.slice(snapFn, src.indexOf("injectBotState", snapFn));
    assert.ok(snapBody.includes("classifySellArmedDisplay"), "snapshot recomputes green=sendable");
    assert.ok(snapBody.includes("sellArmed"), "snapshot passes sellArmed into classifyWavePhase");
    assert.ok(snapBody.includes("lastQuoterExecutable"), "snapshot uses last Quoter flag");
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

  it("cleared sold-all lot does not rematerialize #78 fills or trough", () => {
    const live = {};
    recordBuyFill(live, {
      symbol: "DRB",
      ethIn: 0.000785582981130297,
      tokensIn: 8238.193475842487,
      txHash: EVIDENCE_BUY_TXS.DRB,
      fillCostEth: 0.000785582981130297,
    });
    recordSellFill(live, { symbol: "DRB", remainingTokens: 0 });
    assert.equal(isClearedLot(live.DRB), true);
    assert.equal(shouldLatchBuyReceipt(live.DRB, EVIDENCE_BUY_TXS.DRB, { remainingTokens: 4100 }), false);
    assert.equal(shouldLatchBuyReceipt(live.DRB, DRB_TROUGH_BUY_TX, { remainingTokens: 4100 }), false);

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
    mergeBuyReceiptIntoLots(live, first, { remainingTokens: 4100 });
    mergeBuyReceiptIntoLots(live, trough, { remainingTokens: 4100 });
    assert.equal(isClearedLot(live.DRB), true);
    assert.equal(isUsableLot(live.DRB), false);

    const rebuilt = rebuildLotsAfterRestart({
      persisted: serializeFifoLots(live),
      remainingBySymbol: { DRB: 4100 },
      receipts: [drbReceipt(), drbTroughReceipt()],
      tokens: [{ symbol: "DRB", address: DRB }],
    });
    assert.ok(rebuilt.unknown.includes("DRB"));
    assert.equal(isUsableLot(rebuilt.lots.DRB), false);
    assert.equal(lotHasBuyTx(rebuilt.lots.DRB, EVIDENCE_BUY_TXS.DRB), false);
    assert.equal(lotHasBuyTx(rebuilt.lots.DRB, DRB_TROUGH_BUY_TX), false);
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

describe("fifo-lot-store — latch VIRTUAL FIFO from evidence buy 0x33aac652", () => {
  const VIRTUAL_REMAIN = Number(VIRTUAL_TOK_WEI) / 1e18;
  const VIRTUAL_ETH = Number(VIRTUAL_ETH_WEI) / 1e18;

  function latchVirtual(receiptRow) {
    const lot = lotFromBuyReceipt({
      symbol: "VIRTUAL",
      tokenAddress: VIRTUAL,
      wallet: WALLET,
      txHash: EVIDENCE_BUY_TXS.VIRTUAL,
      receipt: receiptRow.receipt,
      tx: receiptRow.tx,
    });
    const lots = {};
    mergeBuyReceiptIntoLots(lots, lot, { remainingTokens: VIRTUAL_REMAIN });
    return { lot, lots };
  }

  it("parses live native-ETH SwapRouter02 receipt (WETH from router, not wallet)", () => {
    const { lot, lots } = latchVirtual(virtualReceipt());
    assert.equal(isUsableLot(lot), true);
    assert.ok(Math.abs(lot.tokensIn - VIRTUAL_REMAIN) < 1e-12);
    assert.ok(Math.abs(lot.ethIn - VIRTUAL_ETH) < 1e-15, "ethIn from tx.value / Deposit, not invented");
    assert.equal(lotHasBuyTx(lots.VIRTUAL, EVIDENCE_BUY_TXS.VIRTUAL), true);
    assert.equal(lots.VIRTUAL.source, "onchain-receipt");
  });

  it("still latches when tx.value is missing — Deposit / router WETH is the ETH leg", () => {
    const half = lotFromBuyReceipt({
      symbol: "VIRTUAL",
      tokenAddress: VIRTUAL,
      wallet: WALLET,
      txHash: EVIDENCE_BUY_TXS.VIRTUAL,
      receipt: {
        status: "0x1",
        transactionHash: EVIDENCE_BUY_TXS.VIRTUAL,
        logs: [transferLog(VIRTUAL, VIRTUAL_POOL, WALLET, VIRTUAL_TOK_WEI)],
      },
      tx: { value: "0x0" },
    });
    assert.equal(half, null, "token-only log is not a lot");

    const { lot } = latchVirtual(virtualReceipt({ withTxValue: false }));
    assert.equal(isUsableLot(lot), true);
    assert.ok(Math.abs(lot.ethIn - VIRTUAL_ETH) < 1e-15, "Deposit/router WETH must prove ethIn");
    assert.ok(Math.abs(lot.tokensIn - VIRTUAL_REMAIN) < 1e-12);
  });

  it("does not double-count tx.value + Deposit + router WETH", () => {
    const { lot } = latchVirtual(virtualReceipt({ withTxValue: true }));
    assert.ok(lot.ethIn < VIRTUAL_ETH * 1.01);
    assert.ok(lot.ethIn > VIRTUAL_ETH * 0.99);
  });

  it("empty persist + evidence hash → known entrySold so always-plus can green", () => {
    assert.equal(
      shouldLatchBuyReceipt(undefined, EVIDENCE_BUY_TXS.VIRTUAL, { remainingTokens: VIRTUAL_REMAIN }),
      true,
    );
    const { lots } = latchVirtual(virtualReceipt({ withTxValue: false }));
    const token = { symbol: "VIRTUAL", unknownEntry: true, entryPrice: null, totalInvestedEth: 0 };
    const fifo = applyLotToToken(token, lots.VIRTUAL, { remainingTokens: VIRTUAL_REMAIN });
    assert.equal(fifo.unknown, false);
    assert.equal(token.unknownEntry, false);
    assert.ok(token.totalInvestedEth > 0);
    assert.equal(lotAppliedOk(token, fifo), true);
    const entrySold = sellEntryEthWithLotFloor(token.totalInvestedEth, token);
    assert.ok(entrySold > 0, "entrySold must be known — LOSE_ZERO cannot HOLD unknown");

    const red = plusGate({ symbol: "VIRTUAL", entryEth: entrySold, proceeds: entrySold * 0.7 });
    assert.equal(red.allow, false);
    assert.equal(red.verdict, "HOLD");

    const green = plusGate({
      symbol: "VIRTUAL",
      entryEth: entrySold,
      proceeds: entrySold + 9.60e-6,
    });
    assert.equal(green.allow, true, "Quoter green vs receipt cost must not HOLD unknown");
    assert.ok(green.verdict === "PLUS" || green.verdict === "SKIP_HITCH");
    assert.ok(green.leftover > 0);
  });

  it("agent.js hydrates VIRTUAL FIFO before unknown stamp and sell entrySold", () => {
    const src = readFileSync(join(root, "agent.js"), "utf8");
    const processFn = src.indexOf("async function processToken(");
    const processEnd = src.indexOf("\nasync function ", processFn + 1);
    const processBody = src.slice(processFn, processEnd > 0 ? processEnd : processFn + 12000);
    const rebuild = processBody.indexOf("tryRebuildLotFromReceipts");
    const unknown = processBody.indexOf("applyUnknownChainHolding");
    assert.ok(rebuild >= 0 && unknown > rebuild, "cycle must latch evidence FIFO before unknown stamp");

    const sellFn = src.indexOf("async function executeSell(");
    const sellEnd = src.indexOf("\nasync function ", sellFn + 1);
    const sellBody = src.slice(sellFn, sellEnd > 0 ? sellEnd : sellFn + 9000);
    assert.ok(sellBody.includes("applyLotToToken"), "executeSell must apply FIFO lot before entrySold");
    assert.ok(sellBody.includes("tryRebuildLotFromReceipts"), "executeSell must rebuild evidence buy when persist empty");
    assert.ok(sellBody.includes("hitchWaveOnSellLeftover"), "#119 WAVE hitch stays");
    assert.ok(sellBody.includes("gateLeftoverEth"), "WAVE leftover must not shadow fill leftoverEth");
    assert.equal((sellBody.match(/const leftoverEth/g) || []).length, 1, "only fill leftoverEth remains");
    assert.ok(!sellBody.includes("oneShot: true"), "WAVE_MIRROR_PAID one-shot stays off sell path");
    assert.ok(!/ALLOW_LOSSY_OPERATOR_SELL\s*=/.test(src), "VIRTUAL latch is not the lossy sell path");
    assert.ok(src.includes("EVIDENCE_BUY_TXS"), "evidence map stays imported");
    assert.ok(sellBody.includes("knownLotSellTokens"), "executeSell must cap amount to evidence lot tokensIn");
    assert.ok(sellBody.includes("pre-buy dust"), "known-lot cap must leave dust unsold / piggy");
  });

  it("remain/bought just over 1.02 with evidence lot + dust → known entrySold, sell capped to tokensIn", () => {
    const bought = Number(VIRTUAL_TOK_WEI) / 1e18;
    const remain = 1.67510;
    const ratio = remain / bought;
    assert.ok(ratio > 1.02, "wallet dust trips the default unknown-lots band");
    assert.ok(ratio < 1.025, "still evidence-dust, not a missing add-on");

    const { lots } = latchVirtual(virtualReceipt());
    assert.equal(lotIsEvidenceLatched(lots.VIRTUAL), true);
    assert.equal(knownLotSellTokens(lots.VIRTUAL, remain), lots.VIRTUAL.tokensIn);

    const token = { symbol: "VIRTUAL", unknownEntry: true, entryPrice: null, totalInvestedEth: 0 };
    const before = applyLotToToken(
      { symbol: "VIRTUAL", unknownEntry: true, entryPrice: null, totalInvestedEth: 0 },
      { ...lots.VIRTUAL, buyTxs: [] , source: "persisted" },
      { remainingTokens: remain },
    );
    assert.equal(before.unknown, true, "hashless persist still unknown-lots at 1.02018");

    const fifo = applyLotToToken(token, lots.VIRTUAL, { remainingTokens: remain });
    assert.equal(fifo.unknown, false, "evidence latch excludes pre-buy dust from remain/bought");
    assert.equal(token.unknownEntry, false);
    assert.ok(token.totalInvestedEth > 0);
    assert.equal(lotAppliedOk(token, fifo), true);
    const entrySold = sellEntryEthWithLotFloor(token.totalInvestedEth, token);
    assert.ok(entrySold > 0, "entrySold known — OPERATOR_SELL can fire under always-plus");

    const green = plusGate({
      symbol: "VIRTUAL",
      entryEth: entrySold,
      proceeds: entrySold + 9.60e-6,
    });
    assert.equal(green.allow, true);
    assert.ok(green.verdict === "PLUS" || green.verdict === "SKIP_HITCH");

    const red = plusGate({ symbol: "VIRTUAL", entryEth: entrySold, proceeds: entrySold * 0.7 });
    assert.equal(red.allow, false);
    assert.equal(red.verdict, "HOLD");
  });
});

describe("fifo-lot-store — latch CLANKER FIFO from evidence buys 0x23d8a0c5 + 0xcb7dd5a6", () => {
  const TOK1 = Number(CLANKER_TOK1_WEI) / 1e18;
  const TOK2 = Number(CLANKER_TOK2_WEI) / 1e18;
  const ETH1 = Number(CLANKER_ETH1_WEI) / 1e18;
  const ETH2 = Number(CLANKER_ETH2_WEI) / 1e18;
  const BOUGHT = TOK1 + TOK2;
  const ETH_IN = ETH1 + ETH2;
  /** Live wallet rem matches both fills — no pre-buy dust. */
  const LIVE_REMAIN = Number(CLANKER_TOK1_WEI + CLANKER_TOK2_WEI) / 1e18;

  function parseClanker(which, opts) {
    const row = clankerReceipt(which, opts);
    return lotFromBuyReceipt({
      symbol: "CLANKER",
      tokenAddress: CLANKER,
      wallet: WALLET,
      txHash: which === 2 ? CLANKER_HASH2 : CLANKER_HASH1,
      receipt: row.receipt,
      tx: row.tx,
    });
  }

  function latchBoth({ nativeEth = false, remainingTokens = LIVE_REMAIN } = {}) {
    const lots = {};
    const first = parseClanker(1, { nativeEth });
    mergeBuyReceiptIntoLots(lots, first, { remainingTokens });
    const second = parseClanker(2, { nativeEth });
    mergeBuyReceiptIntoLots(lots, second, { remainingTokens });
    return { lots, first, second };
  }

  it("parses live WETH-from-wallet receipts (CLANKER in, WETH out of wallet)", () => {
    const first = parseClanker(1);
    assert.equal(isUsableLot(first), true);
    assert.ok(Math.abs(first.tokensIn - TOK1) < 1e-12);
    assert.ok(Math.abs(first.ethIn - ETH1) < 1e-15, "ethIn from wallet WETH, not invented");
    const second = parseClanker(2);
    assert.equal(isUsableLot(second), true);
    assert.ok(Math.abs(second.tokensIn - TOK2) < 1e-12);
    assert.ok(Math.abs(second.ethIn - ETH2) < 1e-15);
  });

  it("native-ETH Deposit / router-out still latches (VIRTUAL class parser)", () => {
    const first = parseClanker(1, { nativeEth: true });
    assert.equal(isUsableLot(first), true);
    assert.ok(Math.abs(first.ethIn - ETH1) < 1e-15);
    assert.ok(Math.abs(first.tokensIn - TOK1) < 1e-12);
    const missingEth = lotFromBuyReceipt({
      symbol: "CLANKER",
      tokenAddress: CLANKER,
      wallet: WALLET,
      txHash: CLANKER_HASH1,
      receipt: {
        status: "0x1",
        transactionHash: CLANKER_HASH1,
        logs: [transferLog(CLANKER, CLANKER_POOL, WALLET, CLANKER_TOK1_WEI)],
      },
      tx: { value: "0x0" },
    });
    assert.equal(missingEth, null, "token-only log is not a lot");
  });

  it("does not double-count tx.value + Deposit + wallet WETH", () => {
    const first = parseClanker(1, { nativeEth: true });
    assert.ok(first.ethIn < ETH1 * 1.01);
    assert.ok(first.ethIn > ETH1 * 0.99);
  });

  it("first fill alone vs ~0.289 rem is unknown-lots until add-on merges", () => {
    const first = parseClanker(1);
    const token = { symbol: "CLANKER", unknownEntry: true, entryPrice: null, totalInvestedEth: 0 };
    const before = applyLotToToken(token, first, { remainingTokens: LIVE_REMAIN });
    assert.equal(before.unknown, true, "remain >> first tokensIn must be unknown-lots");
    assert.equal(before.reason, "unknown-lots");

    const { lots } = latchBoth();
    assert.equal(lotHasBuyTx(lots.CLANKER, CLANKER_HASH1), true);
    assert.equal(lotHasBuyTx(lots.CLANKER, CLANKER_HASH2), true);
    assert.ok(Math.abs(lots.CLANKER.tokensIn - BOUGHT) < 1e-12);
    assert.ok(Math.abs(lots.CLANKER.ethIn - ETH_IN) < 1e-15);
    const known = { symbol: "CLANKER", unknownEntry: true, entryPrice: null, totalInvestedEth: 0 };
    const fifo = applyLotToToken(known, lots.CLANKER, { remainingTokens: LIVE_REMAIN });
    assert.equal(fifo.unknown, false);
    assert.equal(known.unknownEntry, false);
    assert.ok(Math.abs(known.totalInvestedEth - ETH_IN) < 1e-12);
    assert.equal(lotAppliedOk(known, fifo), true);
  });

  it("empty persist + both evidence hashes → known entrySold so always-plus can green", () => {
    assert.equal(
      shouldLatchBuyReceipt(undefined, CLANKER_HASH1, { remainingTokens: LIVE_REMAIN }),
      true,
    );
    const { lots } = latchBoth();
    assert.equal(
      shouldLatchBuyReceipt(lots.CLANKER, CLANKER_HASH2, { remainingTokens: LIVE_REMAIN }),
      false,
      "already latched add-on must not double-merge",
    );
    assert.equal(isEvidenceSiblingBuyTx("CLANKER", CLANKER_HASH2), true);
    assert.equal(isEvidenceSiblingBuyTx("CLANKER", CLANKER_HASH1), false);

    const token = { symbol: "CLANKER", unknownEntry: true, entryPrice: null, totalInvestedEth: 0 };
    const fifo = applyLotToToken(token, lots.CLANKER, { remainingTokens: LIVE_REMAIN });
    assert.equal(fifo.unknown, false);
    const entrySold = sellEntryEthWithLotFloor(token.totalInvestedEth, token);
    assert.ok(entrySold > 0, "entrySold must be known — LOSE_ZERO cannot HOLD unknown");

    const red = plusGate({ symbol: "CLANKER", entryEth: entrySold, proceeds: entrySold * 0.7 });
    assert.equal(red.allow, false);
    assert.equal(red.verdict, "HOLD");

    const green = plusGate({
      symbol: "CLANKER",
      entryEth: entrySold,
      proceeds: entrySold + 9.60e-6,
    });
    assert.equal(green.allow, true, "Quoter green vs receipt cost must not HOLD unknown");
    assert.ok(green.verdict === "PLUS" || green.verdict === "SKIP_HITCH");
    assert.ok(green.leftover > 0);
  });

  it("live rem matches bought — piggy dust stays 0; synthetic extra stays piggy", () => {
    const { lots } = latchBoth();
    latchPiggyDust(lots.CLANKER, LIVE_REMAIN);
    assert.equal(Number(lots.CLANKER.piggyDustTokens) || 0, 0, "no pre-buy dust on live rem");
    assert.ok(Math.abs(LIVE_REMAIN - lots.CLANKER.tokensIn) < 1e-15, "live rem matches bought");
    assert.equal(
      knownLotSellTokens(lots.CLANKER, lots.CLANKER.tokensIn),
      lots.CLANKER.tokensIn,
    );

    const dustyRemain = lots.CLANKER.tokensIn * 1.021;
    const ratio = dustyRemain / lots.CLANKER.tokensIn;
    assert.ok(ratio > 1.02 && ratio < 1.025, "tiny extra is evidence dust, not a missing add-on");
    latchPiggyDust(lots.CLANKER, dustyRemain);
    assert.ok(lots.CLANKER.piggyDustTokens >= dustyRemain - lots.CLANKER.tokensIn - 1e-12);
    assert.equal(knownLotSellTokens(lots.CLANKER, dustyRemain), lots.CLANKER.tokensIn);

    const token = { symbol: "CLANKER", unknownEntry: true, entryPrice: null, totalInvestedEth: 0 };
    const fifo = applyLotToToken(token, lots.CLANKER, { remainingTokens: dustyRemain });
    assert.equal(fifo.unknown, false, "evidence latch excludes pre-buy dust from remain/bought");
    const red = plusGate({ symbol: "CLANKER", entryEth: token.totalInvestedEth, proceeds: token.totalInvestedEth * 0.7 });
    assert.equal(red.allow, false);
    assert.equal(red.verdict, "HOLD");
  });

  it("rebuild after restart merges both hashes so always-plus can still green", () => {
    const rebuilt = rebuildLotsAfterRestart({
      persisted: {},
      remainingBySymbol: { CLANKER: LIVE_REMAIN },
      receipts: [clankerReceipt(1), clankerReceipt(2)],
      tokens: [{ symbol: "CLANKER", address: CLANKER }],
    });
    assert.deepEqual(rebuilt.unknown, []);
    assert.ok(rebuilt.rebuilt.includes("CLANKER"));
    assert.equal(rebuilt.applied.CLANKER.unknownEntry, false);
    assert.ok(Math.abs(rebuilt.applied.CLANKER.totalInvestedEth - ETH_IN) < 1e-11);
    assert.equal(lotHasBuyTx(rebuilt.lots.CLANKER, CLANKER_HASH1), true);
    assert.equal(lotHasBuyTx(rebuilt.lots.CLANKER, CLANKER_HASH2), true);
    const hashes = collectRebuildTxs({ persistedLots: rebuilt.lots });
    assert.ok(hashes.CLANKER.includes(CLANKER_HASH1));
    assert.ok(hashes.CLANKER.includes(CLANKER_HASH2));
  });

  it("agent.js hydrates CLANKER FIFO before unknown stamp; WAVE hitch stays", () => {
    const src = readFileSync(join(root, "agent.js"), "utf8");
    assert.ok(src.includes("EVIDENCE_BUY_TXS"), "evidence map stays imported");
    assert.ok(src.includes("tryRebuildLotFromReceipts"));
    assert.ok(src.includes("mergeBuyReceiptIntoLots"));
    const processFn = src.indexOf("async function processToken(");
    const processEnd = src.indexOf("\nasync function ", processFn + 1);
    const processBody = src.slice(processFn, processEnd > 0 ? processEnd : processFn + 12000);
    const rebuild = processBody.indexOf("tryRebuildLotFromReceipts");
    const unknown = processBody.indexOf("applyUnknownChainHolding");
    assert.ok(rebuild >= 0 && unknown > rebuild, "cycle must latch evidence FIFO before unknown stamp");
    const sellFn = src.indexOf("async function executeSell(");
    const sellEnd = src.indexOf("\nasync function ", sellFn + 1);
    const sellBody = src.slice(sellFn, sellEnd > 0 ? sellEnd : sellFn + 9000);
    assert.ok(sellBody.includes("tryRebuildLotFromReceipts"));
    assert.ok(sellBody.includes("knownLotSellTokens"));
    assert.ok(sellBody.includes("hitchWaveOnSellLeftover"), "#119 WAVE hitch stays");
    assert.ok(!/ALLOW_LOSSY_OPERATOR_SELL\s*=/.test(src), "CLANKER latch is not the lossy sell path");
  });
});

describe("fifo-lot-store — partial VIRTUAL sell rem cost + dust piggy", () => {
  const BUY_ETH = 0.000407247374272554;
  const BUY_TOK = 1.641959873796611;
  const SOLD_TOK = 0.34732176459228256;
  const SOLD_WETH = 0.000090206411822417;
  const ONCHAIN_REM = 1.3277735025554778;
  const DUST = ONCHAIN_REM - (BUY_TOK - SOLD_TOK);
  const KNOWN_REM = BUY_TOK - SOLD_TOK;
  const REM_COST = BUY_ETH * KNOWN_REM / BUY_TOK;
  /** Test fixture hash — live sealed prefix is 0x659db825…; do not invent the rest. */
  const SELL_HASH = "0x2222222222222222222222222222222222222222222222222222222222222222";

  function virtualSellReceipt() {
    const tokWei = BigInt(Math.round(SOLD_TOK * 1e18));
    const wethWei = BigInt(Math.round(SOLD_WETH * 1e18));
    return {
      receipt: {
        status: "0x1",
        transactionHash: SELL_HASH,
        logs: [
          transferLog(VIRTUAL, WALLET, VIRTUAL_POOL, tokWei),
          transferLog(WETH_BASE, VIRTUAL_POOL, WALLET, wethWei),
        ],
      },
      tx: { hash: SELL_HASH, value: "0x0" },
      tokenAddress: VIRTUAL,
      symbol: "VIRTUAL",
      wallet: WALLET,
    };
  }

  it("partial sell persists proportional rem cost; dust piggy does not wipe known lot", () => {
    assert.ok(DUST > 0.033 && DUST < 0.034, "pre-buy dust ~0.033135");
    const lots = {};
    recordBuyFill(lots, {
      symbol: "VIRTUAL",
      ethIn: BUY_ETH,
      tokensIn: BUY_TOK,
      txHash: EVIDENCE_BUY_TXS.VIRTUAL,
      fillCostEth: BUY_ETH,
      reason: "MANUAL BUY (operator)",
    });
    latchPiggyDust(lots.VIRTUAL, BUY_TOK + DUST);
    recordSellFill(lots, {
      symbol: "VIRTUAL",
      tokensSold: SOLD_TOK,
      txHash: SELL_HASH,
      ethOut: SOLD_WETH,
      piggyDustTokens: DUST,
    });
    assert.ok(Math.abs(lots.VIRTUAL.tokensIn - KNOWN_REM) < 1e-9);
    assert.ok(Math.abs(lots.VIRTUAL.remainingCostEth - REM_COST) < 1e-12);
    assert.ok(lots.VIRTUAL.piggyDustTokens >= DUST - 1e-9);
    assert.equal(lotHasSellTx(lots.VIRTUAL, SELL_HASH), true);
    assert.ok(lotOriginalTokensIn(lots.VIRTUAL) >= BUY_TOK - 1e-9);

    const token = { symbol: "VIRTUAL", unknownEntry: true, entryPrice: null, totalInvestedEth: 0 };
    const fifo = applyLotToToken(token, lots.VIRTUAL, { remainingTokens: ONCHAIN_REM });
    assert.equal(fifo.unknown, false, "on-chain rem + dust must not unknown the known slice");
    assert.equal(token.unknownEntry, false);
    assert.ok(Math.abs(token.totalInvestedEth - REM_COST) < 1e-12);
    assert.equal(lotAppliedOk(token, fifo), true);
    assert.equal(knownLotSellTokens(lots.VIRTUAL, ONCHAIN_REM), lots.VIRTUAL.tokensIn);

    const green = plusGate({
      symbol: "VIRTUAL",
      entryEth: token.totalInvestedEth,
      proceeds: token.totalInvestedEth * 2,
    });
    assert.equal(green.allow, true, "always-plus greens rem lot when quote is plus");
    assert.equal(green.verdict, "PLUS", "fat green quote must be PLUS not SKIP_HITCH");
    const selling = classifySellArmedDisplay({
      peakWantsSell: true,
      quoterExecutable: true,
      verdict: green.verdict,
      allow: green.allow,
      unknownEntry: token.unknownEntry,
      reason: green.log || green.reason || "",
    });
    assert.equal(selling.green, true);
    assert.equal(selling.label, "SELLING");

    const red = plusGate({
      symbol: "VIRTUAL",
      entryEth: token.totalInvestedEth,
      proceeds: token.totalInvestedEth * 0.7,
    });
    assert.equal(red.allow, false);
    assert.equal(red.verdict, "HOLD");
  });

  it("auto-appends sealed sell hash onto the book via receipt merge", () => {
    const lots = {};
    recordBuyFill(lots, {
      symbol: "VIRTUAL",
      ethIn: BUY_ETH,
      tokensIn: BUY_TOK,
      txHash: EVIDENCE_BUY_TXS.VIRTUAL,
      fillCostEth: BUY_ETH,
    });
    const row = virtualSellReceipt();
    const sold = lotFromSellReceipt({
      symbol: "VIRTUAL",
      tokenAddress: VIRTUAL,
      wallet: WALLET,
      txHash: SELL_HASH,
      receipt: row.receipt,
      tx: row.tx,
    });
    assert.ok(sold);
    assert.ok(Math.abs(sold.tokensSold - SOLD_TOK) < 1e-8);
    assert.ok(Math.abs(sold.ethOut - SOLD_WETH) < 1e-12);
    mergeSellReceiptIntoLots(lots, sold, { remainingTokens: ONCHAIN_REM });
    assert.equal(lotHasSellTx(lots.VIRTUAL, SELL_HASH), true);
    mergeSellReceiptIntoLots(lots, sold, { remainingTokens: ONCHAIN_REM });
    assert.equal(lots.VIRTUAL.sellTxs.filter((s) => s.hash === SELL_HASH).length, 1);
    const token = { symbol: "VIRTUAL", unknownEntry: true, entryPrice: null, totalInvestedEth: 0 };
    const fifo = applyLotToToken(token, lots.VIRTUAL, { remainingTokens: ONCHAIN_REM });
    assert.equal(fifo.unknown, false);
    assert.ok(token.totalInvestedEth > 0);
  });

  it("rebuild after restart applies persisted rem cost so always-plus can still green", () => {
    const live = {};
    recordBuyFill(live, {
      symbol: "VIRTUAL",
      ethIn: BUY_ETH,
      tokensIn: BUY_TOK,
      txHash: EVIDENCE_BUY_TXS.VIRTUAL,
      fillCostEth: BUY_ETH,
    });
    recordSellFill(live, {
      symbol: "VIRTUAL",
      tokensSold: SOLD_TOK,
      txHash: SELL_HASH,
      ethOut: SOLD_WETH,
      piggyDustTokens: DUST,
    });
    const rebuilt = rebuildLotsAfterRestart({
      persisted: serializeFifoLots(live),
      remainingBySymbol: { VIRTUAL: ONCHAIN_REM },
    });
    assert.deepEqual(rebuilt.unknown, []);
    assert.ok(rebuilt.rebuilt.includes("VIRTUAL"));
    assert.equal(rebuilt.applied.VIRTUAL.unknownEntry, false);
    assert.ok(Math.abs(rebuilt.applied.VIRTUAL.totalInvestedEth - REM_COST) < 1e-11);
    const hashes = collectRebuildSellTxs({ persistedLots: rebuilt.lots });
    assert.ok(hashes.VIRTUAL.includes(SELL_HASH));
  });

  it("green SELLING only when quoter-executable AND always-plus PLUS", () => {
    const selling = classifySellArmedDisplay({
      peakWantsSell: true,
      quoterExecutable: true,
      verdict: "PLUS",
      allow: true,
      unknownEntry: false,
    });
    assert.equal(selling.green, true);
    assert.equal(selling.label, "SELLING");
    assert.equal(selling.code, null);

    const fifoHold = classifySellArmedDisplay({
      peakWantsSell: true,
      quoterExecutable: true,
      verdict: "HOLD",
      allow: false,
      unknownEntry: false,
      reason: "LOSE_ZERO: hold sell VIRTUAL leftover after fees ≤ 0 — FIFO red",
    });
    assert.equal(fifoHold.green, false);
    assert.equal(fifoHold.code, "FIFO_RED");
    assert.match(fifoHold.label, /HOLD FIFO_RED/);

    const unknown = classifySellArmedDisplay({
      peakWantsSell: true,
      quoterExecutable: true,
      verdict: "HOLD",
      allow: false,
      unknownEntry: true,
      reason: "unknown cost — cannot prove plus vs entry",
    });
    assert.equal(unknown.code, "UNKNOWN_COST");

    const skip = classifySellArmedDisplay({
      peakWantsSell: true,
      quoterExecutable: true,
      verdict: "SKIP_HITCH",
      allow: true,
      unknownEntry: false,
    });
    assert.equal(skip.green, false);
    assert.equal(skip.code, "SKIP_HITCH");

    const thin = classifySellArmedDisplay({
      peakWantsSell: true,
      quoterExecutable: false,
      verdict: "PLUS",
      allow: true,
      unknownEntry: false,
    });
    assert.equal(thin.code, "THIN_LIQUID");
    assert.equal(thin.green, false);

    const engineHtml = readFileSync(join(root, "public/engine.html"), "utf8");
    assert.ok(engineHtml.includes("phase.PEAK.hold"), "engine UI paints HOLD not armed SELLING");
    assert.ok(engineHtml.includes("holdCode"), "engine snapshot dump keeps holdCode");
    const boardHtml = readFileSync(join(root, "public/board.html"), "utf8");
    assert.ok(boardHtml.includes("w.phase?.label || w.phase?.phase"), "hub board prefers HOLD label over PEAK");
  });

  it("SKIP_HITCH uncovered leftover banks learn shard and does not unpaired burn", () => {
    const shard = bankSkipHitchLearnShard({
      symbol: "VIRTUAL",
      leftoverEth: 1e-8,
      hitchWouldEth: 4e-6,
      reason: "SKIP_HITCH leftover too thin",
    });
    assert.equal(shard.banked, true);
    assert.equal(shard.burned, false);
    assert.equal(shard.unpairedBurn, false);
    assert.equal(shard.hitchWhenCovered, true);
    assert.equal(shard.motherBrain, "untouched");
    assert.equal(shard.uncovered, true);
  });

  it("mother brain DIFF ZERO vs main", () => {
    const frozen = [
      "vita-memory.js",
      "memory-engine.js",
      "vita/mainframe.js",
      "vita/ORIGINAL_FORMULA.md",
      "vita/anchors.json",
      "vita/mother-genesis.js",
      "vita/FILING.md",
      "vita/AGENTS.md",
    ];
    for (const f of frozen) {
      let diff = "";
      try {
        diff = execSync("git diff main -- " + f, { encoding: "utf8", cwd: root });
      } catch {
        diff = execSync("git diff origin/main -- " + f, { encoding: "utf8", cwd: root });
      }
      assert.equal(diff, "", f + " must stay untouched vs main");
    }
  });
});

