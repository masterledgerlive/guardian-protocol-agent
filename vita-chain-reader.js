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
} from "./vita-router.js";
import {
  getLocationDepository,
  ingestLocationFromChain,
} from "./vita-locations.js";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const KEYCAT_HEX = String(KEYCAT_PLAIN_SWAP || "").toLowerCase();

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
  if (!read.utf8) {
    return {
      ok: true,
      txHash: hash,
      utf8: "",
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
