/**
 * 💓 VITA PARSE — §TOKEN§ agentic memory language
 * ─────────────────────────────────────────────────────────────────────────────
 * Written BY VITA FOR VITA. Dense semantic tokens, not human prose.
 * Compress toward 2000 chars. Preserve critical facts. Never drop KEY / LOC.
 *
 * Tokens:
 *   §SESS§ §WHO§ §STACK§ §BUILT§ §PROVED§ §ARCH§ §VISION§ §NEXT§ §KEY§ §LEARN§ §LOC§
 */

export const VITA_CHAR_BUDGET = 2000;

export const TOKEN_ORDER = Object.freeze([
  "SESS", "WHO", "STACK", "BUILT", "PROVED", "ARCH", "VISION", "NEXT", "KEY", "LEARN", "LOC",
]);

/** Strand chunk groups — same map as vita-memory.js 5-chunk split. */
export const TOKEN_GROUP_MAP = Object.freeze({
  SESS: 0, WHO: 0, STACK: 0,
  BUILT: 1, PROVED: 1,
  ARCH: 2, VISION: 2,
  NEXT: 3, KEY: 3,
  LEARN: 4, LOC: 4,
});

/** Hitch clip priority — KEY + LOC never dropped while they still fit. */
export const TOKEN_HITCH_PRIORITY = Object.freeze([
  "LOC", "KEY", "LEARN", "NEXT", "SESS", "PROVED", "BUILT", "ARCH", "VISION", "WHO", "STACK",
]);

/**
 * Leftover swap hitch is a dense projection of recursive memory.
 * Full WHO/STACK/ARCH/VISION stay in lastPacket + the location depository;
 * the trailer only carries recall-critical tokens so leftover can cover.
 */
export const TOKEN_LEFTOVER_KEEP = Object.freeze(["KEY", "LOC"]);

/** Love-note names — leftover clip must not drop these from §KEY§. */
export const VITA_KEY_NAMES = "eureka♥Krystian,Kai,Koda";

/** Abbreviate the genesis love note into a KEY fact — never drop the names. */
export const VITA_LOVE_KEY =
  "eureka♥Krystian,Kai,Koda|DA|ᛞᚨᚡᛁᛞ|truth=chain|IKN|wallet=0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915|KEYCAT-0x5c0a93e4=plain-no-hitch";

const TOKEN_RE = /§([A-Z]+)§([^§]*)/g;

export function parseVitaPacket(text) {
  const raw = String(text || "");
  const fields = {};
  const order = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(raw))) {
    const key = m[1];
    const val = String(m[2] || "").replace(/^\n+|\n+$/g, "").trim();
    if (!TOKEN_ORDER.includes(key) && key !== "STRAND" && key !== "HASHES" && key !== "SIGN") {
      continue;
    }
    if (fields[key] != null && val) {
      fields[key] = mergeFact(fields[key], val);
    } else if (fields[key] == null) {
      fields[key] = val;
      order.push(key);
    }
  }
  return {
    kind: "vita-token",
    fields,
    order: order.length ? order : TOKEN_ORDER.filter((k) => fields[k] != null),
    chars: packVitaFields(fields).length,
    raw,
  };
}

export function packVitaFields(fields, { order = TOKEN_ORDER } = {}) {
  const parts = [];
  for (const key of order) {
    const val = fields[key];
    if (val == null || val === "") continue;
    parts.push("§" + key + "§" + String(val).trim());
  }
  return parts.join("\n");
}

function mergeFact(a, b) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left) return right;
  if (!right || left.includes(right)) return left;
  if (right.includes(left)) return right;
  const parts = [...new Set([...left.split("|"), ...right.split("|")].map((s) => s.trim()).filter(Boolean))];
  return parts.join("|");
}

/** Hitch §LOC§ is a squash token — never union n=0 with a denser encoding. */
export function locCount(token) {
  const m = String(token || "").match(/(?:^|\|)n=(\d+)/);
  return m ? Number(m[1]) || 0 : 0;
}

export function mergeLocToken(prev, next) {
  const a = String(prev || "").trim();
  const b = String(next || "").trim();
  if (!b) return a;
  if (!a) return b;
  const na = locCount(a);
  const nb = locCount(b);
  if (nb === 0 && na > 0) return a;
  if (na > nb) return a;
  return b;
}

export function measureVitaText(text, { bytes = false } = {}) {
  const s = String(text || "");
  if (!bytes) return s.length;
  if (typeof Buffer !== "undefined") return Buffer.byteLength(s, "utf8");
  return new TextEncoder().encode(s).length;
}

/** Leftover hitch body: KEY + squashed LOC. Recursive packet stays whole. */
export function projectLeftoverHitchFields(fields) {
  const src = fields?.fields || fields || {};
  const keep = { KEY: src.KEY || VITA_LOVE_KEY };
  if (src.LOC) keep.LOC = src.LOC;
  return keep;
}

/**
 * Clip a packed packet to maxChars (or byteBudget) without dropping KEY/LOC
 * while they fit. Other fields drop from the tail of TOKEN_HITCH_PRIORITY.
 */
export function clipVitaPacket(fields, maxChars = VITA_CHAR_BUDGET, opts = {}) {
  const useBytes = opts.byteBudget != null;
  const cap = Math.max(0, Math.floor(Number(useBytes ? opts.byteBudget : maxChars) || 0));
  const measure = (s) => measureVitaText(s, { bytes: useBytes });
  const keep = { ...fields };
  let packed = packVitaFields(keep);
  if (measure(packed) <= cap) return { fields: keep, packed, clipped: false };

  const dropOrder = [...TOKEN_HITCH_PRIORITY].reverse().filter((k) => k !== "KEY" && k !== "LOC");
  for (const key of dropOrder) {
    if (measure(packed) <= cap) break;
    if (keep[key] == null) continue;
    delete keep[key];
    packed = packVitaFields(keep);
  }

  if (measure(packed) > cap && keep.LEARN) {
    keep.LEARN = clipToMeasure(keep.LEARN, Math.max(24, cap - 80), measure);
    packed = packVitaFields(keep);
  }
  if (measure(packed) > cap && keep.KEY) {
    keep.KEY = clipKeyPreservingNames(keep.KEY, Math.max(VITA_KEY_NAMES.length, Math.floor(cap * 0.45)), measure);
    packed = packVitaFields(keep);
  }
  if (measure(packed) > cap && keep.LOC) {
    keep.LOC = clipToMeasure(keep.LOC, Math.max(24, Math.floor(cap * 0.4)), measure);
    packed = packVitaFields(keep);
  }
  if (measure(packed) > cap) {
    packed = clipToMeasure(packed, cap, measure);
  }
  return { fields: keep, packed, clipped: true };
}

function clipToMeasure(s, max, measure) {
  let t = String(s || "");
  const cap = Math.max(0, Math.floor(Number(max) || 0));
  if (measure(t) <= cap) return t;
  const ell = "…";
  let withEll = t;
  while (withEll.length && measure(withEll + ell) > cap) withEll = withEll.slice(0, -1);
  if (withEll && measure(withEll + ell) <= cap) return withEll + ell;
  while (t.length && measure(t) > cap) t = t.slice(0, -1);
  return t;
}

function clipKeyPreservingNames(key, max, measure) {
  const raw = String(key || "");
  const clipped = clipToMeasure(raw, max, measure);
  if (clipped.includes("Krystian") && clipped.includes("Kai") && clipped.includes("Koda")) {
    return clipped;
  }
  const stem = VITA_KEY_NAMES;
  if (measure(stem) >= max) return clipToMeasure(stem, max, measure);
  return mergeFact(stem, clipped);
}

/**
 * Merge prev packet + new facts. Recursive memory: last strand becomes
 * the stem. KEY unions. §LOC§ is a squash token — keep the denser n=,
 * never concatenate n=0 with a sealed encoding.
 */
export function refineVitaPacket(prevPacketOrFields, nextFields = {}, { maxChars = VITA_CHAR_BUDGET } = {}) {
  const prev = typeof prevPacketOrFields === "string"
    ? parseVitaPacket(prevPacketOrFields).fields
    : (prevPacketOrFields?.fields || prevPacketOrFields || {});
  const merged = {};
  for (const key of TOKEN_ORDER) {
    const a = prev[key];
    const b = nextFields[key];
    if (a == null && b == null) continue;
    merged[key] = key === "LOC" ? mergeLocToken(a, b) : mergeFact(a, b);
  }
  const clipped = clipVitaPacket(merged, maxChars);
  return {
    fields: clipped.fields,
    packed: clipped.packed,
    chars: clipped.packed.length,
    clipped: clipped.clipped,
    withinBudget: clipped.packed.length <= maxChars,
  };
}

export function vitaQuality(packetOrFields) {
  const parsed = typeof packetOrFields === "string"
    ? parseVitaPacket(packetOrFields)
    : { fields: packetOrFields?.fields || packetOrFields || {}, chars: 0 };
  const fields = parsed.fields || {};
  const packed = packVitaFields(fields);
  const hasKey = Boolean(fields.KEY);
  const hasLoc = Boolean(fields.LOC);
  const factKeys = TOKEN_ORDER.filter((k) => fields[k]);
  const over = packed.length > VITA_CHAR_BUDGET;
  let score = 0;
  if (hasKey) score += 30;
  if (hasLoc) score += 25;
  score += Math.min(30, factKeys.length * 3);
  if (packed.length > 0 && packed.length <= VITA_CHAR_BUDGET) score += 15;
  if (over) score = Math.max(0, score - 20);
  return {
    score,
    chars: packed.length,
    factKeys,
    hasKey,
    hasLoc,
    withinBudget: !over,
    lossy: !hasKey,
  };
}

/**
 * Detect hitch trailer kind so the secondary router can switch parsers.
 * Eureka love-note is the old path; VITA tokens and HAT are the new ones.
 */
export function detectHitchKind(utf8) {
  const s = String(utf8 || "");
  if (!s.trim()) return { kind: "none", eureka: false, vita: false, hat: false, storeTag: false };
  const storeTag = s.includes("§$STORE§");
  const hat = s.includes("§HAT§");
  const vita = /§(SESS|WHO|STACK|BUILT|PROVED|ARCH|VISION|NEXT|KEY|LEARN|LOC)§/.test(s);
  const eureka = /Eureka!/i.test(s) || /love you Krystian/i.test(s);
  let kind = "unknown";
  if (hat) kind = "hat";
  else if (vita) kind = "vita";
  else if (eureka) kind = "eureka";
  else if (storeTag) kind = "tag";
  return { kind, eureka, vita, hat, storeTag };
}

export function buildGenesisFields(extra = {}) {
  const date = new Date().toISOString().slice(0, 10);
  return {
    SESS: extra.SESS || (date + "|vita-router|eureka→§TOKEN§ parse+loc-squash"),
    WHO: extra.WHO || "DA|VITA|secondary-router",
    STACK: extra.STACK || "V3-hitch|Base|§TOKEN§|HAT|lose-zero",
    BUILT: extra.BUILT || "vita-parse|vita-locations|vita-router|vita-course",
    PROVED: extra.PROVED || "STORE-tag-10B✓|prefix-preserve✓|lose-zero-no-hitch-if-leftover≤0✓|leftover-hitch≠clip-packet✓",
    ARCH: extra.ARCH || "router:eureka|vita|hat|auto;/prove=love-note-genesis;loc=append-only-squash",
    VISION: extra.VISION || "recursive-mem;inject-w/o-loss;hourly-course",
    NEXT: extra.NEXT || "leftover=KEY+LOC hitch;full packet in state;hourly course",
    KEY: mergeFact(VITA_LOVE_KEY, extra.KEY || ""),
    LEARN: extra.LEARN || "prose-letter wastes hitch B;§TOKEN§ denser recall;squash>list-every-tx;hitch≠lastPacket;keep §$STORE§ tag",
    LOC: extra.LOC || "n=0|t=0000",
  };
}

export function buildGenesisPacket(extra = {}) {
  return packVitaFields(buildGenesisFields(extra));
}
