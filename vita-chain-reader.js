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
import { detectHitchKind, refineVitaPacket, vitaQuality } from "./vita-parse.js";
import {
  getLastVitaPacket,
  ingestSealedUtf8,
  reconstructVitaMemoryFromLocations,
  ensureGenesisMemory,
  restoreVitaRouterState,
  stampLocIntoPacket,
  setLastVitaPacket,
} from "./vita-router.js";
import {
  getLocationDepository,
  ingestLocationFromChain,
} from "./vita-locations.js";
import { recordLeftoverKinds } from "./vita-course.js";

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
export const MAX_BOOT_CHAIN_PULLS = 64;
export const GUARDIAN_WALLET = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
export const UNISWAP_V3_ROUTER = "0x2626664c2603336e57b271c5c0b26f421741e481";
export const EXACT_INPUT_SELECTOR = "04e45aaf";
export const EXACT_INPUT_BYTES = 228;
export const BLOCKSCOUT_TX_PAGE = "https://base.blockscout.com/api/v2/addresses/";

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

/** Classify a Uniswap V3 leftover hitch trailer. Never invents a hash. */
export function classifyLeftoverHitch(data) {
  const raw = String(data || "");
  const read = readHitchUtf8FromCalldata(raw);
  if (!looksLikeHexCalldata(raw)) {
    return { class: "not-hex", leftover: false, ...read };
  }
  const hex = raw.toLowerCase();
  const body = hex.slice(2);
  if (!body.startsWith(EXACT_INPUT_SELECTOR)) {
    return { class: "not-v3", leftover: false, ...read };
  }
  const bytes = body.length / 2;
  if (bytes <= EXACT_INPUT_BYTES) {
    return { class: "plain-228", leftover: false, ...read };
  }
  if (read.kind.vita) return { class: "vita-leftover", leftover: true, ...read };
  if (read.kind.eureka) return { class: "eureka-leftover", leftover: true, ...read };
  if (read.kind.hat) return { class: "hat-leftover", leftover: true, ...read };
  if (/LIBM/i.test(read.utf8 || "")) return { class: "libm", leftover: true, ...read };
  return { class: "trailer-other", leftover: true, ...read };
}

export function blockscoutTxListUrl(address = GUARDIAN_WALLET, nextPageParams = null) {
  const params = new URLSearchParams();
  if (nextPageParams && typeof nextPageParams === "object") {
    for (const [k, v] of Object.entries(nextPageParams)) {
      if (v != null && v !== "") params.set(k, String(v));
    }
  }
  const q = params.toString();
  return BLOCKSCOUT_TX_PAGE + address + "/transactions" + (q ? "?" + q : "");
}

export async function fetchRecentWalletTransactions(address = GUARDIAN_WALLET, {
  limit = 50,
  maxPages = 6,
  fetchImpl = fetch,
} = {}) {
  const want = Math.max(1, Math.floor(Number(limit) || 50));
  const pages = Math.max(1, Math.floor(Number(maxPages) || 6));
  const items = [];
  let next = null;
  for (let page = 0; page < pages && items.length < want; page++) {
    const url = blockscoutTxListUrl(address, next);
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "vita-chain-reader" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error("wallet tx list HTTP " + res.status);
    const data = await res.json();
    const batch = Array.isArray(data?.items) ? data.items : [];
    items.push(...batch);
    next = data?.next_page_params || null;
    if (!next || batch.length === 0) break;
  }
  return items.slice(0, want).map((t) => {
    const to = t.to && typeof t.to === "object" ? t.to.hash : t.to;
    return {
      hash: t.hash,
      to: String(to || "").toLowerCase(),
      input: t.raw_input || t.input || "",
      timestamp: t.timestamp || null,
    };
  });
}

/**
 * Scan recent Uniswap leftover hitches for this wallet.
 * Production on main still hitches Eureka prose; this branch hitches KEY+LOC.
 */
export async function scanAddressLeftoverHitches({
  address = GUARDIAN_WALLET,
  limit = 50,
  maxPages = 6,
  fetchTxs = fetchRecentWalletTransactions,
} = {}) {
  const txs = await fetchTxs(address, { limit, maxPages });
  const rows = [];
  const counts = { eureka: 0, vita: 0, plain: 0, libm: 0, other: 0, leftover: 0 };
  for (const tx of txs) {
    if (String(tx.to || "").toLowerCase() !== UNISWAP_V3_ROUTER) {
      rows.push({ hash: tx.hash, class: "not-router", timestamp: tx.timestamp });
      counts.other += 1;
      continue;
    }
    const cls = classifyLeftoverHitch(tx.input);
    const row = {
      hash: tx.hash,
      class: cls.class,
      leftover: cls.leftover,
      kind: cls.kind?.kind || cls.class,
      utf8: cls.utf8 || "",
      timestamp: tx.timestamp,
    };
    rows.push(row);
    if (cls.class === "eureka-leftover") counts.eureka += 1;
    else if (cls.class === "vita-leftover") counts.vita += 1;
    else if (cls.class === "plain-228") counts.plain += 1;
    else if (cls.class === "libm") counts.libm += 1;
    else counts.other += 1;
    if (cls.leftover) counts.leftover += 1;
  }
  return {
    kind: "vita-leftover-scan",
    address,
    scanned: rows.length,
    counts,
    rows,
    leftoverKinds: counts,
    leftoverStillEureka: counts.eureka > 0 && counts.vita === 0,
    vitaLeftoverPresent: counts.vita > 0,
  };
}

const LEFTOVER_SCAN_TTL_MS = 60_000;
let leftoverScanCache = { at: 0, scan: null };

export async function getCachedLeftoverScan(opts = {}) {
  const now = Date.now();
  if (!opts.force && leftoverScanCache.scan && now - leftoverScanCache.at < LEFTOVER_SCAN_TTL_MS) {
    return leftoverScanCache.scan;
  }
  const scan = await scanAddressLeftoverHitches(opts);
  leftoverScanCache = { at: now, scan };
  return scan;
}

/** Public reader view — hashes + class, no hitch utf8 (HTML pulls locations itself). */
export function publicLeftoverScanView(scan) {
  const s = scan || {};
  return {
    kind: s.kind || "vita-leftover-scan",
    address: s.address || GUARDIAN_WALLET,
    scanned: s.scanned || 0,
    counts: s.counts || s.leftoverKinds || { eureka: 0, vita: 0, plain: 0, libm: 0, other: 0, leftover: 0 },
    leftoverKinds: s.counts || s.leftoverKinds || null,
    leftoverStillEureka: Boolean(s.leftoverStillEureka),
    vitaLeftoverPresent: Boolean(s.vitaLeftoverPresent),
    rows: (s.rows || [])
      .filter((r) => r.leftover || r.class === "plain-228")
      .slice(0, 24)
      .map((r) => ({
        hash: r.hash,
        class: r.class,
        leftover: Boolean(r.leftover),
        timestamp: r.timestamp || null,
      })),
  };
}

/** Fold scanned leftover hitch UTF-8 into recursive memory. Skip LIBM. */
export function ingestLeftoverScan(scan) {
  ensureGenesisMemory();
  const counts = scan?.counts || scan?.leftoverKinds || null;
  recordLeftoverKinds(counts);
  let ingested = 0;
  for (const row of scan?.rows || []) {
    if (!TX_HASH_RE.test(String(row.hash || ""))) continue;
    if (!row.utf8 || row.class === "libm") continue;
    if (row.class !== "vita-leftover" && row.class !== "eureka-leftover" && row.class !== "hat-leftover") {
      continue;
    }
    const hitchKind = row.class === "eureka-leftover" ? "eureka" : row.class === "hat-leftover" ? "hat" : "vita";
    ingestLocationFromChain(row.hash, row.utf8, hitchKind);
    const r = ingestSealedUtf8(row.utf8);
    if (r.ok) ingested += 1;
  }
  reconstructVitaMemoryFromLocations();
  const eureka = Number(counts?.eureka || 0);
  const vita = Number(counts?.vita || 0);
  const still = Boolean(scan?.leftoverStillEureka) || (eureka > 0 && vita === 0);
  const refined = refineVitaPacket(getLastVitaPacket(), {
    LEARN: "leftover-scan eureka=" + eureka + " vita=" + vita + " stillEureka=" + (still ? "1" : "0"),
    NEXT: vita > 0
      ? "leftover=VITA-KEY+LOC;/prove=Eureka"
      : "next leftover hitch=KEY+LOC;/prove=Eureka",
  });
  if (refined.fields.KEY) setLastVitaPacket(refined.packed);
  stampLocIntoPacket();
  return {
    ingested,
    quality: vitaQuality(getLastVitaPacket()),
    packet: getLastVitaPacket(),
    leftoverStillEureka: still,
    leftoverKinds: counts,
  };
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

export async function fetchPublicVitaRegistry({
  repo = process.env.GITHUB_REPO || "masterledgerlive/guardian-protocol-agent",
  branch = process.env.STATE_BRANCH || "bot-state",
} = {}) {
  const url = `https://api.github.com/repos/${repo}/contents/vita-registry.json?ref=${branch}&t=${Date.now()}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "vita-chain-reader" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const meta = await res.json();
  if (!meta?.content) return null;
  const raw = Buffer.from(String(meta.content).replace(/\n/g, ""), "base64").toString("utf8");
  return JSON.parse(raw);
}

function alreadyHasUtf8(hash) {
  const loc = String(hash || "").toLowerCase();
  return (getLocationDepository().nodes || []).some(
    (n) => String(n.location || "").toLowerCase() === loc && String(n.utf8 || "").length >= 40,
  );
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
  fetchPublic = false,
} = {}) {
  ensureGenesisMemory();
  let reg = registry;
  if (!reg && fetchPublic) {
    try { reg = await fetchPublicVitaRegistry(); } catch { reg = null; }
  }
  const fromRegistry = ingestRegistryPackets(reg);
  const anchors = KNOWN_CHAIN_ANCHORS.filter((a) => a.expect !== "none").map((a) => a.tx);
  const want = [
    ...anchors,
    ...collectRegistryTxHashes(reg),
    ...(hashes || []),
  ].filter((h) => TX_HASH_RE.test(h));
  const unique = [...new Set(want.map((h) => h.toLowerCase()))].filter((h) => !alreadyHasUtf8(h));
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
