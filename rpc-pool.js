/**
 * Base RPC pool — env-first, no dead public nodes in rotation.
 *
 * Railway sets BASE_RPC / RPC_URL / BASE_RPC_URL to https://mainnet.base.org.
 * Those must win over any hardcoded public list. Code defaults match so a
 * process restart without env still hits official Base first (balanceOf /
 * AERO buys must not start on 429 hosts).
 *
 * base.llamarpc.com returns Cloudflare 521 and must never be first-class
 * (or in the rotation at all).
 *
 * base.meowrpc.com / base.drpc.org 429 under desk load — last-resort only,
 * never early failover. Official Base + publicnode + nodies + tenderly stay
 * ahead of them.
 */

export const DEAD_RPC_HOSTS = ["base.llamarpc.com"];

/** 429-prone public endpoints — last-resort only, never first-class. */
export const RATE_LIMITED_RPC_HOSTS = ["base.meowrpc.com", "base.drpc.org"];

export const PREFERRED_PUBLIC_RPCS = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://base-pokt.nodies.app",
  "https://gateway.tenderly.co/public/base",
];

export const RATE_LIMITED_PUBLIC_RPCS = [
  "https://base.drpc.org",
  "https://base.meowrpc.com",
];

export const DEFAULT_PUBLIC_RPCS = [
  ...PREFERRED_PUBLIC_RPCS,
  ...RATE_LIMITED_PUBLIC_RPCS,
];

export function normalizeRpcUrl(url) {
  return String(url ?? "").trim().replace(/\/+$/, "");
}

export function isDeadPublicRpc(url) {
  const host = normalizeRpcUrl(url).toLowerCase();
  return DEAD_RPC_HOSTS.some((h) => host.includes(h));
}

export function isRateLimitedPublicRpc(url) {
  const host = normalizeRpcUrl(url).toLowerCase();
  return RATE_LIMITED_RPC_HOSTS.some((h) => host.includes(h));
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
  // Env first (as written), then reliable publics, then 429 hosts last.
  const candidates = [
    ...collectEnvRpcUrls(env),
    ...PREFERRED_PUBLIC_RPCS,
    ...RATE_LIMITED_PUBLIC_RPCS,
  ];
  for (const url of candidates) {
    const n = normalizeRpcUrl(url);
    const key = n.toLowerCase();
    if (!n || seen.has(key) || isDeadPublicRpc(n)) continue;
    seen.add(key);
    out.push(n);
  }
  // Env may have listed meowrpc/drpc first; keep those hosts last-resort
  // unless they are the only URLs left. Official Base stays #1 when present.
  const preferred = [];
  const limited = [];
  for (const url of out) {
    (isRateLimitedPublicRpc(url) ? limited : preferred).push(url);
  }
  const ordered = [...preferred, ...limited];
  return ordered.length ? ordered : ["https://mainnet.base.org"];
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
