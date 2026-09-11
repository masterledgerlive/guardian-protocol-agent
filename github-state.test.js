import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveGithubToken,
  resolveGithubRepo,
  githubAuthHeaders,
  githubContentsUrl,
  shouldRetryGithubRead,
  githubReadDenied,
} from "./github-state.js";
import {
  EVIDENCE_BUY_TXS,
  rebuildLotsAfterRestart,
  isUsableLot,
  isClearedLot,
  lotAppliedOk,
  recordBuyFill,
  recordSellFill,
  serializeFifoLots,
  shouldRebuildLotFromReceipts,
} from "./fifo-lot-store.js";
import { fifoRemainingCostEth, buildSellGateDecision } from "./lose-zero-gate.js";

const root = dirname(fileURLToPath(import.meta.url));

const WALLET = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const WETH = "0x4200000000000000000000000000000000000006";

function padAddr(addr) {
  return `0x${"0".repeat(24)}${addr.slice(2).toLowerCase()}`;
}

describe("github-state — Contents auth matches live githubGet", () => {
  it("uses token prefix, not Bearer (401 class)", () => {
    const h = githubAuthHeaders({ GITHUB_TOKEN: "ghp_live" });
    assert.equal(h.Authorization, "token ghp_live");
    assert.ok(!String(h.Authorization).toLowerCase().startsWith("bearer"));
  });

  it("reads GITHUB_TOKEN at call time and strips a duplicated scheme", () => {
    assert.equal(resolveGithubToken({ GITHUB_TOKEN: "  Bearer ghp_x  " }), "ghp_x");
    assert.equal(resolveGithubToken({ GITHUB_TOKEN: "token ghp_x" }), "ghp_x");
    assert.equal(resolveGithubToken({ GH_TOKEN: "ghp_alt" }), "ghp_alt");
  });

  it("builds repos/${GITHUB_REPO}/contents/path like githubGet", () => {
    const url = githubContentsUrl("fifo-lots.json", {
      repo: "masterledgerlive/guardian-protocol-agent",
      branch: "bot-state",
      cacheBust: false,
    });
    assert.equal(
      url,
      "https://api.github.com/repos/masterledgerlive/guardian-protocol-agent/contents/fifo-lots.json?ref=bot-state",
    );
    assert.ok(!url.includes("/repos//"));
  });

  it("does not retry 401/403 (ledger 401×3 blocker)", () => {
    assert.equal(shouldRetryGithubRead(401), false);
    assert.equal(shouldRetryGithubRead(403), false);
    assert.equal(shouldRetryGithubRead(404), true);
    assert.equal(githubReadDenied(401), true);
  });

  it("agent.js wires token auth + evidence rebuild after GitHub deny", () => {
    const src = readFileSync(join(root, "agent.js"), "utf8");
    assert.ok(src.includes('from "./github-state.js"'));
    assert.ok(src.includes("githubAuthHeaders"));
    assert.ok(src.includes("githubContentsUrl"));
    assert.ok(src.includes("rebuildEvidenceLotsAfterGithubDeny"));
    assert.ok(src.includes("hasLatchedFifoCost"));
    assert.ok(src.includes("shouldRetryGithubRead"));
    assert.ok(src.includes("shouldRebuildLotFromReceipts"));
    assert.ok(src.includes("isClearedLot"));
    assert.ok(!/githubGetFromBranch[\s\S]{0,800}Bearer \$\{/.test(src), "ledger read must not use Bearer");
    assert.ok(!/githubSaveToState[\s\S]{0,800}Bearer \$\{/.test(src), "ledger write must not use Bearer");
  });
});

describe("GitHub 401 — seeded AERO/DRB/BNKR buy hashes still rebuild", () => {
  it("empty persist (401) still latches FIFO from evidence receipts", () => {
    const github401 = { status: 401, content: null };
    assert.equal(githubReadDenied(github401.status), true);

    const aeroTok = 3426611425491222000n;
    const aeroEth = 786757301107754n;
    const receipt = {
      status: "success",
      transactionHash: EVIDENCE_BUY_TXS.AERO,
      logs: [
        {
          address: AERO,
          topics: [TRANSFER, padAddr("0x3d5D143381916280ff91407FeBEB52f2b60f33Cf"), padAddr(WALLET)],
          data: `0x${aeroTok.toString(16).padStart(64, "0")}`,
        },
        {
          address: WETH,
          topics: [TRANSFER, padAddr(WALLET), padAddr("0x2626664c2603336E57B271c5C0b26F421741e481")],
          data: `0x${aeroEth.toString(16).padStart(64, "0")}`,
        },
      ],
    };

    const rebuilt = rebuildLotsAfterRestart({
      persisted: {},
      remainingBySymbol: { AERO: 3.426611425491222 },
      receipts: [{
        symbol: "AERO",
        tokenAddress: AERO,
        wallet: WALLET,
        txHash: EVIDENCE_BUY_TXS.AERO,
        receipt,
        tx: { value: "0x0" },
        reason: "MANUAL BUY (operator) $2",
      }],
    });
    assert.ok(isUsableLot(rebuilt.lots.AERO));
    const token = rebuilt.applied.AERO;
    assert.equal(lotAppliedOk(token, { unknown: false, investedEth: token.totalInvestedEth }), true);
    const fifo = fifoRemainingCostEth({
      ethIn: rebuilt.lots.AERO.ethIn,
      tokensIn: rebuilt.lots.AERO.tokensIn,
      remainingTokens: 3.426611425491222,
    });
    assert.equal(fifo.unknown, false);
    const d = buildSellGateDecision({
      symbol: "AERO",
      reason: "🎯 PEAK RIDE",
      sellPct: 1,
      entryEth: fifo.investedEth,
      lotCostEth: fifo.investedEth,
      usdMarkProceedsEth: fifo.investedEth * 1.2,
      operatorLot: true,
      freshLot: true,
      projectedProceedsEth: fifo.investedEth * 1.2,
      feePct: 0,
      gasCostEth: 0,
      gwei: 0.05,
    });
    assert.equal(d.allow, true);
    assert.ok(d.verdict === "PLUS" || d.verdict === "SKIP_HITCH");
  });

  it("sold-all tombstone + zero bal does not resurrect AERO evidence hash", () => {
    const sold = {};
    recordBuyFill(sold, {
      symbol: "AERO",
      ethIn: 0.000787,
      tokensIn: 3.4266,
      txHash: EVIDENCE_BUY_TXS.AERO,
      fillCostEth: 0.000787,
      reason: "MANUAL BUY (operator) $2",
    });
    recordSellFill(sold, { symbol: "AERO", remainingTokens: 0 });
    assert.equal(isClearedLot(sold.AERO), true);
    assert.equal(shouldRebuildLotFromReceipts(sold.AERO, 0), false);

    const resurrect = rebuildLotsAfterRestart({
      persisted: serializeFifoLots(sold),
      remainingBySymbol: { AERO: 0 },
      receipts: [{
        symbol: "AERO",
        tokenAddress: AERO,
        wallet: WALLET,
        txHash: EVIDENCE_BUY_TXS.AERO,
        receipt: {
          status: "success",
          transactionHash: EVIDENCE_BUY_TXS.AERO,
          logs: [
            {
              address: AERO,
              topics: [TRANSFER, padAddr("0x3d5D143381916280ff91407FeBEB52f2b60f33Cf"), padAddr(WALLET)],
              data: `0x${(3426611425491222000n).toString(16).padStart(64, "0")}`,
            },
            {
              address: WETH,
              topics: [TRANSFER, padAddr(WALLET), padAddr("0x2626664c2603336E57B271c5C0b26F421741e481")],
              data: `0x${(786757301107754n).toString(16).padStart(64, "0")}`,
            },
          ],
        },
        tx: { value: "0x0" },
        reason: "MANUAL BUY (operator) $2",
      }],
    });
    assert.equal(isUsableLot(resurrect.lots.AERO), false);
    assert.equal(isClearedLot(resurrect.lots.AERO), true);
  });
});
