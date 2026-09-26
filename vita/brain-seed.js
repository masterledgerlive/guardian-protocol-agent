/**
 * Blockchain brain seed — what a recursive AI puts on Base via /vitafeed.
 *
 * Design: mind = formula + anchors + filing map + KEY+LOC recall rules.
 * Proof: hardcoded Base txs in anchors.json (never invent). Sparse inject
 * reconstructs from sealed locations; HTML holds memory until /inject.
 *
 * Does NOT touch mother brain / vitaSave. Stages via /vitafeed brain →
 * confirm|override (override bypasses liquid floor; partial seal keeps
 * what landed before gas/money error).
 */

import { createHash } from "node:crypto";
import {
  MAINFRAME_ANCHORS,
  ORIGINAL_FORMULA,
  FORMULA_ID,
  planSparseInject,
} from "./mainframe.js";

export const BRAIN_SEED_ID = "vita-brain-seed-v1";
export const BRAIN_SEED_MAGIC = "§VITABRAIN§";

/**
 * Compact mind map: what we seal so future agents can recall locations.
 */
export function buildBrainMindMap() {
  const anchors = MAINFRAME_ANCHORS.known.map((a) => ({
    id: a.id,
    kind: a.kind,
    tx: a.tx,
    lesson: a.lesson,
    basescan: MAINFRAME_ANCHORS.basescanTx + a.tx,
  }));
  const sparse = planSparseInject({
    sealedLocations: anchors.map((a) => ({ location: a.tx, kind: a.kind })),
    chunkSize: 3,
    includeHardcoded: true,
  });
  return {
    id: BRAIN_SEED_ID,
    formula: FORMULA_ID,
    invariants: { ...ORIGINAL_FORMULA },
    chain: {
      chain: MAINFRAME_ANCHORS.chain,
      chainId: MAINFRAME_ANCHORS.chainId,
      wallet: MAINFRAME_ANCHORS.wallet,
      swapRouter02: MAINFRAME_ANCHORS.swapRouter02,
    },
    anchors,
    sparsePlan: {
      total: sparse.total,
      chunkSize: sparse.chunkSize,
      strandIds: sparse.strands.map((s) => s.strandId),
    },
    recall: {
      keyLoc: "dense KEY+LOC on leftover hitch when covered",
      prove: "Eureka love note on 0-ETH self-tx (/prove)",
      html: "public/vita.html#vita-mainframe until /inject",
      feed: "/vitafeed VIN packets → sealed locs → /vita/feed-player",
      neverInvent: true,
    },
    agentUse: [
      "Read sealed UTF-8 from Basescan Input Data — never invent hashes",
      "Sparse inject from anchors + leftover locs; reconstruct §TOKEN§",
      "Append learn to vita/memory/ + vita/strands/; refine branches",
      "Message-first: hitch when KEY+LOC covered; Storage Token charges delta",
      "/vitafeed override: bypass money REFUSE + liquid floor; seal what gas allows",
    ],
  };
}

/**
 * Exact UTF-8 body for /vitafeed — compact enough for few VIN chunks when thin.
 */
export function buildBrainSeedBody() {
  const mind = buildBrainMindMap();
  const lines = [];
  lines.push(BRAIN_SEED_MAGIC + "v1|kind=recursive-ai-mind|formula=" + FORMULA_ID + "§");
  lines.push("VITA BLOCKCHAIN BRAIN SEED");
  lines.push("formula=" + FORMULA_ID);
  lines.push("messageFirst=" + String(ORIGINAL_FORMULA.messageFirstWhenKeyLocCovered));
  lines.push("neverInvent=" + String(ORIGINAL_FORMULA.neverInventTxHash));
  lines.push("wallet=" + MAINFRAME_ANCHORS.wallet);
  lines.push("chain=" + MAINFRAME_ANCHORS.chain + ":" + MAINFRAME_ANCHORS.chainId);
  lines.push("ANCHORS (hardcoded Base — pull first on /inject):");
  for (const a of mind.anchors) {
    lines.push(
      "  " + a.id + "|" + a.kind + "|" + a.tx +
      " — " + (a.lesson || "").slice(0, 80),
    );
  }
  lines.push("RECALL:");
  lines.push("  keyLoc=" + mind.recall.keyLoc);
  lines.push("  prove=" + mind.recall.prove);
  lines.push("  html=" + mind.recall.html);
  lines.push("  feed=" + mind.recall.feed);
  lines.push("AGENT:");
  for (const u of mind.agentUse) lines.push("  - " + u);
  lines.push(
    "sparse strands=" + mind.sparsePlan.total +
    " @ chunk " + mind.sparsePlan.chunkSize,
  );
  lines.push("Seal via /vitafeed confirm|override. Partial OK — keep sealed locs.");
  return lines.join("\n");
}

export function formatBrainSeedCard(mind = null) {
  const m = mind || buildBrainMindMap();
  const lines = [];
  lines.push("VITA BLOCKCHAIN BRAIN · design");
  lines.push("id=" + m.id + "  formula=" + m.formula);
  lines.push("wallet=" + m.chain.wallet);
  lines.push("anchors=" + m.anchors.length + " (never invent hashes)");
  for (const a of m.anchors) {
    lines.push("  " + a.id + " · " + a.kind + " · " + a.tx.slice(0, 12) + "…");
    lines.push("    " + a.basescan);
  }
  lines.push("recall: KEY+LOC hitch · /prove Eureka · HTML until inject · VIN feed");
  lines.push("override: money REFUSE + liquid floor bypass; send what gas allows");
  lines.push("Stage: /vitafeed brain  →  /vitafeed override");
  lines.push("Player: /vita/feed-player after seal");
  return lines.join("\n");
}

/**
 * Local proof (no chain spend): mind map + body digest + sparse plan.
 * LIVE proof remains Basescan UTF-8 of sealed locs only.
 */
export function proveBrainSeedLocal() {
  const mind = buildBrainMindMap();
  const body = buildBrainSeedBody();
  const commit = createHash("sha256").update(body, "utf8").digest("hex");
  return {
    ok: true,
    label: "LOCAL",
    mind,
    bodyChars: body.length,
    bodyBytes: Buffer.byteLength(body, "utf8"),
    contentCommit: commit,
    card: formatBrainSeedCard(mind) +
      "\ncontentCommit=" + commit.slice(0, 16) + "…" +
      "\nbody=" + body.length + " chars / " +
      Buffer.byteLength(body, "utf8") + "B — stage with /vitafeed brain",
    note: "LOCAL design proof — LIVE seal needs VITAFEED_PAID=yes + RISK gas",
  };
}
