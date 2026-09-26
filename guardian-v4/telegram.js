/**
 * Isolated V4 Telegram — same-style turn cards as V3, every message tagged [V4].
 * Dry-run still sends status (calldata planned / hitch banked / skip reasons).
 * Never invents P&L or fake tx hashes. Does not import root agent.js.
 */

import { formatEthAmt, hitchClassLabel } from "../telegram-turn-card.js";
import { DRY_RUN, telegramBotToken, telegramChatId } from "./config.js";

export const V4_TELEGRAM_TAG = "[V4]";

/** Unused hitch room to bank — leftover after fees, capped at hitch cost. Not P&L. */
export function hitchBankCreditEth(leftoverAfterFees = 0, hitchWouldEth = 0) {
  const left = Math.max(0, Number(leftoverAfterFees) || 0);
  const hitch = Math.max(0, Number(hitchWouldEth) || 0);
  if (!(left > 0) || !(hitch > 0)) return 0;
  return Math.min(left, hitch);
}

let _hitchBudgetEth = 0;

export function hitchBudgetBalanceEth() {
  return _hitchBudgetEth;
}

export function resetHitchBudget(eth = 0) {
  const n = Number(eth);
  _hitchBudgetEth = Number.isFinite(n) && n > 0 ? n : 0;
  return _hitchBudgetEth;
}

/** #89 micro-extract hitch-bank: skip credits unused hitch room (not P&L). */
export function creditHitchBank(eth, { symbol = "?", reason = "skip" } = {}) {
  const n = Math.max(0, Number(eth) || 0);
  _hitchBudgetEth += n;
  return {
    credited: n,
    total: _hitchBudgetEth,
    reason,
    symbol,
    log:
      `HITCH_BANK: skip ${symbol} credit ${n.toExponential(2)} ETH` +
      ` → bank ${_hitchBudgetEth.toExponential(2)} (next worth-sending message; not P&L)`,
  };
}

/** Clear bank only when a hitch actually rides (live send). Dry-run does not consume. */
export function consumeHitchBankOnSend({ symbol = "?" } = {}) {
  const spent = _hitchBudgetEth;
  _hitchBudgetEth = 0;
  return {
    spent,
    total: 0,
    symbol,
    log: spent > 0
      ? `HITCH_BANK: sent ${symbol} cleared bank ${spent.toExponential(2)} ETH`
      : null,
  };
}

export function prefixV4(text) {
  const raw = String(text ?? "");
  if (raw.startsWith(V4_TELEGRAM_TAG)) return raw;
  const body = raw.replace(/^\n+/, "");
  return body ? `${V4_TELEGRAM_TAG}\n${body}` : V4_TELEGRAM_TAG;
}

export function leftoverVsHitchFloor({ leftoverEth = null, hitchFloorEth = null } = {}) {
  const left = leftoverEth == null || leftoverEth === "" ? null : Number(leftoverEth);
  const floor = hitchFloorEth == null || hitchFloorEth === "" ? null : Number(hitchFloorEth);
  if (!Number.isFinite(left) || !Number.isFinite(floor) || floor < 0) {
    return { leftoverEth: null, hitchFloorEth: null, verdict: "unknown" };
  }
  return {
    leftoverEth: left,
    hitchFloorEth: floor,
    verdict: left + 1e-18 >= floor ? "COVER" : "SHORT",
  };
}

/**
 * Planned hitch skip/bank from leftover vs hitch floor.
 * Buys/injects use 1× hitch cost as the floor. Sells may pass hitch × mult.
 */
export function planHitchMessaging({
  leftoverEth = null,
  hitchCostEth = null,
  hitchOnChain = false,
  hitchBytes = 0,
  hitchUtf8 = "",
  hitchKind = "",
  skipReason = "",
  side = "BUY",
} = {}) {
  const vs = leftoverVsHitchFloor({ leftoverEth, hitchFloorEth: hitchCostEth });
  const skipped = !hitchOnChain;
  const banked = skipped ? hitchBankCreditEth(vs.leftoverEth || 0, vs.hitchFloorEth || 0) : 0;
  return {
    side: String(side || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY",
    leftoverEth: vs.leftoverEth,
    hitchFloorEth: vs.hitchFloorEth,
    leftoverVsFloor: vs.verdict,
    hitchOnChain: !!hitchOnChain,
    hitchSkipped: skipped,
    hitchBankedEth: skipped && banked > 0 ? banked : null,
    hitchBytes: hitchOnChain ? Math.max(0, Number(hitchBytes) || 0) : 0,
    hitchUtf8: hitchOnChain ? String(hitchUtf8 || "") : "",
    hitchKind: hitchOnChain ? String(hitchKind || "") : "",
    hitchCostEth: hitchOnChain && vs.hitchFloorEth != null && vs.hitchFloorEth > 0
      ? vs.hitchFloorEth
      : null,
    skipReason: skipped ? String(skipReason || "leftover cannot cover hitch — plain swap") : null,
  };
}

export function applyHitchBank(plan, symbol) {
  if (!plan?.hitchSkipped) return { credited: 0, log: null, symbol };
  return creditHitchBank(plan.hitchBankedEth || 0, { symbol, reason: "skip" });
}

function leftoverVsFloorLine(plan = {}) {
  const left = formatEthAmt(plan.leftoverEth);
  const floor = formatEthAmt(plan.hitchFloorEth);
  if (left == null || floor == null || plan.leftoverVsFloor === "unknown") {
    return "leftover vs hitch floor — unknown (not invented)";
  }
  return `leftover ${left} ETH vs hitch floor ${floor} · ${plan.leftoverVsFloor}`;
}

function hitchPlanLine(plan = {}, { dryRun = true } = {}) {
  if (plan.hitchOnChain && plan.hitchBytes > 0) {
    const klass = hitchClassLabel({
      utf8: plan.hitchUtf8,
      hitchBytes: plan.hitchBytes,
      kind: plan.hitchKind,
    });
    const cost = plan.hitchCostEth != null ? ` · ${formatEthAmt(plan.hitchCostEth)} ETH` : "";
    const verb = dryRun ? "planned" : "sent";
    return `hitch ${verb} ${plan.hitchBytes} B${klass ? ` ${klass}` : ""}${cost}`;
  }
  if (plan.hitchSkipped) {
    const banked = plan.hitchBankedEth != null ? formatEthAmt(plan.hitchBankedEth) : null;
    return banked
      ? `hitch skipped · banked ${banked} ETH`
      : `hitch skipped · banked`;
  }
  return "hitch — none";
}

function broadcastLine({ dryRun = true, calldataChars = 0 } = {}) {
  const chars = Math.max(0, Number(calldataChars) || 0);
  if (dryRun) {
    return chars > 0
      ? `calldata planned ${chars} hex chars (not broadcast)`
      : `calldata planned (not broadcast)`;
  }
  return "LIVE stub — not broadcast (wire a dedicated V4 wallet first)";
}

/**
 * V3-style turn card for V4 inject / dry-run cycle.
 * No invented P&L, no fake hashes — tx is omitted unless a real hash is passed.
 */
export function formatV4DryRunCard({
  symbol = "?",
  side = "BUY",
  dryRun = DRY_RUN,
  cycle: cycleNum = null,
  tradeEth = null,
  hitchPlan = {},
  calldataChars = 0,
  txHash = "",
  skipReason = "",
} = {}) {
  const plan = hitchPlan && typeof hitchPlan === "object" ? hitchPlan : {};
  const sideLabel = String(side || plan.side || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
  const dry = dryRun !== false;
  const lines = [
    `<b>TURN CARD — ${sideLabel} ${String(symbol || "?").toUpperCase()}</b>`,
    `dry-run ${dry ? "yes" : "no"}`,
  ];
  if (cycleNum != null && Number.isFinite(Number(cycleNum))) {
    lines.push(`cycle ${Number(cycleNum)}`);
  }
  const hash = String(txHash || "").trim();
  lines.push(hash ? `tx ${hash}` : `tx — (not broadcast)`);
  lines.push(`FIFO — unknown (not invented)`);
  const trade = Number(tradeEth);
  if (Number.isFinite(trade) && trade > 0) {
    lines.push(`planned size ${formatEthAmt(trade)} ETH`);
  }
  lines.push(hitchPlanLine(plan, { dryRun: dry }));
  lines.push(leftoverVsFloorLine(plan));
  const skip = skipReason || plan.skipReason;
  if (plan.hitchSkipped && skip) {
    lines.push(`SKIP_HITCH ${skip}`);
  }
  lines.push(broadcastLine({ dryRun: dry, calldataChars }));
  return prefixV4(lines.join("\n"));
}

/** Cycle-level skip / status (no primed avenue, operator skip, etc.). */
export function formatV4SkipCard({
  reason = "skipped",
  symbol = "",
  dryRun = DRY_RUN,
  cycle: cycleNum = null,
} = {}) {
  const lines = [
    `<b>TURN CARD — SKIP${symbol ? ` ${String(symbol).toUpperCase()}` : ""}</b>`,
    `dry-run ${dryRun !== false ? "yes" : "no"}`,
  ];
  if (cycleNum != null && Number.isFinite(Number(cycleNum))) {
    lines.push(`cycle ${Number(cycleNum)}`);
  }
  lines.push(`tx — (not broadcast)`);
  lines.push(String(reason || "skipped"));
  return prefixV4(lines.join("\n"));
}

/**
 * #89 sell SKIP_HITCH bank note — used if a V4 sell path reports a skip.
 * Micro extract: leftover covers fees but not hitch floor; bank unused room.
 * Never invents FIFO / closed-leg P&L.
 */
export function formatV4SellSkipHitchCard({
  symbol = "?",
  dryRun = DRY_RUN,
  leftoverEth = null,
  hitchFloorEth = null,
  hitchBankedEth = null,
  skipReason = "micro extract — hitch banked toward next message (not P&L)",
  cycle: cycleNum = null,
} = {}) {
  const plan = planHitchMessaging({
    leftoverEth,
    hitchCostEth: hitchFloorEth,
    hitchOnChain: false,
    skipReason,
    side: "SELL",
  });
  if (hitchBankedEth != null && Number(hitchBankedEth) > 0) {
    plan.hitchBankedEth = Number(hitchBankedEth);
  }
  return formatV4DryRunCard({
    symbol,
    side: "SELL",
    dryRun,
    cycle: cycleNum,
    hitchPlan: plan,
    skipReason: plan.skipReason,
  });
}

export function telegramConfigured() {
  return !!(telegramBotToken() && telegramChatId());
}

/**
 * Send HTML Telegram. Always prefixes [V4]. Dry-run callers still send.
 * Missing credentials → no-op (logged), never throws.
 */
export async function sendV4Telegram(text, { fetchImpl = globalThis.fetch, prefix = true } = {}) {
  const body = prefix === false ? String(text ?? "") : prefixV4(text);
  const tok = telegramBotToken();
  const cid = telegramChatId();
  if (!tok || !cid) {
    console.log("[guardian-v4] Telegram: no token/chat_id set — card not sent");
    return { sent: false, reason: "missing-credentials", text: body };
  }
  if (typeof fetchImpl !== "function") {
    return { sent: false, reason: "no-fetch", text: body };
  }
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${String(tok).trim()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: String(cid).trim(),
        text: body,
        parse_mode: "HTML",
      }),
    });
    const data = typeof res?.json === "function" ? await res.json() : res;
    if (!data?.ok) {
      console.log(`[guardian-v4] Telegram send failed: ${data?.description || "unknown"}`);
      return { sent: false, reason: data?.description || "send-failed", text: body };
    }
    return { sent: true, text: body };
  } catch (err) {
    console.log(`[guardian-v4] Telegram error: ${err?.message || err}`);
    return { sent: false, reason: err?.message || "error", text: body };
  }
}
