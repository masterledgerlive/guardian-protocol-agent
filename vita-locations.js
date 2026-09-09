/**
 * 📍 VITA LOCATION DEPOSITORY — append-only, then squash
 * ─────────────────────────────────────────────────────────────────────────────
 * Railway / hitch / HAT already store *locations* (tx hashes, node ids), never
 * plaintext. This depository is the finer-tuned index: every sealed location
 * is kept, but hitch payloads only carry a squashed §LOC§ token
 * (count + root + tip + last-N short hashes) so many chain pointers fit in
 * one reasonable hitch.
 *
 * Never delete. Never claim sealed without a location string. Unsealed
 * (planned) entries do not advance the tip.
 */

import { createHash } from "crypto";

let locNodes = [];
let locSeq = 0;
let lastLocHash = "00000000";

/** Max short hashes in a hitch §LOC§ token (the squash window). */
export const LOC_SQUASH_DELTA = 6;

export function locHash(text) {
  return createHash("sha256").update(String(text || "")).digest("hex").slice(0, 8);
}

export function shortLoc(location) {
  const s = String(location || "").replace(/^0x/i, "").toLowerCase();
  if (!s) return "00000000";
  return s.slice(0, 8);
}

export function getLocationDepository() {
  return {
    seq: locSeq,
    lastHash: lastLocHash,
    neverDelete: true,
    nodes: locNodes.slice(),
    sealedCount: locNodes.filter((n) => n.sealed && n.location).length,
    pendingCount: locNodes.filter((n) => !n.sealed).length,
  };
}

export function setLocationDepository(data) {
  if (!data) return;
  locSeq = Number(data.seq) || 0;
  lastLocHash = data.lastHash || "00000000";
  locNodes = Array.isArray(data.nodes) ? data.nodes.slice() : [];
}

export function serializeLocationDepository() {
  return getLocationDepository();
}

export function resetLocationDepository() {
  locNodes = [];
  locSeq = 0;
  lastLocHash = "00000000";
}

export function tryDeleteLocation() {
  return {
    ok: false,
    reason: "location depository is append-only — never deleted. Squash for hitch; keep the chain.",
  };
}

/**
 * Append a location. Unsealed (no location / planned) does not move the tip
 * used by readers. Sealed requires a real location string (tx hash or nodeId).
 */
export function recordLocation({
  location = null,
  kind = "hitch",
  utf8 = "",
  symbol = "",
  sealed = false,
  hitchKind = null,
} = {}) {
  const sealedOk = Boolean(sealed && location);
  const node = {
    seq: locSeq++,
    kind: String(kind || "hitch"),
    location: location || null,
    locationShort: location ? shortLoc(location) : null,
    sealed: sealedOk,
    utf8: String(utf8 || "").slice(0, 4096),
    utf8Preview: String(utf8 || "").slice(0, 80),
    hitchKind: hitchKind || null,
    symbol: symbol || null,
    prevHash: lastLocHash,
    hash: locHash((location || "") + "|" + locSeq + "|" + lastLocHash),
    savedAt: new Date().toISOString(),
    confirmed: sealedOk,
  };
  locNodes.push(node);
  if (sealedOk) lastLocHash = node.hash;
  return node;
}

/** Fill location on an existing unsealed node — seal only, never rewrite payload. */
export function sealLocation(seqOrHash, location) {
  const loc = String(location || "").trim();
  if (!loc) return { ok: false, reason: "no location — refuse to claim sealed" };
  const node = locNodes.find((n) => n.seq === seqOrHash || n.hash === seqOrHash || n.location === seqOrHash);
  if (!node) return { ok: false, reason: "node not found" };
  if (node.sealed && node.location && node.location !== loc) {
    return { ok: false, reason: "already sealed to a different location — append a new node" };
  }
  node.location = loc;
  node.locationShort = shortLoc(loc);
  node.sealed = true;
  node.confirmed = true;
  lastLocHash = node.hash;
  return { ok: true, node };
}

export function squashLocations(nodes = locNodes, { maxDelta = LOC_SQUASH_DELTA } = {}) {
  const sealed = (nodes || []).filter((n) => n.sealed && n.location);
  const n = sealed.length;
  const root = sealed[0]?.location || "";
  const tip = sealed[n - 1]?.location || "";
  const window = Math.max(1, Math.floor(Number(maxDelta) || LOC_SQUASH_DELTA));
  const delta = sealed.slice(-window).map((e) => e.locationShort || shortLoc(e.location));
  const kinds = {};
  for (const e of sealed) {
    kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  }
  const pending = (nodes || []).filter((n) => !n.sealed).length;
  return {
    n,
    root: n ? shortLoc(root) : "00000000",
    tip: n ? shortLoc(tip) : "00000000",
    delta,
    kinds,
    pending,
    lastHash: lastLocHash,
  };
}

/** Compact hitch body (no §LOC§ wrapper). Full hashes stay in the depository. */
function hitchShort(s, n = 6) {
  const hex = String(s || "").replace(/^0x/i, "").toLowerCase();
  if (!hex) return "0".repeat(n);
  return hex.slice(0, n);
}

export function encodeLocToken(depot) {
  const d = depot || squashLocations();
  if (!d.n) return "n=0|tip=000000";
  const kindBits = Object.entries(d.kinds || {})
    .map(([k, v]) => {
      const code = k === "hat" ? "H" : k === "prove" ? "p" : "t";
      return code + v;
    })
    .join(",");
  const parts = [
    "n=" + d.n,
    "tip=" + hitchShort(d.tip),
    "root=" + hitchShort(d.root),
    "Δ=" + (d.delta || []).map((x) => hitchShort(x)).join(","),
  ];
  if (kindBits) parts.push("k=" + kindBits);
  if (d.pending) parts.push("p=" + d.pending);
  return parts.join("|");
}

export function parseLocToken(token) {
  const raw = String(token || "").replace(/^§LOC§/, "").trim();
  const out = { n: 0, tip: "00000000", root: "00000000", delta: [], kinds: {}, pending: 0 };
  if (!raw) return out;
  for (const part of raw.split("|")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (k === "n") out.n = Number(v) || 0;
    else if (k === "tip") out.tip = v;
    else if (k === "root") out.root = v;
    else if (k === "Δ" || k === "d") out.delta = v ? v.split(",").filter(Boolean) : [];
    else if (k === "p") out.pending = Number(v) || 0;
    else if (k === "k") {
      for (const bit of v.split(",").filter(Boolean)) {
        const letter = bit[0];
        const count = Number(bit.slice(1)) || 0;
        const name = letter === "t" || letter === "h" ? "hitch" : letter === "p" ? "prove" : letter === "H" ? "hat" : bit;
        out.kinds[name] = count;
      }
    }
  }
  return out;
}

/** Fill utf8 on an existing sealed node from chain read — never deletes. */
export function fillLocationUtf8(location, utf8) {
  const loc = String(location || "").trim();
  const raw = String(utf8 || "");
  if (!loc || !raw) return { ok: false, reason: "need location + utf8" };
  const locLc = loc.toLowerCase();
  const node = locNodes.find((n) => String(n.location || "").toLowerCase() === locLc);
  if (!node) return { ok: false, reason: "node not found" };
  node.utf8 = raw.slice(0, 4096);
  node.utf8Preview = raw.slice(0, 80);
  node.sealed = true;
  node.confirmed = true;
  return { ok: true, node };
}

/**
 * Seal a chain hitch into the append-only depository. Fills an existing
 * node when present; otherwise appends. Never deletes.
 */
export function ingestLocationFromChain(location, utf8, hitchKind = "hitch") {
  const filled = fillLocationUtf8(location, utf8);
  if (filled.ok) return { ...filled, created: false };
  const kind = hitchKind === "eureka" ? "prove" : hitchKind === "prove" ? "prove" : "hitch";
  const node = recordLocation({
    location,
    kind,
    sealed: true,
    utf8,
    hitchKind: typeof hitchKind === "string" ? hitchKind : null,
  });
  return { ok: true, node, created: true };
}

export function locDepositoryStatus() {
  const depot = squashLocations();
  const token = encodeLocToken(depot);
  return {
    kind: "vita-location-depository",
    neverDelete: true,
    sealed: depot.n,
    pending: depot.pending,
    tip: depot.tip,
    root: depot.root,
    token: "§LOC§" + token,
    tokenChars: token.length,
    squashWindow: LOC_SQUASH_DELTA,
    note: "Hitch carries squashed §LOC§; full locations stay append-only in registry.",
  };
}
