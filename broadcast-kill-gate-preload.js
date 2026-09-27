/**
 * Preload: node --import ./broadcast-kill-gate-preload.js agent.js
 * (or Railway NODE_OPTIONS="--import ./broadcast-kill-gate-preload.js").
 *
 * Patches the CDP SDK EvmClient.prototype.sendTransaction BEFORE agent.js
 * loads, so every RISK broadcast from any path (vitafeed, override force,
 * autofire, wave proof, genesis, memory-engine, bitstorage, buys) passes the
 * hard env kill gates in broadcast-kill-gate.js. Wrap only — no VITA /
 * mother-brain file is edited.
 *
 * Fails CLOSED for the broadcasting agent: when the main script is agent.js
 * and the gate cannot arm, the process exits. Other node processes that
 * inherit NODE_OPTIONS (npm install at build/boot, boot-patch scripts) never
 * broadcast, so a missing SDK there is ignored instead of breaking the build.
 */
import { installBroadcastKillGateOn } from "./broadcast-kill-gate.js";

const mainScript = String(process.argv[1] || "");
const isAgent = /(^|[\\/])agent\.js$/.test(mainScript);
const evmUrl = new URL("./node_modules/@coinbase/cdp-sdk/_esm/client/evm/evm.js", import.meta.url);
try {
  const mod = await import(evmUrl.href);
  const EvmClient = mod.EvmClient;
  if (!installBroadcastKillGateOn(EvmClient?.prototype)) throw new Error("EvmClient.prototype.sendTransaction missing");
  if (isAgent) console.log("🛑 RISK broadcast kill gate armed (VITAFEED_PAID / HALT_NEW_ENTRIES / MIN_LIQUID_USD)");
} catch (e) {
  if (isAgent) {
    console.error("RISK broadcast kill gate FAILED to arm — refusing to start:", e?.message || e);
    process.exit(1);
  }
}

// ── VRR one-shot (VITA ROUTE REGISTRY live test) ─────────────────────────────
// Only in the agent process, only when VRR_ONESHOT=yes. Runs to completion
// BEFORE agent.js loads (top-level await) so no trading loop races the nonce.
// Uses a fresh CdpClient whose sends still pass the prototype kill gate above;
// the gate's VRR exception is armed only inside runVrrOneshot and latches off.
if (isAgent && /^(yes|true|1|on)$/i.test(String(process.env.VRR_ONESHOT || "").trim())) {
  try {
    const { runVrrOneshot } = await import("./vrr-oneshot-runner.js");
    const { CdpClient } = await import("@coinbase/cdp-sdk");
    const cdp = new CdpClient({
      apiKeyId: process.env.CDP_API_KEY_ID || "",
      apiKeySecret: (process.env.CDP_API_KEY_SECRET || "").replace(/\\n/g, "\n"),
      walletSecret: process.env.CDP_WALLET_SECRET,
    });
    const r = await Promise.race([
      runVrrOneshot({ cdp }),
      new Promise((res) => setTimeout(() => res({ ok: false, error: "timeout 10m" }), 600_000)),
    ]);
    if (r?.error === "timeout 10m") (await import("./broadcast-kill-gate.js")).disarmVrrOneshot();
    console.log("🧾 VRR_ONESHOT result " + JSON.stringify({
      ok: r.ok, skipped: r.skipped, reason: r.reason, error: r.error, sell: r.sell,
      txs: r.txs, verify: r.verify, nonceAfter: r.nonceAfter, latch: r.latch,
    }));
  } catch (e) {
    console.error("VRR_ONESHOT runner failed (agent continues, gate intact):", e?.message || e);
  }
}
