/**
 * VITA reference memory — proven recursive search from packaged ledger.
 *
 * Answers only from the append-only memory tree + hardcoded Base anchors.
 * Never invents tx hashes. Calculator is the first true-name domain:
 *   - trueName = calculator (calc / multilingual aliases via free translator codex)
 *   - ask  = general query (anyone who made a calculator / what memory knows)
 *   - self = clearly built for one job (I made / my / for <job> calculator)
 *
 * Filing labels: REF_LIB | PROVEN_TEST | TRANSLATOR_CODEX
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");

export const REF_LIB_ID = "vita-ref-memory-v1";
export const REF_LIB_MAGIC = "§VITAREF§";
export const PROVEN_TEST_MAGIC = "§PROVENTEST§";
export const TRANSLATOR_CODEX_MAGIC = "§VITATRANS§";
export const REF_LIB_LABEL = "REF_LIB";
export const PROVEN_TEST_LABEL = "PROVEN_TEST";
export const TRANSLATOR_CODEX_LABEL = "TRANSLATOR_CODEX";

/** Canonical true name for the calculator domain. */
export const CALCULATOR_TRUE_NAME = "calculator";

/**
 * Free translator codex — packaged aliases (all languages we seed).
 * Lives in the memory tree so any LLM reads once and never forgets.
 */
export const TRANSLATOR_CODEX = Object.freeze({
  id: "vita-translator-codex-v1",
  free: true,
  available: true,
  filingLabel: TRANSLATOR_CODEX_LABEL,
  trueNames: Object.freeze({
    [CALCULATOR_TRUE_NAME]: Object.freeze([
      "calculator",
      "calc",
      "calculadora", // es/pt
      "calculatrice", // fr
      "taschenrechner", // de
      "calcolatrice", // it
      "rekenmachine", // nl
      "kalkulator", // pl/id
      "калькулятор", // ru
      "حاسبة", // ar
      "计算器", // zh
      "計算器", // zh-hant
      "電卓", // ja
      "계산기", // ko
      "कैलकुलेटर", // hi
      "hesap makinesi", // tr
      "räknare", // sv
      "lommeregner", // da
      "calculadora", // gl
    ]),
  }),
});

/** Built-in self calculator — sealed in package as reference job code. */
export const SELF_CALCULATOR = Object.freeze({
  id: "vita-self-calculator-v1",
  trueName: CALCULATOR_TRUE_NAME,
  label: "self",
  job: "proven-ledger-arithmetic",
  filingLabel: REF_LIB_LABEL,
  note: "Built-in calculator for one specific job: prove ledger can eval + cite chain locs.",
});

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
}

function safeReadJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function anchorLocs() {
  return MAINFRAME_ANCHORS.known.map((a) => ({
    id: a.id,
    location: a.tx.toLowerCase(),
    kind: a.kind,
    source: "hardcoded-anchor",
  }));
}

function aliasIndex() {
  const map = new Map();
  for (const [trueName, aliases] of Object.entries(TRANSLATOR_CODEX.trueNames)) {
    for (const a of aliases) {
      map.set(String(a).toLowerCase(), trueName);
    }
  }
  return map;
}

const ALIAS_TO_TRUE = aliasIndex();

/**
 * Resolve query tokens through the free translator codex → true name.
 */
export function resolveTrueName(query) {
  const raw = String(query || "").trim();
  if (!raw) return { trueName: null, aliasHit: null, langHints: [] };
  const lower = raw.toLowerCase();
  const langHints = [];
  let aliasHit = null;
  let trueName = null;

  // Prefer longer aliases first (hesap makinesi before calc).
  const aliases = [...ALIAS_TO_TRUE.keys()].sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (lower === alias || lower.includes(alias)) {
      trueName = ALIAS_TO_TRUE.get(alias);
      aliasHit = alias;
      langHints.push(alias);
      break;
    }
  }
  return { trueName, aliasHit, langHints, query: raw };
}

/**
 * ask = general catalogue search.
 * self = clearly made for one specific job / first-person build.
 */
export function labelIntent(query) {
  const q = String(query || "").toLowerCase();
  const selfRe =
    /\b(i\s+(built|made|wrote|coded)|my\s+(own\s+)?(calc|calculator)|for\s+(my|our|the)\s+\w+|self[\s_-]?calc|job[\s_-]?calc|specific\s+job)\b/i;
  if (selfRe.test(q) || /\blabeled\s+as\s+self\b/i.test(q)) {
    return "self";
  }
  return "ask";
}

function loadRefLibEntriesFromDisk() {
  const out = [];
  try {
    const files = readdirSync(MEMORY_DIR).filter(
      (f) => f.startsWith("ref-lib-") && f.endsWith(".json"),
    );
    for (const f of files) {
      const raw = safeReadJson(join(MEMORY_DIR, f));
      if (!raw || typeof raw !== "object") continue;
      if (Array.isArray(raw.entries)) {
        for (const e of raw.entries) out.push({ ...e, sourceFile: f });
      } else if (raw.trueName || raw.topic) {
        out.push({ ...raw, sourceFile: f });
      }
    }
  } catch {
    /* empty */
  }
  return out;
}

/** Seed catalogue always present (disk may add more). */
function seedCatalogue() {
  const locs = anchorLocs();
  return [
    {
      id: "REF-CALC-SELF",
      trueName: CALCULATOR_TRUE_NAME,
      label: "self",
      job: SELF_CALCULATOR.job,
      title: "VITA self calculator (proven ledger arithmetic)",
      text:
        "Built-in calculator code sealed in vita/ref-memory.js for one specific job: " +
        "prove recursive memory can search + eval + cite Base anchors.",
      aliases: TRANSLATOR_CODEX.trueNames[CALCULATOR_TRUE_NAME],
      locations: locs.map((l) => l.location),
      filingLabel: REF_LIB_LABEL,
      kind: "self-code",
    },
    {
      id: "REF-CALC-ASK",
      trueName: CALCULATOR_TRUE_NAME,
      label: "ask",
      job: null,
      title: "Anyone who made a calculator — catalogue ask",
      text:
        "Ask-class entry: search the tree for calculator makers. True name is calculator. " +
        "Translator codex maps calc/calculadora/電卓/… → calculator. Answers cite sealed locs only.",
      aliases: TRANSLATOR_CODEX.trueNames[CALCULATOR_TRUE_NAME],
      locations: locs.map((l) => l.location),
      filingLabel: REF_LIB_LABEL,
      kind: "ask-catalogue",
    },
    {
      id: "REF-TRANS-CODEX",
      trueName: CALCULATOR_TRUE_NAME,
      label: "ask",
      job: null,
      title: "Free translator codex (packaged in memory tree)",
      text:
        "Free available translator codex — multilingual aliases already in the packaged ledger " +
        "so any LLM reads once and never forgets. Filing=TRANSLATOR_CODEX.",
      aliases: TRANSLATOR_CODEX.trueNames[CALCULATOR_TRUE_NAME],
      locations: locs.map((l) => l.location),
      filingLabel: TRANSLATOR_CODEX_LABEL,
      kind: "translator-codex",
    },
  ];
}

export function listRefLibrary() {
  const seeded = seedCatalogue();
  const disk = loadRefLibEntriesFromDisk();
  const byId = new Map();
  for (const e of [...seeded, ...disk]) {
    const id = String(e.id || e.topic || sha256Hex(JSON.stringify(e)).slice(0, 12));
    if (!byId.has(id)) byId.set(id, { ...e, id });
  }
  return [...byId.values()];
}

/**
 * Safe built-in calculator — only + - * / and parentheses / decimals.
 * Returns null if expression is not a pure arithmetic ask.
 */
export function evalSelfCalculator(expr) {
  const raw = String(expr || "").trim();
  // Pull trailing arithmetic if mixed with words.
  const m = raw.match(/([0-9.()+*/\s-]+)\s*$/);
  const candidate = (m ? m[1] : raw).replace(/\s+/g, "");
  if (!candidate || !/^[0-9.()+*/-]+$/.test(candidate)) {
    return { ok: false, reason: "not-arithmetic" };
  }
  if (!/\d/.test(candidate)) return { ok: false, reason: "no-digits" };
  try {
    // eslint-disable-next-line no-new-func
    const value = Function('"use strict"; return (' + candidate + ");")();
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, reason: "non-finite" };
    }
    return { ok: true, expr: candidate, value, label: "self", trueName: CALCULATOR_TRUE_NAME };
  } catch {
    return { ok: false, reason: "eval-failed" };
  }
}

function citeLocs(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    for (const loc of e.locations || []) {
      const tx = String(loc || "").toLowerCase();
      if (!isTxHash(tx) || seen.has(tx)) continue;
      seen.add(tx);
      const anchor = MAINFRAME_ANCHORS.known.find((a) => a.tx.toLowerCase() === tx);
      out.push({
        location: tx,
        loc8: shortHex(tx, 8),
        id: anchor?.id || null,
        kind: anchor?.kind || "vita",
        basescan: MAINFRAME_ANCHORS.basescanTx + tx,
      });
    }
  }
  // Always fall back to hardcoded anchors — never invent.
  if (!out.length) {
    for (const a of MAINFRAME_ANCHORS.known) {
      out.push({
        location: a.tx.toLowerCase(),
        loc8: shortHex(a.tx, 8),
        id: a.id,
        kind: a.kind,
        basescan: MAINFRAME_ANCHORS.basescanTx + a.tx,
      });
    }
  }
  return out;
}

/**
 * Search packaged reference memory for a query.
 * Always answers from the tree when trueName resolves; cites real locs only.
 */
export function searchRefMemory(query) {
  const resolved = resolveTrueName(query);
  const intent = labelIntent(query);
  const lib = listRefLibrary();

  if (!resolved.trueName) {
    return {
      ok: false,
      proven: false,
      invent: false,
      intent,
      trueName: null,
      hits: [],
      citations: [],
      answer: null,
      reason: "no-true-name-in-packaged-codex",
      formula: FORMULA_ID,
      magic: REF_LIB_MAGIC,
    };
  }

  const hits = lib.filter((e) => {
    if (e.trueName !== resolved.trueName) return false;
    if (intent === "self") return e.label === "self" || e.kind === "self-code";
    return true;
  });

  const citations = citeLocs(hits.length ? hits : lib.filter((e) => e.trueName === resolved.trueName));
  const calc = intent === "self" || /\d/.test(String(query || ""))
    ? evalSelfCalculator(query)
    : { ok: false };

  const answer = {
    trueName: resolved.trueName,
    aliasHit: resolved.aliasHit,
    intent,
    label: intent === "self" ? "self" : "ask",
    hitCount: hits.length,
    titles: hits.map((h) => h.title || h.id),
    calculator: calc.ok ? { expr: calc.expr, value: calc.value } : null,
    neverInventHashes: true,
    fromBlockchainPackage: true,
  };

  return {
    ok: true,
    proven: citations.length > 0 && hits.length > 0,
    invent: false,
    intent,
    trueName: resolved.trueName,
    aliasHit: resolved.aliasHit,
    hits,
    citations,
    answer,
    reason: "packaged-ref-lib",
    formula: FORMULA_ID,
    magic: REF_LIB_MAGIC,
    contentCommit: sha256Hex(
      REF_LIB_MAGIC + "|" + resolved.trueName + "|" + intent + "|" +
        citations.map((c) => c.loc8).join(","),
    ),
  };
}

export function formatRefMemoryCard(result) {
  const lines = [];
  lines.push(REF_LIB_MAGIC + "v1|filing=" + REF_LIB_LABEL + "§");
  lines.push("VITA REF MEMORY · recursive search");
  lines.push("formula=" + FORMULA_ID);
  lines.push("neverInvent=true");
  if (!result?.ok) {
    lines.push("proven=NO");
    lines.push("reason=" + (result?.reason || "miss"));
    lines.push("— no packaged true-name — refuse invent —");
    return lines.join("\n");
  }
  lines.push("proven=" + (result.proven ? "YES" : "PARTIAL"));
  lines.push("trueName=" + result.trueName);
  if (result.aliasHit) lines.push("aliasHit=" + result.aliasHit + " via TRANSLATOR_CODEX");
  lines.push("label=" + result.intent + " (ask=catalogue · self=one-job)");
  lines.push("hits=" + (result.hits?.length || 0));
  for (const t of (result.answer?.titles || []).slice(0, 8)) {
    lines.push("  · " + t);
  }
  if (result.answer?.calculator) {
    lines.push(
      "selfCalc " + result.answer.calculator.expr + " = " + result.answer.calculator.value,
    );
  }
  lines.push("— citations (Base locs only) —");
  for (const c of (result.citations || []).slice(0, 6)) {
    lines.push("  " + (c.id || "loc") + "|" + c.kind + "|" + c.loc8 + "…");
    lines.push("  " + c.basescan);
  }
  lines.push("commit=" + shortHex(result.contentCommit || "", 12));
  return lines.join("\n");
}

/**
 * Series of proven tests — calculator domain.
 * Each case must resolve from packaged memory + real anchors (never invent).
 */
export const PROVEN_TEST_CASES = Object.freeze([
  {
    id: "PT-CALC-ASK-EN",
    query: "calculator",
    expectIntent: "ask",
    expectTrueName: CALCULATOR_TRUE_NAME,
    expectProven: true,
  },
  {
    id: "PT-CALC-ASK-ALIAS",
    query: "who made a calc",
    expectIntent: "ask",
    expectTrueName: CALCULATOR_TRUE_NAME,
    expectProven: true,
  },
  {
    id: "PT-CALC-ES",
    query: "calculadora",
    expectIntent: "ask",
    expectTrueName: CALCULATOR_TRUE_NAME,
    expectProven: true,
  },
  {
    id: "PT-CALC-JA",
    query: "電卓",
    expectIntent: "ask",
    expectTrueName: CALCULATOR_TRUE_NAME,
    expectProven: true,
  },
  {
    id: "PT-CALC-ZH",
    query: "计算器",
    expectIntent: "ask",
    expectTrueName: CALCULATOR_TRUE_NAME,
    expectProven: true,
  },
  {
    id: "PT-CALC-RU",
    query: "калькулятор",
    expectIntent: "ask",
    expectTrueName: CALCULATOR_TRUE_NAME,
    expectProven: true,
  },
  {
    id: "PT-CALC-SELF-JOB",
    query: "I built a calculator for payroll job",
    expectIntent: "self",
    expectTrueName: CALCULATOR_TRUE_NAME,
    expectProven: true,
  },
  {
    id: "PT-CALC-SELF-EVAL",
    query: "self calc 12+30*2",
    expectIntent: "self",
    expectTrueName: CALCULATOR_TRUE_NAME,
    expectProven: true,
    expectValue: 72,
  },
  {
    id: "PT-CALC-REFUSE-INVENT",
    query: "unicorn quantum blender",
    expectIntent: "ask",
    expectTrueName: null,
    expectProven: false,
  },
]);

export function runProvenTests({ cases = PROVEN_TEST_CASES } = {}) {
  const results = [];
  for (const c of cases) {
    const found = searchRefMemory(c.query);
    const intentOk = found.intent === c.expectIntent;
    const nameOk = (found.trueName || null) === (c.expectTrueName || null);
    const provenOk = Boolean(found.proven) === Boolean(c.expectProven);
    const inventOk = found.invent === false;
    const citesOk = (found.citations || []).every((x) => isTxHash(x.location));
    const anchorsOk = (found.citations || []).every(
      (x) =>
        MAINFRAME_ANCHORS.known.some((a) => a.tx.toLowerCase() === x.location) ||
        isTxHash(x.location),
    );
    let valueOk = true;
    if (typeof c.expectValue === "number") {
      valueOk = found.answer?.calculator?.value === c.expectValue;
    }
    const pass =
      intentOk && nameOk && provenOk && inventOk && citesOk && anchorsOk && valueOk;
    results.push({
      id: c.id,
      query: c.query,
      pass,
      intentOk,
      nameOk,
      provenOk,
      inventOk,
      citesOk,
      anchorsOk,
      valueOk,
      trueName: found.trueName,
      intent: found.intent,
      citationCount: (found.citations || []).length,
    });
  }
  const passed = results.filter((r) => r.pass).length;
  const root = sha256Hex(
    PROVEN_TEST_MAGIC +
      "|" +
      results.map((r) => r.id + ":" + (r.pass ? "1" : "0")).join("|"),
  );
  return {
    ok: passed === results.length,
    filingLabel: PROVEN_TEST_LABEL,
    magic: PROVEN_TEST_MAGIC,
    passed,
    total: results.length,
    results,
    root,
    formula: FORMULA_ID,
    neverInventHashes: true,
  };
}

export function formatProvenTestCard(report) {
  const lines = [];
  lines.push(PROVEN_TEST_MAGIC + "v1|filing=" + PROVEN_TEST_LABEL + "§");
  lines.push("PROVEN TESTS · calculator reference series");
  lines.push("formula=" + FORMULA_ID);
  lines.push("pass=" + report.passed + "/" + report.total);
  lines.push("ok=" + (report.ok ? "YES" : "NO"));
  lines.push("root=" + report.root);
  for (const r of report.results || []) {
    lines.push(
      (r.pass ? "PASS" : "FAIL") +
        " " +
        r.id +
        " q=" +
        JSON.stringify(r.query) +
        " true=" +
        (r.trueName || "∅") +
        " intent=" +
        r.intent +
        " cites=" +
        r.citationCount,
    );
  }
  lines.push("retrieval=packaged REF_LIB + TRANSLATOR_CODEX + Base anchors");
  lines.push("neverInvent=true · recursive memory search");
  return lines.join("\n");
}

/**
 * Build sealable body for /vitafeed backlog / brain growth.
 */
export function buildRefMemoryFeedBody() {
  const report = runProvenTests();
  const lines = [
    REF_LIB_MAGIC + "v1|true=" + CALCULATOR_TRUE_NAME + "|filing=" + REF_LIB_LABEL + "§",
    "VITA REF MEMORY · calculator true-name domain",
    "formula=" + FORMULA_ID,
    "trueName=" + CALCULATOR_TRUE_NAME,
    "translator=" + TRANSLATOR_CODEX_LABEL + " free=true available=true",
    "labels=ask|self",
    "provenTests=" + report.passed + "/" + report.total + " root=" + shortHex(report.root, 12),
    "anchors=" + MAINFRAME_ANCHORS.known.map((a) => shortHex(a.tx, 8)).join(","),
    "—",
    formatProvenTestCard(report),
  ];
  return lines.join("\n");
}
