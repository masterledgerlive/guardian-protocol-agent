import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEAD_RPC_HOSTS,
  DEMOTE_RPC_HOSTS,
  DEFAULT_PUBLIC_RPCS,
  HEALTHY_PUBLIC_RPCS,
  DEMOTED_PUBLIC_RPCS,
  normalizeRpcUrl,
  isDeadPublicRpc,
  isDemotedPublicRpc,
  collectEnvRpcUrls,
  buildRpcUrls,
  isRpcFailoverError,
  withRpcFailover,
} from "./rpc-pool.js";
import { readFileSync } from "node:fs";
import { isAddrInUseError, handleWebhookListenError } from "./vita-webhook.js";
import {
  queueOperatorBuyOnce,
  markOperatorBuyExecuted,
  clearOperatorBuyIfNotExecuted,
} from "./lose-zero-gate.js";

describe("env RPC preference", () => {
  it("prefers BASE_RPC over RPC_URL over BASE_RPC_URL over public list", () => {
    const urls = buildRpcUrls({
      BASE_RPC: "https://mainnet.base.org",
      RPC_URL: "https://example.invalid/rpc",
      BASE_RPC_URL: "https://other.invalid/rpc",
    });
    assert.equal(urls[0], "https://mainnet.base.org");
    assert.ok(!urls.some((u) => u.includes("example.invalid")));
  });

  it("falls through BASE_RPC → RPC_URL → BASE_RPC_URL", () => {
    assert.deepEqual(collectEnvRpcUrls({ RPC_URL: "https://mainnet.base.org" }), [
      "https://mainnet.base.org",
    ]);
    assert.deepEqual(collectEnvRpcUrls({ BASE_RPC_URL: "https://mainnet.base.org/" }), [
      "https://mainnet.base.org",
    ]);
    assert.deepEqual(collectEnvRpcUrls({}), []);
  });

  it("dedupes env URL against the public fallback list", () => {
    const urls = buildRpcUrls({ BASE_RPC: "https://mainnet.base.org" });
    assert.equal(urls.filter((u) => u === "https://mainnet.base.org").length, 1);
    assert.ok(urls.includes("https://base-rpc.publicnode.com"));
  });
});

describe("meowrpc/drpc are last-resort (429-prone free pools)", () => {
  it("lists official Base and healthier publics before meowrpc/drpc", () => {
    assert.equal(DEFAULT_PUBLIC_RPCS[0], "https://mainnet.base.org");
    assert.deepEqual(HEALTHY_PUBLIC_RPCS, [
      "https://mainnet.base.org",
      "https://base-rpc.publicnode.com",
      "https://base-pokt.nodies.app",
      "https://gateway.tenderly.co/public/base",
    ]);
    const firstDemoted = Math.min(
      ...DEMOTED_PUBLIC_RPCS.map((u) => DEFAULT_PUBLIC_RPCS.indexOf(u)),
    );
    for (const healthy of HEALTHY_PUBLIC_RPCS) {
      assert.ok(
        DEFAULT_PUBLIC_RPCS.indexOf(healthy) < firstDemoted,
        `${healthy} must rank before meowrpc/drpc`,
      );
    }
  });

  it("classifies meowrpc and drpc as demoted, not dead", () => {
    assert.ok(isDemotedPublicRpc("https://base.meowrpc.com"));
    assert.ok(isDemotedPublicRpc("https://base.drpc.org/"));
    assert.ok(DEMOTE_RPC_HOSTS.includes("base.meowrpc.com"));
    assert.ok(DEMOTE_RPC_HOSTS.includes("base.drpc.org"));
    assert.equal(isDeadPublicRpc("https://base.meowrpc.com"), false);
    assert.equal(isDemotedPublicRpc("https://mainnet.base.org"), false);
  });

  it("buildRpcUrls tries mainnet.base.org before meowrpc/drpc even with empty env", () => {
    const urls = buildRpcUrls({});
    assert.equal(urls[0], "https://mainnet.base.org");
    const official = urls.indexOf("https://mainnet.base.org");
    const meow = urls.indexOf("https://base.meowrpc.com");
    const drpc = urls.indexOf("https://base.drpc.org");
    assert.ok(meow > official, "meowrpc must be after official Base RPC");
    assert.ok(drpc > official, "drpc must be after official Base RPC");
    assert.ok(meow > urls.indexOf("https://base-rpc.publicnode.com"));
    assert.ok(drpc > urls.indexOf("https://base-pokt.nodies.app"));
  });

  it("env healthier URL stays first; meowrpc/drpc still last", () => {
    const urls = buildRpcUrls({
      BASE_RPC: "https://mainnet.base.org,https://base.meowrpc.com",
    });
    assert.equal(urls[0], "https://mainnet.base.org");
    assert.ok(urls.indexOf("https://base.meowrpc.com") > urls.indexOf("https://base-rpc.publicnode.com"));
    assert.ok(urls.indexOf("https://base.drpc.org") > urls.indexOf("https://gateway.tenderly.co/public/base"));
  });

  it("V4 DEFAULT_RPCS uses the shared pool (no hardcoded llamarpc/meowrpc)", () => {
    const src = readFileSync(new URL("./guardian-v4/config.js", import.meta.url), "utf8");
    assert.ok(src.includes("buildRpcUrls"));
    assert.ok(!src.includes("base.llamarpc.com"));
    assert.ok(!src.includes("base.meowrpc.com"));
    assert.ok(!src.includes("base.drpc.org"));
  });
});

describe("llamarpc is out of rotation", () => {
  it("treats base.llamarpc.com as dead", () => {
    assert.ok(isDeadPublicRpc("https://base.llamarpc.com"));
    assert.ok(DEAD_RPC_HOSTS.includes("base.llamarpc.com"));
    assert.equal(isDeadPublicRpc("https://mainnet.base.org"), false);
  });

  it("never includes llamarpc even if env or defaults mention it", () => {
    const urls = buildRpcUrls({ BASE_RPC: "https://base.llamarpc.com,https://mainnet.base.org" });
    assert.ok(!urls.some((u) => u.includes("llamarpc")));
    assert.equal(urls[0], "https://mainnet.base.org");
    assert.ok(!DEFAULT_PUBLIC_RPCS.some((u) => u.includes("llamarpc")));
  });

  it("strips trailing slashes", () => {
    assert.equal(normalizeRpcUrl("https://mainnet.base.org/"), "https://mainnet.base.org");
  });
});

describe("RPC failover — 521 must not abort the list", () => {
  it("classifies Cloudflare 521 / viem HttpRequestError as failover", () => {
    assert.equal(isRpcFailoverError({ status: 521, message: "HTTP request failed." }), true);
    assert.equal(isRpcFailoverError({ message: "Status: 521 Web Server Is Down" }), true);
    assert.equal(isRpcFailoverError({ message: "cloudflare error 521" }), true);
    assert.equal(isRpcFailoverError({ message: "rpc timeout 6s" }), true);
    assert.equal(isRpcFailoverError({ message: "fetch failed" }), true);
    assert.equal(isRpcFailoverError({ shortMessage: "HTTP request failed." }), true);
    assert.equal(isRpcFailoverError({ message: 'The contract function "balanceOf" returned no data ("0x").' }), true);
  });

  it("tries the next URL after a 521 and returns the later success", async () => {
    const seen = [];
    const result = await withRpcFailover(
      ["https://base.llamarpc.com", "https://mainnet.base.org"],
      async (url) => {
        seen.push(url);
        if (url.includes("llamarpc")) {
          const e = new Error("HTTP request failed.");
          e.status = 521;
          throw e;
        }
        return 42n;
      },
    );
    assert.equal(result, 42n);
    assert.deepEqual(seen, ["https://base.llamarpc.com", "https://mainnet.base.org"]);
  });

  it("throws only after every RPC fails — never on the first 521", async () => {
    await assert.rejects(
      () => withRpcFailover(["https://a", "https://b"], async (url) => {
        const e = new Error(`Status: 521 from ${url}`);
        e.status = 521;
        throw e;
      }),
      /All RPCs unavailable: Status: 521/,
    );
  });
});

describe("VITA webhook EADDRINUSE", () => {
  it("soft-skips port-in-use instead of treating it as fatal", () => {
    const err = new Error("listen EADDRINUSE: address already in use :::3000");
    err.code = "EADDRINUSE";
    assert.equal(isAddrInUseError(err), true);
    assert.equal(handleWebhookListenError(err, 3000), "eaddrinuse");
    assert.equal(isAddrInUseError(new Error("boom")), false);
  });
});

describe("OPERATOR_BUY latch — only after execute, re-queue on fatal restart", () => {
  it("does not latch done on queue so a fatal restart can re-queue", () => {
    const commands = [];
    const state = { done: false };
    const first = queueOperatorBuyOnce(commands, "TOSHI:3", new Set(["TOSHI"]), state);
    assert.equal(first.queued, true);
    assert.equal(state.done, false);
    assert.equal(commands[0].source, "OPERATOR_BUY");

    // main() crashed after splice, before the swap
    commands.length = 0;
    const again = queueOperatorBuyOnce(commands, "TOSHI:3", new Set(["TOSHI"]), state);
    assert.equal(again.queued, true);
    assert.equal(commands.length, 1);
  });

  it("latches only after the buy executes; fatal restart does not clear an executed buy", () => {
    const state = { done: false };
    queueOperatorBuyOnce([], "TOSHI:3", new Set(["TOSHI"]), state);
    markOperatorBuyExecuted(state);
    assert.equal(state.done, true);
    clearOperatorBuyIfNotExecuted(state);
    assert.equal(state.done, true);
    const blocked = queueOperatorBuyOnce([], "TOSHI:3", new Set(["TOSHI"]), state);
    assert.equal(blocked.queued, false);
    assert.equal(blocked.reason, "already-applied");
  });

  it("clears a stale queue-time latch on fatal restart so env buy re-queues", () => {
    const state = { done: true, executed: false };
    clearOperatorBuyIfNotExecuted(state);
    assert.equal(state.done, false);
    const commands = [];
    const r = queueOperatorBuyOnce(commands, "TOSHI:3", new Set(["TOSHI"]), state);
    assert.equal(r.queued, true);
  });
});
