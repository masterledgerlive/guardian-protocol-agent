/**
 * Preload: node --import ./broadcast-kill-gate-preload.js agent.js
 * (or Railway NODE_OPTIONS="--import ./broadcast-kill-gate-preload.js").
 *
 * Patches the CDP SDK EvmClient.prototype.sendTransaction BEFORE agent.js
 * loads, so every RISK broadcast from any path (vitafeed, override force,
 * autofire, wave proof, genesis, memory-engine, bitstorage, buys) passes the
 * hard env kill gates in broadcast-kill-gate.js. Wrap only — no VITA /
 * mother-brain file is edited. Fails CLOSED: if the SDK cannot be patched the
 * process exits so a broadcasting agent never runs ungated.
 */
import { installBroadcastKillGateOn } from "./broadcast-kill-gate.js";

const evmUrl = new URL("./node_modules/@coinbase/cdp-sdk/_esm/client/evm/evm.js", import.meta.url);
try {
  const mod = await import(evmUrl.href);
  const EvmClient = mod.EvmClient;
  if (!installBroadcastKillGateOn(EvmClient?.prototype)) throw new Error("EvmClient.prototype.sendTransaction missing");
  console.log("🛑 RISK broadcast kill gate armed (VITAFEED_PAID / HALT_NEW_ENTRIES / MIN_LIQUID_USD)");
} catch (e) {
  console.error("RISK broadcast kill gate FAILED to arm — refusing to start:", e?.message || e);
  process.exit(1);
}
