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

/**
 * Clip a packed packet to maxChars without dropping KEY/LOC while they fit.
 * Other fields drop from the tail of TOKEN_HITCH_PRIORITY.
 */
export function clipVitaPacket(fields, maxChars = VITA_CHAR_BUDGET) {
  const cap = Math.max(0, Math.floor(Number(maxChars) || 0));
  const keep = { ...fields };
  let packed = packVitaFields(keep);
  if (packed.length <= cap) return { fields: keep, packed, clipped: false };

  const dropOrder = [...TOKEN_HITCH_PRIORITY].reverse().filter((k) => k !== "KEY" && k !== "LOC");
  for (const key of dropOrder) {
    if (packed.length <= cap) break;
    if (keep[key] == null) continue;
    delete keep[key];
    packed = packVitaFields(keep);
  }

  if (packed.length > cap && keep.LEARN) {
    keep.LEARN = clipTail(keep.LEARN, Math.max(24, cap - 80));
    packed = packVitaFields(keep);
  }
  if (packed.length > cap && keep.KEY) {
    keep.KEY = clipTail(keep.KEY, Math.max(40, Math.floor(cap * 0.45)));
    packed = packVitaFields(keep);
  }
  if (packed.length > cap && keep.LOC) {
    keep.LOC = clipTail(keep.LOC, Math.max(24, Math.floor(cap * 0.4)));
    packed = packVitaFields(keep);
  }
  if (packed.length > cap) {
    packed = packed.slice(0, Math.max(0, cap));
  }
  return { fields: keep, packed, clipped: true };
}

function clipTail(s, max) {
  const t = String(s || "");
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + "…";
}

/**
 * Merge prev packet + new facts. Recursive memory: last strand becomes
 * the stem; new facts overwrite denser values; KEY/LOC union.
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
    if (key === "SESS" || key === "LEARN") {
      merged[key] = b != null && b !== "" ? b : a;
    } else {
      merged[key] = mergeFact(a, b);
    }
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

/** Abbreviate the genesis love note into a KEY fact — never drop the names. */
export const VITA_LOVE_KEY =
  "eureka♥Krystian,Kai,Koda|DA|ᛞᚨᚡᛁᛞ|truth=chain|IKN|wallet=0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915|KEYCAT-0x5c0a93e4=plain-no-hitch";

export function buildGenesisFields(extra = {}) {
  const date = new Date().toISOString().slice(0, 10);
  return {
    SESS: extra.SESS || (date + "|vita-router|eureka→§TOKEN§ parse+loc-squash"),
    WHO: extra.WHO || "DA|VITA|secondary-router",
    STACK: extra.STACK || "V3-hitch|Base|§TOKEN§|HAT|lose-zero",
    BUILT: extra.BUILT || "vita-parse|vita-locations|vita-router|vita-course",
    PROVED: extra.PROVED || "STORE-tag-10B✓|prefix-preserve✓|lose-zero-no-hitch-if-leftover≤0✓",
    ARCH: extra.ARCH || "router:eureka|vita|hat|auto;/prove=love-note-genesis;loc=append-only-squash",
    VISION: extra.VISION || "recursive-mem;inject-w/o-loss;hourly-course",
    NEXT: extra.NEXT || "hourly:sealed-locs vs skip-rate;refine squash;pipeline switches",
    KEY: mergeFact(VITA_LOVE_KEY, extra.KEY || ""),
    LEARN: extra.LEARN || "prose-letter wastes hitch B;§TOKEN§ denser recall;squash>list-every-tx;keep §$STORE§ tag",
    LOC: extra.LOC || "n=0|tip=00000000",
  };
}

export function buildGenesisPacket(extra = {}) {
  return packVitaFields(buildGenesisFields(extra));
}
