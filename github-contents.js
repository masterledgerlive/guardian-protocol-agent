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
 */

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

export function decodeGithubContentsJson(data) {
  if (!data || typeof data.content !== "string") return null;
  const decoded = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
  return JSON.parse(decoded);
}
