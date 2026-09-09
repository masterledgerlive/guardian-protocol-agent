/**
 * 🔀 VITA SECONDARY ROUTER — hitch payload switch down the pipeline
 * ─────────────────────────────────────────────────────────────────────────────
 * Primary router is Uniswap V3 exactInputSingle (swap prefix, never touched).
 * This is the *secondary* router: which UTF-8 trailer rides leftover.
 *
 * Modes (Railway VITA_HITCH_MODE, default **vita**):
 *   eureka — love-note prose (legacy §$STORE§ Eureka! …)
 *   vita   — §TOKEN§ parse + squashed §LOC§ (default — denser recall)
 *   hat    — §HAT§ encoded bits when a hat packet is supplied
 *   auto   — leftover/hat-ready switches; never lose to insert
 *
 * /prove stays the love-note genesis (identity). Leftover swap hitches
 * switch to VITA parsing. Love note is encoded in §KEY§ so it is not lost.
 *
 * Pipeline switches (more will land later): hitchMode, locSquash,
 * keepStoreTag, loveNoteInKey, preferHatWhenReady.
 */

import {
  STORE_VOICE_TAG,
  buildStoreVoice,
  clipUtf8,
  utf8ByteLength,
  VITA_PROOF_FULL,
} from "./swap-minout.js";
import {
  VITA_CHAR_BUDGET,
  VITA_LOVE_KEY,
  buildGenesisFields,
  clipVitaPacket,
  detectHitchKind,
  packVitaFields,
  parseVitaPacket,
  refineVitaPacket,
  vitaQuality,
} from "./vita-parse.js";
import {
  encodeLocToken,
  locDepositoryStatus,
  serializeLocationDepository,
  setLocationDepository,
  squashLocations,
} from "./vita-locations.js";

export const HITCH_MODES = Object.freeze(["eureka", "vita", "hat", "auto"]);

export const PIPELINE_SWITCH_DEFAULTS = Object.freeze({
  hitchMode: "vita",
  locSquash: true,
  keepStoreTag: true,
  loveNoteInKey: true,
  preferHatWhenReady: true,
});

let lastVitaPacket = "";
let hitchModeOverride = null;

export function pipelineSwitches(env = process.env, extra = {}) {
  const mode = resolveHitchMode(env, extra);
  return {
    ...PIPELINE_SWITCH_DEFAULTS,
    hitchMode: mode,
    locSquash: extra.locSquash !== false,
    keepStoreTag: extra.keepStoreTag !== false,
    loveNoteInKey: extra.loveNoteInKey !== false,
    preferHatWhenReady: extra.preferHatWhenReady !== false,
    hatReady: Boolean(extra.hatPacket || extra.hatReady),
    leftoverEth: extra.leftoverEth,
    hitchCostEth: extra.hitchCostEth,
    maxBytes: extra.maxBytes,
  };
}

export function resolveHitchMode(env = process.env, pipeline = {}) {
  if (pipeline.mode && HITCH_MODES.includes(String(pipeline.mode).toLowerCase())) {
    return String(pipeline.mode).toLowerCase();
  }
  if (hitchModeOverride && HITCH_MODES.includes(hitchModeOverride)) return hitchModeOverride;
  const raw = String(env?.VITA_HITCH_MODE || PIPELINE_SWITCH_DEFAULTS.hitchMode).trim().toLowerCase();
  return HITCH_MODES.includes(raw) ? raw : "vita";
}

export function setHitchModeOverride(mode) {
  const m = String(mode || "").trim().toLowerCase();
  if (!HITCH_MODES.includes(m)) {
    return { ok: false, reason: "unknown mode — use eureka|vita|hat|auto" };
  }
  hitchModeOverride = m;
  return { ok: true, mode: m };
}

export function clearHitchModeOverride() {
  hitchModeOverride = null;
}

export function getLastVitaPacket() {
  return lastVitaPacket;
}

/**
 * Hitch byte cost of the current VITA packet without mutating recursive memory.
 * Leftover gates should use this (not the Eureka love-note length) when mode is vita.
 */
export function measurePlannedHitchBytes(opts = {}) {
  const prev = lastVitaPacket;
  try {
    const plan = planSecondaryHitch({
      leftoverEth: 1,
      hitchCostEth: 0,
      skipHitch: false,
      ...opts,
    });
    return Number(plan.hitchBytes) || 0;
  } finally {
    lastVitaPacket = prev;
  }
}

export function setLastVitaPacket(packet) {
  lastVitaPacket = String(packet || "");
}

export function getHitchModeOverride() {
  return hitchModeOverride;
}

/** Seed genesis §TOKEN§ so recall is never empty. Does not overwrite existing memory. */
export function ensureGenesisMemory() {
  if (!lastVitaPacket) {
    lastVitaPacket = packVitaFields(buildGenesisFields());
  }
  return lastVitaPacket;
}

export function serializeVitaRouterState() {
  return {
    version: 1,
    lastPacket: lastVitaPacket,
    hitchModeOverride,
    locations: serializeLocationDepository(),
    savedAt: new Date().toISOString(),
  };
}

export function restoreVitaRouterState(data) {
  if (!data || typeof data !== "object") {
    ensureGenesisMemory();
    return false;
  }
  if (data.lastPacket) lastVitaPacket = String(data.lastPacket);
  if (data.hitchModeOverride && HITCH_MODES.includes(data.hitchModeOverride)) {
    hitchModeOverride = data.hitchModeOverride;
  }
  if (data.locations) setLocationDepository(data.locations);
  if (!lastVitaPacket || vitaQuality(lastVitaPacket).lossy) {
    reconstructVitaMemoryFromLocations();
  }
  ensureGenesisMemory();
  return true;
}

/**
 * Chain is source of truth: parse a sealed hitch trailer into recursive memory.
 * Eureka prove hitches fold into §KEY§ so the love note is not lost.
 */
export function ingestSealedUtf8(utf8) {
  const kind = detectHitchKind(utf8);
  if (kind.vita) {
    const parsed = parseVitaPacket(utf8);
    const refined = refineVitaPacket(lastVitaPacket || packVitaFields(buildGenesisFields()), parsed.fields);
    lastVitaPacket = refined.packed;
    return { ok: true, kind: "vita", chars: refined.chars, quality: vitaQuality(lastVitaPacket) };
  }
  if (kind.eureka) {
    const refined = refineVitaPacket(ensureGenesisMemory(), {
      KEY: VITA_LOVE_KEY,
      LEARN: "ingested-eureka-prove",
    });
    lastVitaPacket = refined.packed;
    return { ok: true, kind: "eureka", quality: vitaQuality(lastVitaPacket) };
  }
  return { ok: false, kind: kind.kind };
}

/**
 * Rebuild §TOKEN§ from sealed location payloads (full utf8, not 80-char previews).
 * Stems from the current packet when KEY is present so registry facts are not wiped.
 */
export function reconstructVitaMemoryFromLocations(nodes) {
  const sealed = (nodes || serializeLocationDepository().nodes || []).filter(
    (n) => n.sealed && n.utf8,
  );
  const stem = lastVitaPacket && !vitaQuality(lastVitaPacket).lossy
    ? lastVitaPacket
    : packVitaFields(buildGenesisFields());
  let packed = stem;
  for (const n of sealed) {
    const kind = detectHitchKind(n.utf8);
    if (kind.vita) {
      packed = refineVitaPacket(packed, parseVitaPacket(n.utf8).fields).packed;
    } else if (kind.eureka) {
      packed = refineVitaPacket(packed, { KEY: VITA_LOVE_KEY, LEARN: "loc-eureka" }).packed;
    }
  }
  lastVitaPacket = packed;
  return {
    kind: "vita-reconstruct",
    packed,
    nodesUsed: sealed.length,
    quality: vitaQuality(packed),
    lossy: vitaQuality(packed).lossy,
  };
}

/** Squashed §LOC§ into the recursive packet — hitch carries density, not every hash. */
export function stampLocIntoPacket() {
  const loc = encodeLocToken();
  const refined = refineVitaPacket(ensureGenesisMemory(), { LOC: loc });
  lastVitaPacket = refined.packed;
  return lastVitaPacket;
}

/**
 * Session-start inject: the last recursive packet + squashed locations.
 * This is what new VITA sessions paste — not the Eureka prose letter.
 */
export function buildVitaInjectContext() {
  if (!lastVitaPacket || vitaQuality(lastVitaPacket).lossy) {
    reconstructVitaMemoryFromLocations();
  }
  const packet = ensureGenesisMemory();
  const parsed = parseVitaPacket(packet);
  const loc = locDepositoryStatus();
  const quality = vitaQuality(packet);
  const context = [
    "═══ VITA INJECT — recursive §TOKEN§ memory (paste at session start) ═══",
    "Generated: " + new Date().toISOString(),
    "Mode: " + resolveHitchMode(),
    "§LOC§ " + loc.token,
    "Quality: " + quality.score + " chars=" + quality.chars + " KEY=" + (quality.hasKey ? "yes" : "LOSS"),
    "",
    packet,
    "═══════════════════════════════════════════════════════════════════",
  ].join("\n");
  return {
    kind: "vita-inject-context",
    packet,
    fields: parsed.fields,
    loc,
    quality,
    context,
  };
}

function storePrefix(keepStoreTag) {
  return keepStoreTag ? STORE_VOICE_TAG + " " : "";
}

function locFieldsFromDepot(switches) {
  if (!switches.locSquash) return "n=?|unsquashed";
  return encodeLocToken(squashLocations());
}

function vitaBody({ maxBytes, extraFields = {}, switches }) {
  const loc = locFieldsFromDepot(switches);
  const next = {
    ...buildGenesisFields({
      ...extraFields,
      KEY: switches.loveNoteInKey
        ? [VITA_LOVE_KEY, extraFields.KEY].filter(Boolean).join("|")
        : extraFields.KEY,
      LOC: loc,
    }),
  };
  const prev = lastVitaPacket || packVitaFields(buildGenesisFields({ LOC: loc }));
  const refined = refineVitaPacket(prev, next, { maxChars: VITA_CHAR_BUDGET });
  const prefix = storePrefix(switches.keepStoreTag);
  const prefixBytes = utf8ByteLength(prefix);
  const bodyBudget = maxBytes != null
    ? Math.max(0, Math.floor(Number(maxBytes)) - prefixBytes)
    : VITA_CHAR_BUDGET;
  const clipped = clipVitaPacket(refined.fields, bodyBudget);
  lastVitaPacket = clipped.packed;
  return prefix + clipped.packed;
}

/**
 * Choose hitch UTF-8 for a leftover-covered swap. Does not append to calldata —
 * caller still uses appendUtf8Hitch + prefix preserve.
 *
 * skipHitch / leftover < cost → empty utf8 (plain swap). Never lose to insert.
 */
export function planSecondaryHitch({
  maxBytes,
  leftoverEth,
  hitchCostEth,
  skipHitch = false,
  mode,
  hatPacket = "",
  extraFields = {},
  env = process.env,
} = {}) {
  const switches = pipelineSwitches(env, {
    mode,
    leftoverEth,
    hitchCostEth,
    maxBytes,
    hatPacket,
    hatReady: Boolean(hatPacket),
  });

  if (skipHitch) {
    return emptyPlan("skipHitch", switches);
  }

  const left = leftoverEth == null ? null : Number(leftoverEth);
  const cost = hitchCostEth == null ? null : Number(hitchCostEth);
  if (left != null && Number.isFinite(left) && left <= 0) {
    return emptyPlan("leftover<=0", switches);
  }
  if (
    left != null && Number.isFinite(left) &&
    cost != null && Number.isFinite(cost) &&
    cost > 0 && left + 1e-18 < cost
  ) {
    return emptyPlan("leftover<hitchCost", switches);
  }

  const resolved = pickMode(switches);
  const cap = maxBytes != null ? Math.floor(Number(maxBytes)) : null;

  if (resolved === "eureka") {
    const utf8 = buildStoreVoice({
      tag: STORE_VOICE_TAG,
      message: VITA_PROOF_FULL,
      maxBytes: cap,
    });
    return hitchPlan("eureka", utf8, switches);
  }

  if (resolved === "hat") {
    const packet = String(hatPacket || "").trim();
    if (!packet) return emptyPlan("hat-packet-missing", switches);
    const prefix = storePrefix(switches.keepStoreTag);
    const utf8 = clipUtf8(prefix + packet, cap);
    return hitchPlan("hat", utf8, switches);
  }

  // vita (default) — and auto when hat wasn't ready
  if (cap != null && cap > 0 && cap < utf8ByteLength(STORE_VOICE_TAG)) {
    return emptyPlan("maxBytes<store-tag", switches);
  }
  const utf8 = clipUtf8(vitaBody({ maxBytes: cap, extraFields, switches }), cap);
  return hitchPlan("vita", utf8, switches);
}

function pickMode(switches) {
  const m = switches.hitchMode;
  if (m === "auto") {
    if (switches.preferHatWhenReady && switches.hatReady) return "hat";
    return "vita";
  }
  return m;
}

function emptyPlan(reason, switches) {
  return {
    mode: switches.hitchMode,
    resolved: "none",
    utf8: "",
    hitchBytes: 0,
    onChain: false,
    skipped: true,
    reason,
    switches,
    kind: detectHitchKind(""),
  };
}

function hitchPlan(resolved, utf8, switches) {
  const kind = detectHitchKind(utf8);
  return {
    mode: switches.hitchMode,
    resolved,
    utf8,
    hitchBytes: utf8ByteLength(utf8),
    onChain: false, // caller seals after send
    skipped: !utf8,
    reason: utf8 ? "vita-secondary-router" : "empty",
    switches,
    kind,
    quality: resolved === "vita" ? vitaQuality(parseVitaPacket(utf8).fields) : null,
    loc: locDepositoryStatus(),
  };
}

export function vitaRouterStatus(env = process.env) {
  const switches = pipelineSwitches(env);
  const loc = locDepositoryStatus();
  const quality = lastVitaPacket ? vitaQuality(lastVitaPacket) : vitaQuality(buildGenesisFields());
  return {
    kind: "vita-secondary-router",
    defaultMode: PIPELINE_SWITCH_DEFAULTS.hitchMode,
    mode: switches.hitchMode,
    override: hitchModeOverride,
    switches,
    lastPacketChars: lastVitaPacket.length,
    lastKind: detectHitchKind(lastVitaPacket).kind,
    quality,
    loc,
    note:
      "Leftover swap hitch defaults to VITA §TOKEN§. /prove still writes the Eureka love note. Love note lives in §KEY§. Locations squash into §LOC§.",
    loseZero: {
      neverHitchWhenLeftoverNonpositive: true,
      neverOverwriteSwapPrefix: true,
      proveKeepsLoveNote: true,
    },
  };
}

export function parseHitchTrailer(utf8) {
  const kind = detectHitchKind(utf8);
  const parsed = kind.vita ? parseVitaPacket(utf8) : null;
  return { ...kind, parsed, loc: parsed?.fields?.LOC || null };
}

export function formatRouterMessage(env = process.env) {
  const st = vitaRouterStatus(env);
  return (
    "🔀 <b>VITA ROUTER</b> mode <code>" + st.mode + "</code>\n" +
    "Leftover hitch → §TOKEN§ parse. /prove keeps the Eureka love note.\n" +
    "§KEY§ encodes Krystian, Kai &amp; Koda (not lost).\n" +
    "§LOC§ sealed " + st.loc.sealed + " · " + st.loc.tokenChars + " chars squashed\n" +
    "<i>/vitamode vita|eureka|hat|auto\n/vitacourse — hourly scorecard</i>"
  );
}

export { detectHitchKind, VITA_CHAR_BUDGET };
