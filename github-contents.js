/**
 * GitHub contents API helpers for ledger / fifo-lots / positions.
 *
 * Live Railway + IKN paths use `Authorization: token <PAT>` and read state
 * from STATE_BRANCH (default bot-state). `githubGetFromBranch` used Bearer
 * and a module-load snapshot of GITHUB_TOKEN / STATE_BRANCH — vault-loaded
 * keys never reached the header, and GITHUB_BRANCH leaked into state reads
 * (fine-grained PATs then 401 on main).
 *
 * Always resolve token/repo/branch from process.env at call time.
 * Never invent secrets. 401/403 → caller rebuilds from buy-hash receipts.
 * Never wipe a populated in-memory book or a fresh local snapshot on 401.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";


export function liveGithubToken(env = process.env) {
  return String(env?.GITHUB_TOKEN || "").trim();
}

export function liveGithubRepo(env = process.env) {
  return String(env?.GITHUB_REPO || "").trim();
}

/** State files live on bot-state. Do not inherit GITHUB_BRANCH (deploy watch). */
export function liveStateBranch(env = process.env) {
  const explicit = String(env?.STATE_BRANCH || "").trim();
  return explicit || "bot-state";
}

export function liveGithubBranch(env = process.env) {
  const explicit = String(env?.GITHUB_BRANCH || "").trim();
  return explicit || "main";
}

/** Classic + fine-grained PAT prefix used by githubGet / IKN — not Bearer. */
export function githubAuthHeaders(token, extra = {}) {
  const t = String(token || "").trim();
  const headers = { Accept: "application/vnd.github.v3+json", ...extra };
  if (t) headers.Authorization = `token ${t}`;
  return headers;
}

export function githubContentsApiUrl({ repo, filename } = {}) {
  const r = String(repo || "").trim();
  const file = String(filename || "").replace(/^\/+/, "");
  return `https://api.github.com/repos/${r}/contents/${file}`;
}

export function githubContentsUrl({
  repo,
  filename,
  branch,
  cacheBust = true,
  now = Date.now,
} = {}) {
  const ref = String(branch || "").trim() || "bot-state";
  let url = `${githubContentsApiUrl({ repo, filename })}?ref=${encodeURIComponent(ref)}`;
  if (cacheBust) url += `&t=${Number(typeof now === "function" ? now() : now) || 0}`;
  return url;
}

export function githubReadAuthFailed(status) {
  const n = Number(status);
  return n === 401 || n === 403;
}

export function shouldRetryGithubRead(status) {
  if (status == null) return true;
  if (githubReadAuthFailed(status)) return false;
  if (Number(status) === 404) return false;
  return Number(status) >= 500 || Number(status) === 0;
}

/** Decode GitHub Contents API blob as UTF-8 (js/md/json/html). Never invents. */
export function decodeGithubContentsUtf8(data) {
  if (!data || typeof data.content !== "string") return null;
  try {
    return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
  } catch {
    return null;
  }
}

export function decodeGithubContentsJson(data) {
  const decoded = decodeGithubContentsUtf8(data);
  if (decoded == null) return null;
  return JSON.parse(decoded);
}

/** GitHub blob page — code lane (main) or state lane (bot-state). */
export function githubBlobHtmlUrl({ repo, filename, branch } = {}) {
  const r = String(repo || "").trim();
  const file = String(filename || "").replace(/^\/+/, "");
  const ref = String(branch || "").trim() || "main";
  if (!r || !file) return null;
  return `https://github.com/${r}/blob/${encodeURIComponent(ref)}/${file}`;
}

export function localStatePath(filename, { cwd = process.cwd() } = {}) {
  return join(cwd, String(filename || "").replace(/^\/+/, ""));
}

export function readLocalStateJson(filename, {
  cwd = process.cwd(),
  fsRead = readFileSync,
  fsExists = existsSync,
} = {}) {
  const p = localStatePath(filename, { cwd });
  if (!fsExists(p)) return null;
  try {
    const raw = fsRead(p, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLocalStateJson(filename, value, {
  cwd = process.cwd(),
  fsWrite = writeFileSync,
} = {}) {
  const p = localStatePath(filename, { cwd });
  fsWrite(p, JSON.stringify(value, null, 2), "utf8");
  return p;
}

export function isFreshLocalState(blob, {
  now = Date.now(),
  maxAgeMs = 7 * 24 * 3600 * 1000,
} = {}) {
  const ts = blob?.lastSaved || blob?.savedAt || blob?.updatedAt;
  if (!ts) return false;
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return false;
  const n = typeof now === "function" ? now() : Number(now);
  return (n - t) <= maxAgeMs;
}

export function latestHistoryReadingMs(history) {
  let max = 0;
  for (const slot of Object.values(history && typeof history === "object" ? history : {})) {
    const readings = slot?.readings || [];
    for (const r of readings) {
      const t = Number(r?.t || r?.time || r?.ts);
      if (t > max) max = t;
    }
    const lp = Number(slot?.lastTs || slot?.updatedAt);
    if (lp > max) max = lp;
  }
  return max;
}

function nonemptyState(v) {
  if (v == null || typeof v !== "object") return false;
  if (Array.isArray(v)) return v.length > 0;
  return Object.keys(v).length > 0;
}

/**
 * GitHub 401/403/empty must not wipe FIFO / history.
 * Do not load stale committed tokens.json (ghost ADD_ON).
 */
export function preferRemoteOrKeep({
  remote,
  status,
  current,
  local = null,
  allowLocal = true,
  localFresh = true,
} = {}) {
  if (nonemptyState(remote)) return { source: "remote", value: remote };
  const authFail = githubReadAuthFailed(status);
  if (nonemptyState(current)) {
    return { source: "memory", value: current, kept: true, authFail };
  }
  if (allowLocal && localFresh && nonemptyState(local)) {
    return { source: "local", value: local, authFail };
  }
  return {
    source: "empty",
    value: current && typeof current === "object" ? current : {},
    wiped: false,
    authFail,
  };
}
