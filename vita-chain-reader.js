/**
 * ⛓️ VITA CHAIN READER — leftover hitch UTF-8 from Base calldata
 * ─────────────────────────────────────────────────────────────────────────────
 * Primary router prefix (Uniswap V3 exactInputSingle, 228 bytes) is never
 * parsed as memory. Secondary hitch is the UTF-8 trailer — §TOKEN§, HAT,
 * or the Eureka /prove letter.
 *
 * KEYCAT 0x5c0a93e4… is a documented lie: 228-byte prefix, no hitch.
 * vault-loader fetchTxCalldata already decodes whole input as UTF-8 (vault
 * inscriptions). This reader fetches *hex* so V3 trailers survive.
 */

import {
  KEYCAT_PLAIN_SWAP,
  decodeStoreVoiceCalldata,
  decodeTrailingUtf8,
} from "./swap-minout.js";
import { detectHitchKind, vitaQuality } from "./vita-parse.js";
import {
  getLastVitaPacket,
  ingestSealedUtf8,
  reconstructVitaMemoryFromLocations,
  ensureGenesisMemory,
  restoreVitaRouterState,
  stampLocIntoPacket,
} from "./vita-router.js";
import {
  getLocationDepository,
  ingestLocationFromChain,
} from "./vita-locations.js";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const KEYCAT_HEX = String(KEYCAT_PLAIN_SWAP || "").toLowerCase();

/** Live Base anchors — fetched and parsed this session. Never invent hashes. */
export const KEYCAT_TX = "0x5c0a93e4707a4dcf49afd4c785cb2829bce11ed026e08ba08435272d19122adf";
export const EUREKA_ONCHAIN_TX = "0xd9827a9c70c78be7e165934b101b8774c10fdfe8d9720bafd293fff4e5203d73";
export const VITA_STRAND_TX = "0x931d84115692190a393b3a040debc5145bf8f05c8ad359ba61b861f6dbfb19db";

export const KNOWN_CHAIN_ANCHORS = Object.freeze([
  { tx: KEYCAT_TX, expect: "none", note: "KEYCAT plain 228-byte swap — no hitch" },
  { tx: EUREKA_ONCHAIN_TX, expect: "eureka", note: "Eureka love note on Base" },
  { tx: VITA_STRAND_TX, expect: "vita", note: "VITA §TOKEN§ strand chunk on Base" },
]);

export const INGESTIBLE_HITCH_KINDS = Object.freeze(["vita", "eureka", "hat", "tag"]);
export const MAX_BOOT_CHAIN_PULLS = 12;

export function shouldIngestHitchKind(kind) {
  const k = typeof kind === "string" ? kind : kind?.kind;
  return INGESTIBLE_HITCH_KINDS.includes(k);
}

function looksLikeHexCalldata(data) {
  const s = String(data || "").trim();
  return /^0x[0-9a-fA-F]+$/.test(s) && s.length >= 10;
}

/** Recover hitch text from hex-decoded garbage or already-decoded UTF-8. */
export function extractEmbeddedHitch(text) {
  const s = String(text || "");
  if (!s) return "";
  const store = s.indexOf("§$STORE§");
  if (store >= 0) return s.slice(store);
  const token = s.search(/§(SESS|WHO|STACK|BUILT|PROVED|ARCH|VISION|NEXT|KEY|LEARN|LOC|HAT)§/);
  if (token >= 0) return s.slice(token);
  const eureka = s.search(/Eureka!/i);
  if (eureka >= 0) return s.slice(eureka);
  return "";
}

export function readHitchUtf8FromCalldata(data) {
  const raw = String(data || "");
  if (!raw || raw === "0x") {
    return { utf8: "", kind: detectHitchKind(""), source: "empty" };
  }

  if (looksLikeHexCalldata(raw)) {
    const hex = raw.toLowerCase();
    if (KEYCAT_HEX && hex === KEYCAT_HEX) {
      return { utf8: "", kind: detectHitchKind(""), source: "keycat-plain" };
    }
    const trailing = decodeTrailingUtf8(hex);
    if (trailing) {
      return { utf8: trailing, kind: detectHitchKind(trailing), source: "v3-trailer" };
    }
    const voice = decodeStoreVoiceCalldata(hex);
    const embedded = extractEmbeddedHitch(voice);
    if (embedded) {
      return { utf8: embedded, kind: detectHitchKind(embedded), source: "store-voice" };
    }
    return { utf8: "", kind: detectHitchKind(""), source: "no-hitch" };
  }

  const embedded = extractEmbeddedHitch(raw);
  if (embedded) {
    return { utf8: embedded, kind: detectHitchKind(embedded), source: "utf8" };
  }
  return { utf8: "", kind: detectHitchKind(""), source: "no-hitch" };
}

export async function fetchTxCalldataHex(txHash) {
  const hash = String(txHash || "").trim();
  if (!TX_HASH_RE.test(hash)) throw new Error("need 0x + 64 hex");

  try {
    const url = "https://api.basescan.org/api?module=proxy&action=eth_getTransactionByHash&txhash=" + hash;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const data = await res.json();
      const hex = data?.result?.input;
      if (hex && hex !== "0x") return hex;
    }
  } catch { /* fall through to public Base RPC */ }

  try {
    const res = await fetch("https://mainnet.base.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionByHash",
        params: [hash],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json();
      const hex = data?.result?.input;
      if (hex && hex !== "0x") return hex;
    }
  } catch { /* throw below */ }

  throw new Error("Could not fetch tx " + hash.slice(0, 10) + " from chain");
}

export async function pullLocationFromChain(txHash, fetchCalldata = fetchTxCalldataHex) {
  const hash = String(txHash || "").trim();
  if (!TX_HASH_RE.test(hash)) {
    return { ok: false, error: "need 0x + 64 hex" };
  }
  if (typeof fetchCalldata !== "function") {
    return { ok: false, error: "no fetchCalldata", txHash: hash };
  }
  let data;
  try {
    data = await fetchCalldata(hash);
  } catch (e) {
    return { ok: false, error: e.message || "fetch failed", txHash: hash };
  }
  if (!data) return { ok: false, error: "no calldata", txHash: hash };

  const read = readHitchUtf8FromCalldata(data);
  if (!read.utf8 || !shouldIngestHitchKind(read.kind)) {
    return {
      ok: true,
      txHash: hash,
      utf8: shouldIngestHitchKind(read.kind) ? read.utf8 : "",
      kind: read.kind.kind,
      source: read.source,
      ingested: false,
    };
  }

  ingestLocationFromChain(hash, read.utf8, read.kind.kind);
  const ingest = ingestSealedUtf8(read.utf8);
  const rec = reconstructVitaMemoryFromLocations();
  const packet = getLastVitaPacket();
  return {
    ok: true,
    txHash: hash,
    utf8: read.utf8,
    kind: read.kind.kind,
    source: read.source,
    ingested: Boolean(ingest.ok),
    packet,
    quality: vitaQuality(packet),
    reconstructed: rec,
  };
}

export async function pullMissingLocationUtf8(fetchCalldata = fetchTxCalldataHex) {
  const dep = getLocationDepository();
  const missing = (dep.nodes || []).filter(
    (n) => n.sealed && n.location && (!n.utf8 || String(n.utf8).length < 40),
  );
  const results = [];
  for (const n of missing) {
    try {
      results.push(await pullLocationFromChain(n.location, fetchCalldata));
    } catch (e) {
      results.push({ ok: false, txHash: n.location, error: e.message });
    }
  }
  return { pulled: results.length, results };
}

const TX_HASH_PICK = /0x[0-9a-fA-F]{64}/g;

export function walkVitaRegistryEntries(registry) {
  if (!registry) return [];
  const entries = [];
  const push = (v) => {
    if (v && typeof v === "object" && (v.tokenPacket || v.txHashes || v.chunks || v.encryptedContent)) {
      entries.push(v);
    }
  };
  if (Array.isArray(registry)) registry.forEach(push);
  else if (typeof registry === "object") {
    if (Array.isArray(registry.registry)) registry.registry.forEach(push);
    if (Array.isArray(registry.strands)) registry.strands.forEach(push);
    if (Array.isArray(registry._ikn?.strands)) registry._ikn.strands.forEach(push);
    for (const v of Object.values(registry)) push(v);
  }
  const seen = new Set();
  return entries.filter((e) => {
    const key = (e.strandId || e.label || e.tokenPacket || "").slice(0, 80) + "|" + JSON.stringify(e.txHashes || []).slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function collectRegistryTxHashes(registry) {
  const hashes = [];
  for (const e of walkVitaRegistryEntries(registry)) {
    for (const h of e.txHashes || []) {
      if (TX_HASH_RE.test(String(h))) hashes.push(String(h));
    }
    for (const c of e.chunks || []) {
      if (c?.txHash && TX_HASH_RE.test(String(c.txHash))) hashes.push(String(c.txHash));
    }
    const blob = String(e.tokenPacket || "");
    for (const m of blob.match(TX_HASH_PICK) || []) hashes.push(m);
  }
  return [...new Set(hashes.map((h) => h.toLowerCase()))];
}

/** Restore saved packet, then fold registry on top — never the reverse (that wipes). */
export function hydrateVitaRecursiveMemory({ routerState = null, registry = null } = {}) {
  if (routerState) restoreVitaRouterState(routerState);
  else ensureGenesisMemory();
  const folded = ingestRegistryPackets(registry);
  reconstructVitaMemoryFromLocations();
  stampLocIntoPacket();
  return {
    registryPackets: folded.ingested,
    quality: vitaQuality(getLastVitaPacket()),
    packet: getLastVitaPacket(),
  };
}

/** Fold registry §TOKEN§ packets into recursive memory (no RPC). KEY is never dropped. */
export function ingestRegistryPackets(registry) {
  ensureGenesisMemory();
  let n = 0;
  for (const e of walkVitaRegistryEntries(registry)) {
    const packet = String(e.tokenPacket || e.encryptedContent || "");
    if (!packet) continue;
    const r = ingestSealedUtf8(packet);
    if (r.ok) n += 1;
  }
  return { ingested: n, quality: vitaQuality(getLastVitaPacket()), packet: getLastVitaPacket() };
}

/**
 * Inject VITA blockchain memory: registry packets + known Base anchors +
 * recent strand txHashes. Does not invent hashes. Does not ingest LIBM/binary.
 */
export async function injectVitaBlockchainMemory({
  fetchCalldata = fetchTxCalldataHex,
  registry = null,
  hashes = [],
  maxPulls = MAX_BOOT_CHAIN_PULLS,
} = {}) {
  ensureGenesisMemory();
  const fromRegistry = ingestRegistryPackets(registry);
  const want = [
    ...KNOWN_CHAIN_ANCHORS.map((a) => a.tx),
    ...collectRegistryTxHashes(registry),
    ...(hashes || []),
  ].filter((h) => TX_HASH_RE.test(h));
  const unique = [...new Set(want.map((h) => h.toLowerCase()))];
  const cap = Math.max(0, Math.floor(Number(maxPulls) || 0));
  const toPull = unique.slice(0, cap);
  const results = [];
  for (const h of toPull) {
    try {
      results.push(await pullLocationFromChain(h, fetchCalldata));
    } catch (e) {
      results.push({ ok: false, txHash: h, error: e.message });
    }
  }
  const rec = reconstructVitaMemoryFromLocations();
  stampLocIntoPacket();
  const packet = getLastVitaPacket();
  return {
    kind: "vita-chain-inject",
    registryPackets: fromRegistry.ingested,
    pulled: results.length,
    ingested: results.filter((r) => r.ingested).length,
    results,
    packet,
    quality: vitaQuality(packet),
    reconstructed: rec,
    loc: getLocationDepository(),
  };
}
