/**
 * GitHub Contents auth/path used by fifo-lots.json + ledger.json.
 *
 * Live #79: `githubGetFromBranch(ledger.json)` sent `Authorization: Bearer …`
 * and got HTTP 401×3. The working Railway pattern (githubGet, IKN, vita)
 * is `Authorization: token ${GITHUB_TOKEN}` and
 * `https://api.github.com/repos/${GITHUB_REPO}/contents/…`.
 *
 * Resolve the token at call time (vault may inject after module load).
 * GitHub 401 must not block seeded buy-hash FIFO rebuild.
 */

export function resolveGithubToken(env = process.env) {
  const raw = String(env?.GITHUB_TOKEN || env?.GH_TOKEN || "").trim();
  return raw.replace(/^(?:token|bearer)\s+/i, "");
}

export function resolveGithubRepo(env = process.env) {
  return String(env?.GITHUB_REPO || env?.GH_REPO || "").trim();
}

/** Same header the rest of the agent already uses for Contents API. */
export function githubAuthHeaders(env = process.env) {
  const token = resolveGithubToken(env);
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (token) headers.Authorization = `token ${token}`;
  return headers;
}

export function githubContentsUrl(filename, {
  repo,
  branch,
  env = process.env,
  cacheBust = true,
} = {}) {
  const r = String(repo || resolveGithubRepo(env) || "").replace(/^\/+|\/+$/g, "");
  const path = String(filename || "").replace(/^\/+/, "");
  const b = branch ? `ref=${encodeURIComponent(branch)}` : "";
  const t = cacheBust ? `t=${Date.now()}` : "";
  const q = [b, t].filter(Boolean).join("&");
  return `https://api.github.com/repos/${r}/contents/${path}${q ? `?${q}` : ""}`;
}

export function shouldRetryGithubRead(status) {
  const n = Number(status);
  if (n === 401 || n === 403) return false;
  return true;
}

export function githubReadDenied(status) {
  const n = Number(status);
  return n === 401 || n === 403;
}
