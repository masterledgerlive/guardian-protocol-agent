/**
 * FINETUNE MEMORY — sixth lobe of the Guardian brain
 * ─────────────────────────────────────────────────────────────────────────────
 * Knowledge sources folded in:
 *   1. fomoradar.app — "THE BRAIN · six lobes · one mind" + conviction =
 *      whose money moved (sum of (score/100)²), not how many wallets.
 *   2. @antpalkin article (X status/2085431604906766385) — the self-improving
 *      trading loop has six parts; five are solved (research→code→backtest→
 *      live→post-mortem). The sixth is Fine-tune: a persistent world model /
 *      hypothesis graph that remembers what failed, what only worked in a
 *      regime, and never lets the next cycle start from zero.
 *
 * Guardian already has recursive VITA §TOKEN§, XMEM retrieval, COST_EDGE
 * mistake rings, and cliff notes. This module closes the circle: negative
 * results become first-class assets that inject into session start and gate
 * repeat mistakes by symbol + regime.
 *
 * Six lobes · one mind:
 *   RESOLVER   — identity / soul (genesis KEY)
 *   TAPE       — append-only events (turns, cliff notes, XMEM)
 *   PROVENANCE — chain-sealed truth (tx / loc)
 *   JUDGE      — score & refuse (COST_EDGE, outlet KEEP/CUT)
 *   BURST      — live concurrence (align / smart money)
 *   FINETUNE   — fold lessons back (this graph)
 */

import { createHash } from "crypto";

export const BRAIN_LOBES = Object.freeze([
  "RESOLVER",
  "TAPE",
  "PROVENANCE",
  "JUDGE",
  "BURST",
  "FINETUNE",
]);

export const HYPOTHESIS_STATUSES = Object.freeze([
  "pending",
  "confirmed",
  "failed",
  "invalidated",
  "never_tried",
]);

export const REGIMES = Object.freeze([
  "thin-book",
  "high-unit",
  "bull",
  "bear",
  "sideways",
  "gas-spike",
  "general",
]);

const GRAPH_MAX = 200;
const EVIDENCE_MAX = 12;

/** In-memory hypothesis graph (also persisted by agent when wired). */
export let hypothesisGraph = [];
let hypSeq = 0;

export function getHypothesisGraph() {
  return hypothesisGraph;
}

export function resetHypothesisGraph() {
  hypothesisGraph = [];
  hypSeq = 0;
}

function nowIso() {
  return new Date().toISOString();
}

function nextId(at = nowIso()) {
  hypSeq += 1;
  const day = String(at).slice(0, 10).replace(/-/g, "");
  return `hyp-${day}-${String(hypSeq).padStart(4, "0")}`;
}

function clip(text, n) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 3)) + "...";
}

function normalizeRegime(regime) {
  const r = String(regime || "general").toLowerCase().trim();
  return REGIMES.includes(r) ? r : "general";
}

function normalizeStatus(status) {
  const s = String(status || "pending").toLowerCase().trim();
  return HYPOTHESIS_STATUSES.includes(s) ? s : "pending";
}

/**
 * FOMO-radar style conviction: weight evidence by squared score, not raw count.
 * Confirmed evidence lifts; failed / invalidated drains. Range [0, 1].
 */
export function convictionScore(hyp) {
  const evidence = Array.isArray(hyp?.evidence) ? hyp.evidence : [];
  if (!evidence.length) {
    // Seed from status alone — a fresh failed lesson still carries weight.
    if (hyp?.status === "failed") return 0.55;
    if (hyp?.status === "confirmed") return 0.45;
    if (hyp?.status === "invalidated") return 0.2;
    return 0.15;
  }
  let pos = 0;
  let neg = 0;
  for (const e of evidence) {
    const score = Math.max(0, Math.min(100, Number(e.score) || 50));
    const w = (score / 100) ** 2;
    if (e.kind === "confirm" || e.kind === "burst") pos += w;
    else if (e.kind === "fail" || e.kind === "refuse" || e.kind === "exit") neg += w;
    else pos += w * 0.25;
  }
  const total = pos + neg;
  if (!(total > 0)) return 0.15;
  // Failed-heavy → high "avoid" conviction; confirmed-heavy → high "trust".
  const polarity = hyp?.status === "confirmed" ? pos / total : neg / total;
  const strength = Math.min(1, total);
  return Math.max(0, Math.min(1, 0.2 + polarity * 0.8 * strength));
}

/**
 * File a new hypothesis (or strengthen an existing same-thesis match).
 * Negative results are first-class — status=failed is the undervalued asset.
 */
export function fileHypothesis({
  thesis,
  regime = "general",
  expected = "",
  symbol = "",
  tags = [],
  source = "manual",
  status = "pending",
  evidence = null,
  id = null,
} = {}) {
  const text = clip(thesis, 220);
  if (!text) throw new Error("thesis required");

  const existing = hypothesisGraph.find(
    (h) =>
      h.thesis.toLowerCase() === text.toLowerCase() &&
      normalizeRegime(h.regime) === normalizeRegime(regime) &&
      String(h.symbol || "").toUpperCase() === String(symbol || "").toUpperCase(),
  );
  if (existing) {
    if (evidence) addEvidence(existing.id, evidence);
    if (status && status !== "pending" && status !== existing.status) {
      existing.status = normalizeStatus(status);
      existing.updatedAt = nowIso();
    }
    existing.conviction = convictionScore(existing);
    return existing;
  }

  const at = nowIso();
  const row = {
    id: id || nextId(at),
    thesis: text,
    regime: normalizeRegime(regime),
    expected: clip(expected, 160),
    symbol: String(symbol || "").toUpperCase() || null,
    tags: (Array.isArray(tags) ? tags : String(tags || "").split(","))
      .map((t) => String(t).toLowerCase().trim())
      .filter(Boolean)
      .slice(0, 12),
    status: normalizeStatus(status),
    source: String(source || "manual").slice(0, 40),
    evidence: [],
    conviction: 0,
    createdAt: at,
    updatedAt: at,
  };
  if (evidence) {
    row.evidence.push(normalizeEvidence(evidence));
  }
  row.conviction = convictionScore(row);
  hypothesisGraph.push(row);
  while (hypothesisGraph.length > GRAPH_MAX) hypothesisGraph.shift();
  return row;
}

function normalizeEvidence(entry = {}) {
  return {
    at: entry.at || nowIso(),
    kind: String(entry.kind || "note").toLowerCase().slice(0, 24),
    score: Math.max(0, Math.min(100, Number(entry.score) || 50)),
    ref: entry.ref ? String(entry.ref).slice(0, 80) : null,
    note: clip(entry.note || "", 160),
  };
}

export function addEvidence(id, entry = {}) {
  const hyp = hypothesisGraph.find((h) => h.id === id);
  if (!hyp) return null;
  hyp.evidence.push(normalizeEvidence(entry));
  while (hyp.evidence.length > EVIDENCE_MAX) hyp.evidence.shift();
  hyp.updatedAt = nowIso();
  hyp.conviction = convictionScore(hyp);
  return hyp;
}

export function resolveHypothesis(id, status, evidence = null) {
  const hyp = hypothesisGraph.find((h) => h.id === id);
  if (!hyp) return null;
  hyp.status = normalizeStatus(status);
  hyp.updatedAt = nowIso();
  if (evidence) addEvidence(id, evidence);
  else hyp.conviction = convictionScore(hyp);
  return hyp;
}

/**
 * Map a COST_EDGE / gate refusal into a failed (or pending) regime lesson.
 * Same thesis + symbol + regime consolidates evidence instead of duplicating.
 */
export function ingestCostMistake(mistake = {}) {
  const symbol = String(mistake.symbol || "?").toUpperCase();
  const code = String(mistake.code || "unknown");
  const regime =
    code.includes("high_unit") ? "high-unit"
      : code.includes("hitch") || code.includes("rt") ? "thin-book"
        : "general";
  const thesis = clip(
    `Do not repeat ${symbol} ${code}: ${mistake.reason || "cost-edge refuse"}`,
    220,
  );
  return fileHypothesis({
    thesis,
    regime,
    expected: "refuse or resize before capital sits underwater",
    symbol,
    tags: ["cost-edge", code, "negative-result"],
    source: mistake.source || "cost-edge",
    status: "failed",
    evidence: {
      kind: "refuse",
      score: 80,
      note: clip(mistake.reason || code, 160),
      ref: code,
    },
  });
}

/**
 * Before the next cycle: should we avoid this symbol/regime?
 * Returns matching negative-result hypotheses above a conviction floor.
 */
export function shouldAvoid({
  symbol = "",
  regime = null,
  code = null,
  minConviction = 0.35,
} = {}) {
  const sym = String(symbol || "").toUpperCase();
  const reg = regime ? normalizeRegime(regime) : null;
  const codeNeedle = code ? String(code).toLowerCase() : null;
  return hypothesisGraph.filter((h) => {
    if (h.status !== "failed" && h.status !== "invalidated") return false;
    if (convictionScore(h) < minConviction) return false;
    if (sym && h.symbol && h.symbol !== sym) return false;
    if (reg && h.regime !== reg && h.regime !== "general") return false;
    if (codeNeedle) {
      const hay = `${h.thesis} ${h.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(codeNeedle)) return false;
    }
    return true;
  });
}

export function queryHypotheses({
  q = "",
  status = null,
  regime = null,
  symbol = null,
  limit = 20,
} = {}) {
  const needle = String(q || "").toLowerCase().trim();
  const st = status ? normalizeStatus(status) : null;
  const reg = regime ? normalizeRegime(regime) : null;
  const sym = symbol ? String(symbol).toUpperCase() : null;
  const rows = hypothesisGraph.filter((h) => {
    if (st && h.status !== st) return false;
    if (reg && h.regime !== reg) return false;
    if (sym && h.symbol !== sym) return false;
    if (!needle) return true;
    const hay = [h.thesis, h.expected, h.symbol, h.regime, ...(h.tags || [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return needle.split(/\s+/).every((w) => hay.includes(w));
  });
  rows.sort((a, b) => convictionScore(b) - convictionScore(a));
  return rows.slice(0, Math.max(1, Number(limit) || 20));
}

/**
 * Six-lobe brain status for Telegram / API.
 * `firing` counts how many lobes currently have signal; FINETUNE fires when
 * the graph holds at least one failed/confirmed lesson.
 */
export function buildBrainStatus(hooks = {}) {
  const failed = hypothesisGraph.filter((h) => h.status === "failed").length;
  const confirmed = hypothesisGraph.filter((h) => h.status === "confirmed").length;
  const pending = hypothesisGraph.filter((h) => h.status === "pending").length;
  const topAvoid = shouldAvoid({ minConviction: 0.4 }).slice(0, 5);

  const lobes = {
    RESOLVER: {
      role: "identity / soul",
      signal: hooks.hasKey === false ? 0 : 1,
      note: hooks.hasKey === false ? "KEY missing — reconstruct" : "genesis KEY present",
    },
    TAPE: {
      role: "append-only events",
      signal: Number(hooks.tapeCount) > 0 ? 1 : hypothesisGraph.length > 0 ? 1 : 0,
      note: hooks.tapeNote || `${hypothesisGraph.length} graph nodes · tape=${hooks.tapeCount ?? "?"}`,
    },
    PROVENANCE: {
      role: "chain-sealed truth",
      signal: Number(hooks.sealedCount) > 0 ? 1 : 0,
      note: hooks.provenanceNote || `sealed loc=${hooks.sealedCount ?? 0}`,
    },
    JUDGE: {
      role: "score & refuse",
      signal: Number(hooks.judgeLessons) > 0 || failed > 0 ? 1 : 0,
      note: hooks.judgeNote || `failed lessons=${failed}`,
    },
    BURST: {
      role: "live concurrence",
      signal: Number(hooks.burstAlign) > 0 ? 1 : 0,
      note: hooks.burstNote || (hooks.burstAlign ? `align=${hooks.burstAlign}` : "idle"),
    },
    FINETUNE: {
      role: "fold lessons back",
      signal: failed + confirmed > 0 ? 1 : 0,
      note: `${failed} failed · ${confirmed} confirmed · ${pending} pending`,
    },
  };

  const firing = BRAIN_LOBES.filter((name) => lobes[name].signal > 0).length;
  return {
    kind: "guardian-brain",
    source: {
      fomoradar: "https://fomoradar.app — six lobes · one mind · conviction",
      antpalkin: "https://x.com/antpalkin/status/2085431604906766385 — fine-tune closes the loop",
    },
    firing,
    outOf: BRAIN_LOBES.length,
    lobes,
    graph: {
      total: hypothesisGraph.length,
      failed,
      confirmed,
      pending,
      topAvoid: topAvoid.map((h) => ({
        id: h.id,
        symbol: h.symbol,
        regime: h.regime,
        conviction: Number(convictionScore(h).toFixed(3)),
        thesis: h.thesis,
      })),
    },
    message:
      firing === 0
        ? "Brain quiet — file a hypothesis or wait for COST_EDGE lessons"
        : `THE BRAIN · ${firing}/${BRAIN_LOBES.length} lobes firing · finetune ${failed} neg / ${confirmed} ok`,
  };
}

/**
 * Compact block for VITA session inject — the sixth piece that was missing.
 * Paste alongside §TOKEN§ so the next cycle does not restart from zero.
 */
export function buildFinetuneInjectContext({ limit = 8 } = {}) {
  const failed = queryHypotheses({ status: "failed", limit });
  const confirmed = queryHypotheses({ status: "confirmed", limit: Math.max(2, Math.floor(limit / 2)) });
  const lines = [
    "═══ FINETUNE — hypothesis graph (sixth lobe) ═══",
    "Negative results are assets. Do not re-test a failed thesis in the same regime.",
    `Graph: ${hypothesisGraph.length} · failed ${failed.length} · confirmed ${confirmed.length}`,
    "",
  ];
  if (failed.length) {
    lines.push("AVOID / FAILED:");
    for (const h of failed) {
      lines.push(
        `- [${h.id}] ${h.symbol || "*"} @${h.regime} c=${convictionScore(h).toFixed(2)} — ${h.thesis}`,
      );
    }
    lines.push("");
  }
  if (confirmed.length) {
    lines.push("CONFIRMED:");
    for (const h of confirmed) {
      lines.push(
        `- [${h.id}] ${h.symbol || "*"} @${h.regime} c=${convictionScore(h).toFixed(2)} — ${h.thesis}`,
      );
    }
    lines.push("");
  }
  if (!failed.length && !confirmed.length) {
    lines.push("(empty — ingest COST_EDGE refusals or /hyp to seed)");
    lines.push("");
  }
  lines.push("═══════════════════════════════════════════════");
  return {
    kind: "finetune-inject-context",
    context: lines.join("\n"),
    failed,
    confirmed,
  };
}

/** Dense LEARN fragment for VITA §TOKEN§ refine (keeps under budget). */
export function finetuneLearnSnippet({ maxChars = 180 } = {}) {
  const avoid = shouldAvoid({ minConviction: 0.4 }).slice(0, 4);
  if (!avoid.length) return "";
  const bits = avoid.map((h) => {
    const sym = h.symbol || "?";
    return `${sym}/${h.regime}`;
  });
  return clip(`FINETUNE avoid ${bits.join(",")}`, maxChars);
}

/**
 * XMEM overlay encoding — retrieval layer only; does not invent chain history.
 * type=warning for failed, type=summary for confirmed, type=note otherwise.
 */
export function hypothesisToXmem(hyp) {
  if (!hyp?.id) return null;
  const type =
    hyp.status === "failed" || hyp.status === "invalidated" ? "warning"
      : hyp.status === "confirmed" ? "summary"
        : "note";
  const tags = [
    "finetune",
    hyp.status,
    hyp.regime,
    ...(hyp.symbol ? [hyp.symbol.toLowerCase()] : []),
    ...(hyp.tags || []),
  ]
    .filter(Boolean)
    .slice(0, 10);
  return {
    ns: "finetune",
    type,
    id: hyp.id,
    tags,
    state: hyp.status === "pending" ? "pending" : hyp.status === "confirmed" ? "settled" : "active",
    target: hyp.regime,
    note: clip(`${hyp.thesis}${hyp.expected ? " | expect: " + hyp.expected : ""}`, 180),
    src: hyp.source,
    role: "finetune-lobe",
    scope: "hypothesis-graph",
    conviction: Number(convictionScore(hyp).toFixed(3)),
  };
}

export function serializeFinetuneState() {
  return {
    version: 1,
    hypSeq,
    hypotheses: hypothesisGraph,
    savedAt: nowIso(),
  };
}

export function restoreFinetuneState(data) {
  if (!data || typeof data !== "object") {
    resetHypothesisGraph();
    return false;
  }
  const rows = Array.isArray(data.hypotheses) ? data.hypotheses : [];
  hypothesisGraph = rows
    .filter((h) => h && h.id && h.thesis)
    .map((h) => ({
      ...h,
      regime: normalizeRegime(h.regime),
      status: normalizeStatus(h.status),
      evidence: Array.isArray(h.evidence) ? h.evidence.slice(-EVIDENCE_MAX) : [],
      conviction: convictionScore(h),
    }))
    .slice(-GRAPH_MAX);
  hypSeq = Number(data.hypSeq) || hypothesisGraph.length;
  return true;
}

/** Stable fingerprint of the graph for inject cache busting. */
export function graphFingerprint() {
  const payload = hypothesisGraph
    .map((h) => `${h.id}:${h.status}:${h.updatedAt}`)
    .join("|");
  return createHash("sha256").update(payload || "empty").digest("hex").slice(0, 12);
}

export function formatBrainTelegram(status = buildBrainStatus()) {
  const lines = [
    `🧠 <b>THE BRAIN · ${status.firing}/${status.outOf} lobes</b>`,
    status.message,
    "",
  ];
  for (const name of BRAIN_LOBES) {
    const lobe = status.lobes[name];
    const icon = lobe.signal > 0 ? "●" : "○";
    lines.push(`${icon} <b>${name}</b> — ${lobe.role}`);
    lines.push(`   ${lobe.note}`);
  }
  const avoid = status.graph?.topAvoid || [];
  if (avoid.length) {
    lines.push("");
    lines.push("<b>Top avoid (finetune)</b>");
    for (const a of avoid.slice(0, 5)) {
      lines.push(`· ${a.symbol || "*"} @${a.regime} c=${a.conviction} — ${clip(a.thesis, 70)}`);
    }
  }
  lines.push("");
  lines.push("<i>/hyp [thesis] — file · /hypfail [id] — mark failed · /brain — status</i>");
  return lines.join("\n");
}
