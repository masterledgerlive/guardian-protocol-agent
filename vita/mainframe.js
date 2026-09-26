/**
 * VITA mainframe — protect the original formula.
 *
 * Self-contained (no viem). HTML is memory until sparse inject. Hardcoded
 * Base anchors never invent hashes. Message-first: when leftover covers
 * KEY+LOC, hitch — Storage Token can charge the transmission delta later.
 * /prove keeps Eureka.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const MAINFRAME_ID = "vita-mainframe-v1";
export const MAINFRAME_SCRIPT_ID = "vita-mainframe";
export const FILING_SCRIPT_ID = "vita-filing-map";
export const FORMULA_ID = "original-message-first";
export const KEY_LOC_HITCH_BYTES_CLASS = 69;
export const EUREKA_LEFTOVER_BYTES_CLASS = 229;

const anchorsFile = JSON.parse(
  readFileSync(join(HERE, "anchors.json"), "utf8"),
);

function freezeAnchor(row) {
  return Object.freeze({
    id: row.id,
    tx: row.tx,
    kind: row.kind,
    label: row.label,
    lesson: row.lesson,
    expect: row.kind === "none" ? "none" : row.kind,
    note: row.label,
  });
}

const known = Object.freeze((anchorsFile.anchors || []).map(freezeAnchor));
const byId = Object.fromEntries(known.map((a) => [a.id, a]));

export const MAINFRAME_ANCHORS = Object.freeze({
  chain: anchorsFile.chain,
  chainId: anchorsFile.chainId,
  wallet: anchorsFile.wallet,
  swapRouter02: anchorsFile.swapRouter02,
  weth: anchorsFile.weth,
  gasPriceOracle: anchorsFile.gasPriceOracle,
  keycatPlainTx: byId["keycat-plain"].tx,
  eurekaProveTx: byId["eureka-prove"].tx,
  vitaStrandTx: byId["vita-strand"].tx,
  known,
  filing: Object.freeze([...(anchorsFile.filingRoots || [])]),
  basescanTx: anchorsFile.basescanTx,
  neverInventHashes: true,
});

export const ORIGINAL_FORMULA = Object.freeze({
  id: FORMULA_ID,
  htmlIsMemoryUntilInject: true,
  sparseInjectFromSealedLocations: true,
  leftoverHitch: "key-loc",
  proveHitch: "eureka",
  messageFirstWhenKeyLocCovered: true,
  chargeHitchDeltaViaStorageToken: true,
  neverInventTxHash: true,
  neverSellRedToInject: true,
  neverMuteHitchForMicroExtract: true,
  learnAppendOnly: true,
});

/**
 * Message-first hitch gate (original formula).
 * When KEY+LOC is covered → always hitch; do not mute for micro extract.
 */
export function originalFormulaHitchDecision(input = {}) {
  const locOk = input.locOk === true
    || input.keyLocCovered === true
    || input.encoding === "key-loc"
    || input.skipHitch === false;
  const keyLocBytes = Number(input.keyLocBytes) > 0
    ? Number(input.keyLocBytes)
    : KEY_LOC_HITCH_BYTES_CLASS;

  if (locOk) {
    return {
      encoding: "key-loc",
      hitchBytes: keyLocBytes,
      skipHitch: false,
      locOk: true,
      formula: FORMULA_ID,
      messageFirst: true,
      storageTokenChargeable: true,
      keyLocClass: KEY_LOC_HITCH_BYTES_CLASS,
      eurekaClass: EUREKA_LEFTOVER_BYTES_CLASS,
      reason: String(input.reason || "KEY+LOC covered")
        + " — original formula: send message; charge hitch delta via Storage Token",
    };
  }
  return {
    encoding: input.encoding || "plain",
    hitchBytes: Number(input.hitchBytes) || 0,
    skipHitch: true,
    locOk: false,
    formula: FORMULA_ID,
    messageFirst: true,
    storageTokenChargeable: false,
    keyLocClass: KEY_LOC_HITCH_BYTES_CLASS,
    eurekaClass: EUREKA_LEFTOVER_BYTES_CLASS,
    reason: String(input.reason || "KEY+LOC not covered — plain swap; Eureka on /prove"),
  };
}

/** Sparse inject: hardcoded anchors first, then sealed locs, chunked. */
export function planSparseInject({
  sealedLocations = [],
  chunkSize = 3,
  includeHardcoded = true,
} = {}) {
  return planSparseInjectInner({ sealedLocations, chunkSize, includeHardcoded });
}

function planSparseInjectInner({
  sealedLocations = [],
  chunkSize = 3,
  includeHardcoded = true,
} = {}) {
  const hardcoded = includeHardcoded
    ? MAINFRAME_ANCHORS.known.map((a) => ({
        location: a.tx,
        kind: a.kind,
        source: "hardcoded-anchor",
        note: a.label,
      }))
    : [];
  const sealed = (sealedLocations || [])
    .map((x) => {
      if (typeof x === "string") {
        return { location: x, kind: "vita", source: "sealed" };
      }
      return {
        location: x.location || x.tx || x.hash,
        kind: x.kind || x.expect || "vita",
        source: x.source || "sealed",
        note: x.note || null,
      };
    })
    .filter((x) => /^0x[0-9a-fA-F]{64}$/.test(String(x.location || "")));

  const seen = new Set();
  const ordered = [];
  for (const row of [...hardcoded, ...sealed]) {
    const key = String(row.location).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(row);
  }

  const size = Math.max(1, Math.floor(Number(chunkSize) || 3));
  const strands = [];
  for (let i = 0; i < ordered.length; i += size) {
    strands.push({
      strandId: "strand-" + String(strands.length + 1).padStart(3, "0"),
      index: strands.length,
      locations: ordered.slice(i, i + size),
      sparse: true,
    });
  }
  return {
    formula: FORMULA_ID,
    total: ordered.length,
    chunkSize: size,
    strands,
    neverForget: true,
  };
}

export function buildMainframeInfectPayload(extra = {}) {
  const infectedAt = typeof extra.infectedAt === "string"
    ? extra.infectedAt
    : (typeof extra.infectedAt === "string" ? extra.infectedAt : new Date().toISOString());
  const rest = { ...extra };
  delete rest.infectedAt;
  delete rest.infectedAt;
  return {
    id: MAINFRAME_ID,
    infectedAt,
    formula: { ...ORIGINAL_FORMULA },
    anchors: {
      wallet: MAINFRAME_ANCHORS.wallet,
      keycatPlainTx: MAINFRAME_ANCHORS.keycatPlainTx,
      eurekaProveTx: MAINFRAME_ANCHORS.eurekaProveTx,
      vitaStrandTx: MAINFRAME_ANCHORS.vitaStrandTx,
      swapRouter02: MAINFRAME_ANCHORS.swapRouter02,
      known: MAINFRAME_ANCHORS.known,
    },
    filing: MAINFRAME_ANCHORS.filing,
    basescanTx: MAINFRAME_ANCHORS.basescanTx,
    readOrder: [
      "vita/AGENTS.md",
      "vita/ORIGINAL_FORMULA.md",
      "vita/FILING.md",
      "vita/anchors.json",
      "vita/mainframe.js",
    ],
    ...rest,
  };
}

export function infectVitaHtmlDocument(html, extra = {}) {
  const src = String(html || "");
  const payload = buildMainframeInfectPayload(extra);
  const json = JSON.stringify(payload, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
  const filingJson = JSON.stringify(
    {
      label: "FILING",
      roots: MAINFRAME_ANCHORS.filing,
      formula: FORMULA_ID,
    },
    null,
    2,
  );
  const block =
    `<script type="application/json" id="${MAINFRAME_SCRIPT_ID}">\n` +
    json +
    `\n</script>\n` +
    `<script type="application/json" id="${FILING_SCRIPT_ID}">\n` +
    filingJson +
    `\n</script>`;

  let out = src
    .replace(/<script type="application\/json" id="vita-mainframe">[\s\S]*?<\/script>\s*/gi, "")
    .replace(/<script type="application\/json" id="vita-filing-map">[\s\S]*?<\/script>\s*/gi, "");

  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, block + "\n</head>");
  } else if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/<body([^>]*)>/i, `<body$1>\n` + block);
  } else {
    out = block + out;
  }

  if (/id="injectPill"/i.test(out)) {
    out = out.replace(
      /(<span[^>]*id="injectPill"[^>]*>)([\s\S]*?)(<\/span>)/i,
      `$1mainframe infected · HTML memory$3`,
    );
  }
  return { html: out, payload };
}

export function readMainframeFromHtml(html) {
  const m = String(html || "").match(
    /<script type="application\/json" id="vita-mainframe">([\s\S]*?)<\/script>/i,
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export function buildMemoryNote({
  topic = "learn",
  text = "",
  locations = [],
  hypothesis = null,
} = {}) {
  return {
    at: new Date().toISOString(),
    topic: String(topic || "learn"),
    text: String(text || "").slice(0, 4000),
    locations: (locations || []).filter((h) => /^0x[0-9a-fA-F]{64}$/.test(String(h))),
    hypothesis: hypothesis || null,
    formula: FORMULA_ID,
    neverForget: true,
  };
}

export function loadAnchorsFile() {
  return JSON.parse(JSON.stringify(anchorsFile));
}
