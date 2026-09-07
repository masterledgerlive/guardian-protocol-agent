/**
 * Base RPC pool — env-first, no dead public nodes in rotation.
 *
 * Railway sets BASE_RPC / RPC_URL / BASE_RPC_URL to https://mainnet.base.org.
 * Those must win over any hardcoded public list. base.llamarpc.com returns
 * Cloudflare 521 and must never be first-class (or in the rotation at all).
 */

export const DEAD_RPC_HOSTS = ["base.llamarpc.com"];

export const DEFAULT_PUBLIC_RPCS = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
  "https://base.meowrpc.com",
  "https://base-pokt.nodies.app",
  "https://gateway.tenderly.co/public/base",
];

export function normalizeRpcUrl(url) {
  return String(url ?? "").trim().replace(/\/+$/, "");
}

export function isDeadPublicRpc(url) {
  const host = normalizeRpcUrl(url).toLowerCase();
  return DEAD_RPC_HOSTS.some((h) => host.includes(h));
}

/** Prefer BASE_RPC, then RPC_URL, then BASE_RPC_URL. Comma/space separated OK. */
export function collectEnvRpcUrls(env = process.env) {
  const raw = env.BASE_RPC || env.RPC_URL || env.BASE_RPC_URL || "";
  return String(raw)
    .split(/[\s,]+/)
    .map(normalizeRpcUrl)
    .filter((u) => /^https?:\/\//i.test(u));
}

export function buildRpcUrls(env = process.env) {
  const seen = new Set();
  const out = [];
  for (const url of [...collectEnvRpcUrls(env), ...DEFAULT_PUBLIC_RPCS]) {
    const n = normalizeRpcUrl(url);
    const key = n.toLowerCase();
    if (!n || seen.has(key) || isDeadPublicRpc(n)) continue;
    seen.add(key);
    out.push(n);
  }
  return out.length ? out : ["https://mainnet.base.org"];
}

/**
 * Transport / HTTP failures that must rotate to the next RPC.
 * A Cloudflare 521 must never abort the loop and kill main().
 */
export function isRpcFailoverError(err) {
  if (!err) return true;
  const status = Number(err.status ?? err.statusCode ?? err.cause?.status);
  if (Number.isFinite(status) && (status === 429 || status >= 500)) return true;
  const msg = [
    err.message,
    err.shortMessage,
    err.details,
    err.code,
    status,
  ].filter(Boolean).join(" ").toLowerCase();
  return (
    msg.includes("521") ||
    msg.includes("520") ||
    msg.includes("522") ||
    msg.includes("523") ||
    msg.includes("524") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("500") ||
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("over rate") ||
    msg.includes("rpc timeout") ||
    msg.includes("timeout") ||
    msg.includes("quota") ||
    msg.includes("exceeded") ||
    msg.includes("resource not found") ||
    msg.includes("too many") ||
    msg.includes("unavailable") ||
    msg.includes("cloudflare") ||
    msg.includes("web server is down") ||
    msg.includes("fetch failed") ||
    msg.includes("http request failed") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("socket") ||
    msg.includes("returned no data") ||
    msg.includes("\"0x\"")
  );
}

/**
 * Try each RPC URL. Any single failure (including 521) continues.
 * Throws only after the full list is exhausted.
 */
export async function withRpcFailover(urls, callFn, { onFail } = {}) {
  const list = Array.isArray(urls) && urls.length ? urls : ["https://mainnet.base.org"];
  let lastErr;
  for (let i = 0; i < list.length; i++) {
    const url = list[i];
    try {
      return await callFn(url, i);
    } catch (e) {
      lastErr = e;
      if (typeof onFail === "function") onFail(url, e, i);
    }
  }
  const hint = lastErr?.message || "unknown";
  throw new Error(`All RPCs unavailable: ${hint}`);
}
