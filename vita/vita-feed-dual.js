/**
 * VITAFEED dual-lane proof — human text ↔ machine language side-by-side.
 *
 * Same knowledge, two lanes:
 *   HUMAN  = exact plain UTF-8 (readable chat)
 *   MACHINE = ZK-short / §VITADUAL§ machine form of the same commit
 *
 * Telegram cards show costs, file sizes, and spaced Basescan locations for
 * both lanes so operators can cross-compare while proving inject on Base.
 * Read receipt = Basescan Input Data → View as UTF-8 (the on-chain chat).
 *
 * Mother brain untouched. Never invents tx hashes. Money is proof math —
 * bags ≥ $0.50 can exit to restart RISK for more inject tests.
 */

import { createHash } from "node:crypto";
import { packMachineShort } from "./vita-dir.js";
import {
  VITAFEED_BASESCAN_TX,
  prepareVitaFeed,
  estimateVitaFeedCost,
  resolveVitaFeedQuotes,
} from "./vita-feed.js";

export const VITADUAL_ID = "vita-feed-dual-v1";
export const VITADUAL_MAGIC = "§VITADUAL§";
export const VITADUAL_LABEL = "VITADUAL";
export const HUMAN_LANE = "HUMAN";
export const MACHINE_LANE = "MACHINE";

/** Exit bags at or above this USD to free RISK for inject tests. */
export const VITADUAL_RESTART_EXIT_USD = 0.5;

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
}

function clip(s, n = 120) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, Math.max(0, n - 1)) + "…";
}

function utf8Bytes(s) {
  return Buffer.byteLength(String(s || ""), "utf8");
}

/**
 * Build machine-lane body from the same human knowledge.
 * Open-source unwrap — no private key. Commit binds both lanes.
 */
export function buildMachineLaneBody(humanText, { locs = [], trueName = null } = {}) {
  const english = String(humanText || "");
  if (!english.trim()) {
    return { ok: false, reason: "empty human text — nothing to translate" };
  }
  const machineLine =
    "DUAL lane=MACHINE commit=" + shortHex(sha256Hex(english), 12) +
    " bytes=" + utf8Bytes(english) +
    " | " + clip(english, 64);
  const packed = packMachineShort({
    english,
    machine: machineLine,
    locs: (locs || []).filter(isTxHash),
    trueName,
  });
  const body =
    VITADUAL_MAGIC +
    "v1|lane=machine|commit=" +
    packed.commit.slice(0, 16) +
    "|humanBytes=" +
    utf8Bytes(english) +
    "§\n" +
    packed.short +
    "\n" +
    machineLine;
  return {
    ok: true,
    lane: MACHINE_LANE,
    body,
    english,
    machine: machineLine,
    packed,
    contentCommit: packed.commit,
    humanBytes: utf8Bytes(english),
    machineBytes: utf8Bytes(body),
  };
}

/**
 * Price both lanes of the same knowledge for side-by-side cost proof.
 */
export function prepareDualLaneCompare(humanText, quotes = {}, opts = {}) {
  const human = String(humanText || "");
  if (!human.trim()) {
    return { ok: false, reason: "empty body — dual lane needs human text" };
  }
  const q = resolveVitaFeedQuotes(quotes);
  const humanPrepared = prepareVitaFeed(human, opts.humanVin ? { vinId: opts.humanVin } : {});
  if (!humanPrepared.ok) {
    return { ok: false, reason: humanPrepared.reason || "human prepare failed" };
  }
  const machineBuilt = buildMachineLaneBody(human, {
    locs: opts.locs || [],
    trueName: opts.trueName || null,
  });
  if (!machineBuilt.ok) return machineBuilt;
  const machinePrepared = prepareVitaFeed(
    machineBuilt.body,
    opts.machineVin ? { vinId: opts.machineVin } : {},
  );
  if (!machinePrepared.ok) {
    return { ok: false, reason: machinePrepared.reason || "machine prepare failed" };
  }
  const humanCost = estimateVitaFeedCost(humanPrepared, q);
  const machineCost = estimateVitaFeedCost(machinePrepared, q);
  const combinedEth =
    (humanCost.ok ? humanCost.totalEth : 0) + (machineCost.ok ? machineCost.totalEth : 0);
  const combinedUsd =
    (humanCost.ok ? humanCost.totalUsd : 0) + (machineCost.ok ? machineCost.totalUsd : 0);
  return {
    ok: true,
    id: VITADUAL_ID,
    quotes: q,
    human: {
      lane: HUMAN_LANE,
      prepared: humanPrepared,
      cost: humanCost,
      body: human,
      bytes: utf8Bytes(human),
      chars: [...human].length,
      bits: utf8Bytes(human) * 8,
    },
    machine: {
      lane: MACHINE_LANE,
      prepared: machinePrepared,
      cost: machineCost,
      body: machineBuilt.body,
      english: machineBuilt.english,
      machine: machineBuilt.machine,
      packed: machineBuilt.packed,
      bytes: machineBuilt.machineBytes,
      chars: [...machineBuilt.body].length,
      bits: machineBuilt.machineBytes * 8,
      contentCommit: machineBuilt.contentCommit,
    },
    combined: {
      injections:
        (humanCost.ok ? humanCost.injections : 0) +
        (machineCost.ok ? machineCost.injections : 0),
      totalEth: combinedEth,
      totalUsd: combinedUsd,
      humanBytes: utf8Bytes(human),
      machineBytes: machineBuilt.machineBytes,
      deltaBytes: machineBuilt.machineBytes - utf8Bytes(human),
      deltaUsd:
        (machineCost.ok ? machineCost.totalUsd : 0) -
        (humanCost.ok ? humanCost.totalUsd : 0),
    },
    note: "Same knowledge · two lanes · cross-compare costs + sizes before confirm",
  };
}

/**
 * Basescan read receipt — how to read the on-chain chat (Input Data → UTF-8).
 * Only real tx hashes; never invent.
 */
export function formatBasescanReadReceipt({
  locations = [],
  vinId = null,
  lane = null,
  readerKey = null,
  chatPreview = null,
} = {}) {
  const locs = (locations || []).filter((h) => isTxHash(h));
  const lines = [];
  lines.push("BASESCAN READ RECEIPT" + (lane ? " · " + lane : ""));
  if (vinId) lines.push("VIN " + vinId);
  if (readerKey) lines.push("reader " + readerKey);
  lines.push("read: Basescan → Input Data → View as UTF-8  (on-chain chat)");
  lines.push("spaced locs=" + locs.length + "  (bunched below — never invent hashes)");
  if (chatPreview) {
    lines.push("chat preview: " + clip(chatPreview, 160));
  }
  if (!locs.length) {
    lines.push("(no sealed locations yet — seal via /vitafeed confirm|override)");
    return lines.join("\n");
  }
  lines.push("locations (spaced / bunched):");
  locs.forEach((tx, i) => {
    lines.push("  " + (i + 1) + "/" + locs.length + "  " + shortHex(tx, 10) + "…");
    lines.push("     " + VITAFEED_BASESCAN_TX + tx);
  });
  return lines.join("\n");
}

/**
 * Side-by-side cost + size card for Telegram (before seal).
 */
export function formatDualLaneSideBySideCard(compare, { phase = "before" } = {}) {
  if (!compare?.ok) {
    return "VITADUAL: " + (compare?.reason || "cannot compare lanes");
  }
  const h = compare.human;
  const m = compare.machine;
  const c = compare.combined;
  const q = compare.quotes || {};
  const lines = [];
  lines.push(
    "VITADUAL SIDE-BY-SIDE · " + (q.label || "—") + " · " + String(phase).toUpperCase(),
  );
  lines.push("same knowledge · HUMAN plain ↔ MACHINE ZK-short");
  lines.push("");
  lines.push("— HUMAN LANE —");
  lines.push(
    "  chars=" + h.chars +
    "  bytes=" + h.bytes +
    "  bits=" + h.bits +
    "  inj=" + (h.cost?.injections ?? "—"),
  );
  if (h.cost?.ok) {
    lines.push(
      "  ETH≈" + h.cost.totalEth.toFixed(8) +
      "  $≈" + h.cost.totalUsd.toFixed(4) +
      "  VIN " + (h.prepared?.vinId || "—"),
    );
  }
  lines.push("  chat: " + clip(h.body, 100));
  lines.push("");
  lines.push("— MACHINE LANE —");
  lines.push(
    "  chars=" + m.chars +
    "  bytes=" + m.bytes +
    "  bits=" + m.bits +
    "  inj=" + (m.cost?.injections ?? "—"),
  );
  if (m.cost?.ok) {
    lines.push(
      "  ETH≈" + m.cost.totalEth.toFixed(8) +
      "  $≈" + m.cost.totalUsd.toFixed(4) +
      "  VIN " + (m.prepared?.vinId || "—"),
    );
  }
  lines.push("  machine: " + clip(m.machine || m.body, 100));
  if (m.contentCommit) {
    lines.push("  commit=" + shortHex(m.contentCommit, 16));
  }
  lines.push("");
  lines.push("— COMBINED PROOF MATH —");
  lines.push(
    "  injections=" + c.injections +
    "  ETH≈" + c.totalEth.toFixed(8) +
    "  $≈" + c.totalUsd.toFixed(4),
  );
  lines.push(
    "  file sizes: human=" + c.humanBytes + "B" +
    "  machine=" + c.machineBytes + "B" +
    "  Δ=" + (c.deltaBytes >= 0 ? "+" : "") + c.deltaBytes + "B",
  );
  lines.push(
    "  cost Δ machine−human $≈" +
    (c.deltaUsd >= 0 ? "+" : "") +
    c.deltaUsd.toFixed(4),
  );
  lines.push("quotes: " + (q.label || "—") + " — " + (q.source || ""));
  lines.push("");
  lines.push("CONFIRM both: /vitafeed confirm   (stages dual → seals HUMAN then MACHINE)");
  lines.push("Translate only: /vitafeed translate [text]  ·  Dual stage: /vitafeed dual [text]");
  return lines.join("\n");
}

/**
 * After-seal dual receipt: both location sets + Basescan read receipts.
 */
export function formatDualLaneReceipt({
  compare = null,
  humanResult = null,
  machineResult = null,
  humanLocs = null,
  machineLocs = null,
} = {}) {
  const hLocs =
    humanLocs ||
    humanResult?.strand?.locations ||
    humanResult?.locations ||
    [];
  const mLocs =
    machineLocs ||
    machineResult?.strand?.locations ||
    machineResult?.locations ||
    [];
  const realH = (hLocs || []).filter(isTxHash);
  const realM = (mLocs || []).filter(isTxHash);
  const lines = [];
  lines.push("VITADUAL INJECT PROOF · knowledge sealed both lanes");
  if (compare?.ok) {
    lines.push(
      "sizes human=" + compare.combined.humanBytes + "B" +
      " machine=" + compare.combined.machineBytes + "B" +
      " Δ=" + (compare.combined.deltaBytes >= 0 ? "+" : "") +
      compare.combined.deltaBytes + "B",
    );
    if (compare.human?.cost?.ok && compare.machine?.cost?.ok) {
      lines.push(
        "paid human $≈" + compare.human.cost.totalUsd.toFixed(4) +
        " · machine $≈" + compare.machine.cost.totalUsd.toFixed(4) +
        " · both $≈" + compare.combined.totalUsd.toFixed(4),
      );
    }
  }
  lines.push("");
  lines.push(
    formatBasescanReadReceipt({
      locations: realH,
      vinId: humanResult?.strand?.vinId || compare?.human?.prepared?.vinId,
      lane: HUMAN_LANE,
      readerKey: humanResult?.strand?.readerKey || compare?.human?.prepared?.readerKey,
      chatPreview: compare?.human?.body || null,
    }),
  );
  lines.push("");
  lines.push(
    formatBasescanReadReceipt({
      locations: realM,
      vinId: machineResult?.strand?.vinId || compare?.machine?.prepared?.vinId,
      lane: MACHINE_LANE,
      readerKey:
        machineResult?.strand?.readerKey || compare?.machine?.prepared?.readerKey,
      chatPreview: compare?.machine?.machine || compare?.machine?.body || null,
    }),
  );
  lines.push("");
  lines.push(
    "proof: open each Basescan link → Input Data → UTF-8 to read the chat of the data",
  );
  lines.push("never invent hashes — only sealed locs above");
  return lines.join("\n");
}

/**
 * Enrich a normal (single-lane) receipt with Basescan read-receipt + chat hint.
 */
export function appendBasescanReadReceiptToCard(baseCard, {
  locations = [],
  vinId = null,
  readerKey = null,
  chatPreview = null,
  lane = HUMAN_LANE,
} = {}) {
  const receipt = formatBasescanReadReceipt({
    locations,
    vinId,
    readerKey,
    chatPreview,
    lane,
  });
  return String(baseCard || "").trim() + "\n\n" + receipt;
}

/**
 * Bags ≥ floor USD — exit to restart RISK money for more inject tests.
 * Does not place sells; formats the operator hint for Telegram.
 */
export function formatRestartMoneyExitHint({
  bags = [],
  floorUsd = VITADUAL_RESTART_EXIT_USD,
} = {}) {
  const floor = Math.max(0, Number(floorUsd) || VITADUAL_RESTART_EXIT_USD);
  const hits = (bags || [])
    .map((b) => ({
      symbol: String(b.symbol || b.sym || "").toUpperCase(),
      usd: Number(b.usd ?? b.bagUsd ?? b.valueUsd ?? 0),
      tokens: Number(b.tokens ?? b.balance ?? 0),
    }))
    .filter((b) => b.symbol && Number.isFinite(b.usd) && b.usd >= floor)
    .sort((a, b) => b.usd - a.usd);
  const lines = [];
  lines.push(
    "RESTART MONEY · exit bags ≥ $" + floor.toFixed(2) + " if RISK needs fuel",
  );
  if (!hits.length) {
    lines.push("(no bag ≥ $" + floor.toFixed(2) + " — skip exit; inject proof first)");
    return { ok: true, hits: [], card: lines.join("\n") };
  }
  for (const h of hits.slice(0, 12)) {
    lines.push(
      "  " + h.symbol.padEnd(10) +
      " ≈$" + h.usd.toFixed(2) +
      (h.tokens > 0 ? "  bal=" + h.tokens : "") +
      "  → /exit " + h.symbol + "  (or exitonly)",
    );
  }
  if (hits.length > 12) lines.push("  … +" + (hits.length - 12) + " more");
  lines.push("vault/save never spend · RISK only · prove costs then refill");
  return { ok: true, hits, card: lines.join("\n") };
}

/**
 * Build dual stage payload for handleVitaFeedAction (HUMAN first, MACHINE queued).
 */
export function buildDualStagePayload(humanText, quotes = {}, opts = {}) {
  const compare = prepareDualLaneCompare(humanText, quotes, opts);
  if (!compare.ok) return compare;
  return {
    ok: true,
    dual: true,
    compare,
    // Stage human body first; machine sealed after human in confirm path.
    prepared: compare.human.prepared,
    cost: {
      ...compare.human.cost,
      dualCombinedEth: compare.combined.totalEth,
      dualCombinedUsd: compare.combined.totalUsd,
      dualMachineCost: compare.machine.cost,
      dualLabel: "DUAL·HUMAN+MACHINE",
    },
    body: compare.human.body,
    machineBody: compare.machine.body,
    machinePrepared: compare.machine.prepared,
    quotes: compare.quotes,
    card: formatDualLaneSideBySideCard(compare, { phase: "before" }),
  };
}
