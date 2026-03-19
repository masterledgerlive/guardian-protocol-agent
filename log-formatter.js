// ═══════════════════════════════════════════════════════════════════════════════
// 📋 GUARDIAN LOG FORMATTER — Clean, structured, human-readable logs
// ───────────────────────────────────────────────────────────────────────────────
// Replaces raw console.log with formatted, labeled, consistently spaced output.
// Every log line follows a fixed structure so a future parser can read it
// without regex — just split on the separator characters.
//
// FORMAT:
//   [TIMESTAMP] [LEVEL] [SECTION] message
//
//   LEVELS:  ✅ OK | ⚠️  WARN | ❌ ERR | 🔵 INFO | 🟢 BUY | 🔴 SELL | 📡 BTP
//   SECTIONS: BOOT | CYCLE | TOKEN | TRADE | VAULT | WAVE | GAS | BTP
//
// SECTION BLOCKS use clear open/close markers:
//   ┌─ SECTION NAME ──────────────────────
//   │  content lines
//   └─────────────────────────────────────
//
// This makes logs readable as a flip book — each cycle is a page,
// each section is a paragraph, each trade is a stamped record.
// ═══════════════════════════════════════════════════════════════════════════════

const W = 62; // line width for separators

// ── Core formatter ────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function pad(str, width) {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

function ruler(char = "═") {
  return char.repeat(W);
}

// ── Log levels ────────────────────────────────────────────────────────────────

export const log = {

  // ── Section headers ────────────────────────────────────────────────────────

  section(name, subtitle = "") {
    const title = subtitle ? `${name} — ${subtitle}` : name;
    const fill  = "─".repeat(Math.max(0, W - title.length - 3));
    console.log(`\n┌─ ${title} ${fill}`);
  },

  sectionEnd() {
    console.log(`└${"─".repeat(W - 1)}`);
  },

  line(text = "") {
    console.log(`│  ${text}`);
  },

  // ── Cycle header — printed once per main loop ───────────────────────────────

  cycle(time, eth, weth, ethUsd, gwei, tradeable, piggy, trades, tier1, tier2) {
    console.log(`\n${ruler()}`);
    console.log(`⏱  ${time}  │  ETH $${ethUsd.toFixed(2)}  │  ⛽ ${gwei.toFixed(2)} gwei  │  Trade #${trades}`);
    console.log(`💰 ETH:${eth.toFixed(6)}  WETH:${weth.toFixed(6)}  Tradeable:${tradeable.toFixed(6)}  Piggy:${piggy.toFixed(6)}`);
    console.log(`🏆 T1: ${tier1.join(" > ") || "none"}  │  T2: ${tier2.join(" | ") || "none"}`);
    console.log(ruler("─"));
  },

  // ── Token status line — one per token per cycle ────────────────────────────

  token(symbol, status, price, posUsd, detail) {
    const icons = {
      RIDING:   "🏇",
      ARMED:    "✅",
      BUILDING: "⏳",
      BLOCKED:  "🛑",
      BUYING:   "🟢",
      SELLING:  "🔴",
      DEAD:     "💀",
      NODATA:   "⚫",
    };
    const icon = icons[status] || "❓";
    const priceStr = price ? `$${price.toFixed(8)}` : "no price";
    const posStr   = posUsd > 0 ? ` ($${posUsd.toFixed(2)})` : "";
    console.log(`${icon} ${pad(symbol, 8)} ${pad(priceStr, 18)}${posStr}  ${detail || ""}`);
  },

  // ── Trade records ──────────────────────────────────────────────────────────

  buy(symbol, tradeNum, ethSpent, ethUsd, price, tier, margin, txHash) {
    console.log(`\n${"▼".repeat(W)}`);
    console.log(`🟢 BUY  #${tradeNum}  ${symbol}  [${tier}]`);
    console.log(`   Price:   $${price.toFixed(8)}`);
    console.log(`   Spent:   ${ethSpent.toFixed(6)} ETH  (~$${(ethSpent * ethUsd).toFixed(2)})`);
    console.log(`   Margin:  ${(margin * 100).toFixed(2)}%`);
    console.log(`   TX:      ${txHash}`);
    console.log(`   Scan:    https://basescan.org/tx/${txHash}`);
    console.log(`${"▼".repeat(W)}\n`);
  },

  sell(symbol, tradeNum, received, ethUsd, price, netUsd, pnlPct, txHash) {
    const win = netUsd >= 0;
    console.log(`\n${"▲".repeat(W)}`);
    console.log(`🔴 SELL #${tradeNum}  ${symbol}  ${win ? "✅ PROFIT" : "🦈 LOSS"}`);
    console.log(`   Price:   $${price.toFixed(8)}`);
    console.log(`   Got:     ${received.toFixed(6)} ETH  (~$${(received * ethUsd).toFixed(2)})`);
    console.log(`   P&L:     ${netUsd >= 0 ? "+" : ""}$${netUsd.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`);
    console.log(`   TX:      ${txHash}`);
    console.log(`   Scan:    https://basescan.org/tx/${txHash}`);
    console.log(`${"▲".repeat(W)}\n`);
  },

  // ── BTP inscription ────────────────────────────────────────────────────────

  btp(name, seq, tot, txHash, preview) {
    console.log(`📡 BTP [${name} ${seq}/${tot}]  TX: ${txHash}`);
    console.log(`   Scan:  https://basescan.org/tx/${txHash}`);
    console.log(`   Data:  "${preview}"`);
  },

  // ── Vault ─────────────────────────────────────────────────────────────────

  vault(keyName, txHash, success, error) {
    if (success) {
      console.log(`\n${"━".repeat(W)}`);
      console.log(`🔐 VAULT READ RECEIPT`);
      console.log(`   Key:      ${keyName}`);
      console.log(`   Location: https://basescan.org/tx/${txHash}`);
      console.log(`   Chain:    Base (L2) — permanent, immutable`);
      console.log(`   Method:   AES-256-GCM authenticated encryption`);
      console.log(`   Status:   ✅ DECRYPTED + LOADED`);
      console.log(`   Message:  Eureka! VITA lives ♥ — ᛞᚨᚡᛁᛞ — The truth is the chain.`);
      console.log(`${"━".repeat(W)}\n`);
    } else {
      console.log(`⚠️  VAULT FAILED: ${error}`);
    }
  },

  // ── Wave events ────────────────────────────────────────────────────────────

  peak(symbol, price, confirmed, indDetail) {
    const mark = confirmed ? "✅CONFIRMED" : "⚠️ unconfirmed";
    console.log(`   📈 [${symbol}] Peak  $${price.toFixed(8)}  ${mark}  ${indDetail}`);
  },

  trough(symbol, price, confirmed, indDetail) {
    const mark = confirmed ? "✅CONFIRMED" : "⚠️ unconfirmed";
    console.log(`   📉 [${symbol}] Trough $${price.toFixed(8)}  ${mark}  ${indDetail}`);
  },

  // ── General purpose levels ─────────────────────────────────────────────────

  ok(msg)   { console.log(`✅ ${msg}`); },
  warn(msg) { console.log(`⚠️  ${msg}`); },
  err(msg)  { console.log(`❌ ${msg}`); },
  info(msg) { console.log(`🔵 ${msg}`); },
  skip(msg) { console.log(`   ⏭  ${msg}`); },
  block(msg){ console.log(`   🛑 ${msg}`); },

};

// ── Usage examples (run this file directly to preview) ────────────────────────

if (process.argv[1].endsWith("log-formatter.js")) {
  console.log("\n📋 LOG FORMATTER PREVIEW\n");

  log.cycle(
    "21:55:03", 0.003079, 0.000525, 2203, 0.006,
    0.001823, 0.000374, 634,
    ["AIXBT", "BRETT", "PRIME"],
    ["XCN", "HIGHER", "TOSHI"]
  );

  log.token("BRETT",  "ARMED",   0.00751100, 0,     "8P/8T | 8.21% margin");
  log.token("PRIME",  "BUYING",  0.38290000, 0,     "AT MIN TROUGH | T1");
  log.token("ZORA",   "RIDING",  0.01712000, 7.45,  "P&L +0.5% | 35% of wave");
  log.token("BNKR",   "RIDING",  0.00046560, 0.58,  "below breakeven $0.02");
  log.token("GAME",   "BLOCKED", 0.01080000, 0,     "not in active tiers (OUT)");
  log.token("NORMIE", "NODATA",  null,        0,     "no price");

  log.buy("PRIME", 634, 0.001823, 2203, 0.38290000, "T1", 0.0821,
    "0xd9827a9c70c78be7e165934b101b8774c10fdfe8d9720bafd293fff4e5203d73");

  log.btp("VITA", 1, 1,
    "0xd9827a9c70c78be7e165934b101b8774c10fdfe8d9720bafd293fff4e5203d73",
    "[BTP:VITA:001/001:0000][BUY #634 PRIME @ $0.38290000] Eureka! VITA...");

  log.vault("TELEGRAM_BOT_TOKEN",
    "0xd9827a9c70c78be7e165934b101b8774c10fdfe8d9720bafd293fff4e5203d73",
    true, null);

  log.warn("ETH price fetch failed — using cached $2203.00");
  log.ok("Ledger: trade #634 recorded permanently");
}
