import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  liveGithubToken,
  liveGithubRepo,
  liveStateBranch,
  liveGithubBranch,
  githubAuthHeaders,
  githubContentsApiUrl,
  githubContentsUrl,
  githubReadAuthFailed,
  shouldRetryGithubRead,
  decodeGithubContentsJson,
} from "./github-contents.js";

const root = dirname(fileURLToPath(import.meta.url));

describe("github-contents — token / branch / header", () => {
  it("uses token prefix not Bearer (same as IKN / githubGet)", () => {
    const h = githubAuthHeaders("  ghp_liveFromVault  ");
    assert.equal(h.Authorization, "token ghp_liveFromVault");
    assert.ok(!String(h.Authorization).startsWith("Bearer"));
    assert.equal(h.Accept, "application/vnd.github.v3+json");
    const empty = githubAuthHeaders("   ");
    assert.equal(empty.Authorization, undefined);
  });

  it("reads token/repo from env at call time (vault-loaded, not module snapshot)", () => {
    const env = { GITHUB_TOKEN: " ghp_after_vault ", GITHUB_REPO: " masterledgerlive/guardian-protocol-agent " };
    assert.equal(liveGithubToken(env), "ghp_after_vault");
    assert.equal(liveGithubRepo(env), "masterledgerlive/guardian-protocol-agent");
    assert.equal(liveGithubToken({}), "");
  });

  it("state reads default to bot-state and do not inherit GITHUB_BRANCH", () => {
    assert.equal(liveStateBranch({ GITHUB_BRANCH: "main" }), "bot-state");
    assert.equal(liveStateBranch({}), "bot-state");
    assert.equal(liveStateBranch({ STATE_BRANCH: "bot-state", GITHUB_BRANCH: "main" }), "bot-state");
    assert.equal(liveGithubBranch({ GITHUB_BRANCH: "main" }), "main");
    const url = githubContentsUrl({
      repo: "masterledgerlive/guardian-protocol-agent",
      filename: "ledger.json",
      branch: liveStateBranch({ GITHUB_BRANCH: "main" }),
      cacheBust: false,
    });
    assert.ok(url.includes("/contents/ledger.json?ref=bot-state"));
    assert.ok(!url.includes("ref=main"));
    assert.equal(
      githubContentsApiUrl({ repo: "owner/repo", filename: "fifo-lots.json" }),
      "https://api.github.com/repos/owner/repo/contents/fifo-lots.json",
    );
  });

  it("does not retry 401/403/404", () => {
    assert.equal(githubReadAuthFailed(401), true);
    assert.equal(githubReadAuthFailed(403), true);
    assert.equal(githubReadAuthFailed(404), false);
    assert.equal(shouldRetryGithubRead(401), false);
    assert.equal(shouldRetryGithubRead(403), false);
    assert.equal(shouldRetryGithubRead(404), false);
    assert.equal(shouldRetryGithubRead(500), true);
    assert.equal(shouldRetryGithubRead(0), true);
  });

  it("decodes GitHub contents JSON (newlines stripped)", () => {
    const blob = { lots: { AERO: { ethIn: 1, tokensIn: 2 } } };
    const b64 = Buffer.from(JSON.stringify(blob), "utf8").toString("base64");
    const wrapped = b64.replace(/(.{20})/g, "$1\n");
    assert.deepEqual(decodeGithubContentsJson({ content: wrapped, sha: "abc" }), blob);
    assert.equal(decodeGithubContentsJson({}), null);
  });

  it("agent.js ledger/fifo-lots path uses live token + no Bearer", () => {
    const src = readFileSync(join(root, "agent.js"), "utf8");
    assert.ok(src.includes('from "./github-contents.js"'));
    assert.ok(src.includes("liveGithubToken()"));
    assert.ok(src.includes("liveStateBranch()"));
    assert.ok(src.includes("githubAuthHeaders(liveGithubToken())"));
    assert.ok(src.includes("rebuildSeededLotsFromChain"));
    assert.ok(src.includes("github-401"));
    assert.ok(src.includes("seededRebuildRemaining"));
    assert.ok(src.includes("tokenHasKnownFifoCost"));
    const cacheFill = src.indexOf("tokenBalanceCache[result.value.symbol] = result.value.bal");
    const seeded = src.indexOf("await rebuildSeededLotsFromChain(");
    assert.ok(cacheFill >= 0 && seeded > cacheFill, "seeded rebuild must run after balance cache fill");
    assert.ok(!src.includes("Bearer ${process.env.GITHUB_TOKEN}"));
    assert.ok(!src.includes("const [owner, repo] = (process.env.GITHUB_REPO || \"\").split(\"/\")"));
  });
});
