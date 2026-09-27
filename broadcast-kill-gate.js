/**
 * RISK broadcast kill gates — hard env checks at the send choke point.
 *
 * Incident 2026-09-22..23: 276 VITAFEED self-calls left RISK while operators
 * believed VITAFEED_PAID=no. `/vitafeed override force` (and VITAFEED_FORCE)
 * bypassed the paid kill-switch + liquid floor inside the thrift gate.
 *
 * This module WRAPS senders only (mother-brain / VITA files are not edited):
 *   - Any RISK self-call carrying data (inscribe / vitafeed / wave / genesis)
 *     is refused unless VITAFEED_PAID (or VITAFEED_ENABLED) is explicitly yes.
 *     No force latch, no override, no autofire can bypass this.
 *   - MIN_LIQUID_USD / VITAFEED_MIN_LIQUID_USD floor is enforced for self-calls
 *     when the caller knows liquid USD (override no longer bypasses it).
 *   - HALT_NEW_ENTRIES=yes refuses every BUY broadcast. The only escape is an
 *     explicit operator buy with ALLOW_OPERATOR_BUY_WHEN_HALTED=yes.
 * Sells and plain ETH transfers without data are untouched (LOSE-ZERO exits).
 */

export function envYes(v) {
  return /^(yes|true|1|on)$/i.test(String(v ?? "").trim());
}

export function selfCallPaidEnabled(env = process.env) {
  return envYes(env?.VITAFEED_PAID ?? env?.VITAFEED_ENABLED ?? "");
}

/** Highest configured liquid floor (MIN_LIQUID_USD or VITAFEED_MIN_LIQUID_USD). 0 = off. */
export function minLiquidUsdFloor(env = process.env) {
  const vals = [env?.MIN_LIQUID_USD, env?.VITAFEED_MIN_LIQUID_USD]
    .map((v) => (v == null || String(v).trim() === "" ? NaN : Number(v)))
    .filter((n) => Number.isFinite(n) && n > 0);
  return vals.length ? Math.max(...vals) : 0;
}

export function selfCallBroadcastGate({ env = process.env, liquidUsd = null } = {}) {
  if (!selfCallPaidEnabled(env)) {
    return {
      ok: false,
      code: "paid-off",
      reason: "VITAFEED_PAID is not yes — RISK self-call refused (force/override/autofire cannot bypass)",
    };
  }
  const floor = minLiquidUsdFloor(env);
  if (floor > 0 && liquidUsd != null && Number.isFinite(Number(liquidUsd)) && Number(liquidUsd) < floor) {
    return {
      ok: false,
      code: "liquid-floor",
      reason: `RISK liquid $${Number(liquidUsd).toFixed(2)} < MIN_LIQUID_USD $${floor.toFixed(2)} — self-call refused`,
    };
  }
  return { ok: true, code: "ok" };
}

export const MANUAL_OPERATOR_BUY_PREFIX = "MANUAL BUY (operator)";

export function buyBroadcastGate({ env = process.env, reason = "" } = {}) {
  if (envYes(env?.HALT_NEW_ENTRIES)) {
    const operator = String(reason || "").startsWith(MANUAL_OPERATOR_BUY_PREFIX);
    if (!(operator && envYes(env?.ALLOW_OPERATOR_BUY_WHEN_HALTED))) {
      return {
        ok: false,
        code: "halt-new-entries",
        reason: "HALT_NEW_ENTRIES=yes — BUY refused" +
          (operator ? " (set ALLOW_OPERATOR_BUY_WHEN_HALTED=yes for an explicit operator buy)" : ""),
      };
    }
  }
  return { ok: true, code: "ok" };
}

function hasData(data) {
  const s = String(data ?? "").trim().toLowerCase();
  return s !== "" && s !== "0x";
}

/** True when tx is a data-carrying self-call from `address` to itself. */
export function isSelfCallWithData({ address, transaction } = {}) {
  const from = String(address || "").toLowerCase();
  const to = String(transaction?.to || "").toLowerCase();
  return Boolean(from) && from === to && hasData(transaction?.data);
}

/**
 * Wrap cdp.evm.sendTransaction so every RISK self-call is hard-gated on
 * VITAFEED_PAID regardless of which code path built it. Idempotent.
 */
export function installSelfCallKillGate(client, { env = () => process.env, log = console.warn } = {}) {
  const evm = client?.evm;
  if (!evm || typeof evm.sendTransaction !== "function") return client;
  if (evm.sendTransaction.__riskKillGate) return client;
  const original = evm.sendTransaction.bind(evm);
  const gated = async (params = {}) => {
    if (isSelfCallWithData(params)) {
      const gate = selfCallBroadcastGate({ env: typeof env === "function" ? env() : env });
      if (!gate.ok) {
        const err = new Error("RISK_KILL_GATE: " + gate.reason);
        err.code = "RISK_KILL_GATE";
        try { log?.("🛑 " + err.message); } catch { /* ignore */ }
        throw err;
      }
    }
    return original(params);
  };
  gated.__riskKillGate = true;
  try {
    evm.sendTransaction = gated;
  } catch {
    Object.defineProperty(evm, "sendTransaction", { value: gated, configurable: true, writable: true });
  }
  return client;
}

const WETH_BASE = "4200000000000000000000000000000000000006";
/** exactInputSingle selectors: Uni SwapRouter02, Aerodrome Slipstream, Uni V3 SwapRouter (legacy). */
const EXACT_INPUT_SINGLE_SELECTORS = ["04e45aaf", "a026383e", "414bf389"];

/**
 * True when a swap tx spends ETH/WETH into a token (a BUY): any
 * exactInputSingle (also nested in multicall) whose tokenIn == WETH.
 * Sells (tokenIn = token) are never matched.
 */
export function isBuySwapTx({ transaction } = {}) {
  const data = String(transaction?.data ?? "").toLowerCase().replace(/^0x/, "");
  if (!data) return false;
  for (const sel of EXACT_INPUT_SINGLE_SELECTORS) {
    let i = data.indexOf(sel);
    while (i !== -1) {
      const word = data.slice(i + 8, i + 8 + 64);
      if (word.length === 64 && word.endsWith(WETH_BASE) && /^0{24}/.test(word)) return true;
      i = data.indexOf(sel, i + 8);
    }
  }
  return false;
}

/**
 * Patch an EVM client prototype (or instance) so every send is gated:
 * self-calls need VITAFEED_PAID=yes; BUY swaps are refused under
 * HALT_NEW_ENTRIES=yes unless ALLOW_OPERATOR_BUY_WHEN_HALTED=yes.
 */
export function installBroadcastKillGateOn(target, { env = () => process.env, log = console.warn } = {}) {
  if (!target || typeof target.sendTransaction !== "function") return false;
  if (target.sendTransaction.__riskBroadcastGate) return true;
  const original = target.sendTransaction;
  const gated = async function (params = {}) {
    const e = typeof env === "function" ? env() : env;
    let gate = { ok: true };
    if (isSelfCallWithData(params)) gate = selfCallBroadcastGate({ env: e });
    else if (isBuySwapTx(params) && envYes(e?.HALT_NEW_ENTRIES) && !envYes(e?.ALLOW_OPERATOR_BUY_WHEN_HALTED)) {
      gate = { ok: false, reason: "HALT_NEW_ENTRIES=yes — BUY swap refused at broadcast" };
    }
    if (!gate.ok) {
      const err = new Error("RISK_KILL_GATE: " + gate.reason);
      err.code = "RISK_KILL_GATE";
      try { log?.("🛑 " + err.message); } catch { /* ignore */ }
      throw err;
    }
    return original.call(this, params);
  };
  gated.__riskBroadcastGate = true;
  target.sendTransaction = gated;
  return true;
}
