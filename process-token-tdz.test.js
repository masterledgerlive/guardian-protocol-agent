import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

function extractProcessToken(src) {
  const start = src.indexOf("async function processToken(");
  assert.ok(start >= 0, "processToken must exist in agent.js");
  const brace = src.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unclosed processToken");
}

describe("processToken hasPosition TDZ", () => {
  const src = readFileSync(join(root, "agent.js"), "utf8");
  const fn = extractProcessToken(src);

  it("declares hasPosition before first use", () => {
    const decl = fn.search(/\bconst hasPosition\b/);
    const use = fn.search(/\bhasPosition\b/);
    assert.ok(decl >= 0, "const hasPosition must be declared in processToken");
    assert.ok(use >= decl, "hasPosition used before initialization (TDZ)");
  });

  it("declares minTrgh before stopLossPrice (PR #31 TDZ)", () => {
    const minDecl = fn.search(/\bconst minTrgh\b/);
    const stop = fn.search(/\bconst stopLossPrice\b/);
    assert.ok(minDecl >= 0, "const minTrgh must exist");
    assert.ok(stop > minDecl, "stopLossPrice must not TDZ on minTrgh");
  });

  it("STOP LOSS uses shouldArmStopLoss and never cascades after fill", () => {
    assert.ok(src.includes("shouldArmStopLoss"), "must import shouldArmStopLoss");
    assert.ok(fn.includes("shouldArmStopLoss"), "processToken must arm via helper");
    const stopBlock = fn.indexOf("// ── STOP LOSS");
    assert.ok(stopBlock >= 0, "STOP LOSS block must exist");
    const nextSection = fn.indexOf("// ── FIBONACCI PARTIAL EXIT", stopBlock);
    assert.ok(nextSection > stopBlock, "fib section follows stop loss");
    const block = fn.slice(stopBlock, nextSection);
    assert.ok(block.includes("executeSell"), "stop loss still sells when green");
    assert.ok(!block.includes("triggerCascade"), "no cascade after stop-loss (ledger loss path)");
    assert.ok(!block.includes("Emergency exit"), "no Telegram spam before fill");
  });

  it("does not touch lines before const lines is declared", () => {
    const decl = fn.search(/\bconst lines\b/);
    const firstPush = fn.search(/\blines\.push\b/);
    assert.ok(decl >= 0, "const lines must be declared in processToken");
    assert.ok(firstPush > decl, "lines.push before initialization (TDZ)");
  });

  it("executeSell and moonshot trim use leftover sell gate (hitch or plain)", () => {
    assert.ok(src.includes("buildSellGateDecision"), "sell floor helper must be imported");
    assert.ok(src.includes("HITCH_COST_MULT"), "sell floor must mention HITCH_COST_MULT");
    assert.ok(src.includes("conservativeSellProceedsEth"), "plus gate must use min(mark, quote)");
    assert.ok(src.includes("alwaysPlusLog"), "PLUS/HOLD/SKIP_HITCH must be logged");
    const sellFn = src.indexOf("async function executeSell(");
    const moon = src.indexOf("MOONSHOT SELL-DOWN");
    const sellGate = src.indexOf("buildSellGateDecision", sellFn);
    const moonGate = src.indexOf("buildSellGateDecision", moon);
    assert.ok(sellFn >= 0 && sellGate > sellFn, "executeSell must call buildSellGateDecision");
    assert.ok(moon >= 0 && moonGate > moon, "moonshot trim must call buildSellGateDecision");
    const quote = src.indexOf("getOnChainSellQuote", sellFn);
    assert.ok(quote > sellFn && quote < sellGate, "executeSell must quote before plus gate");
    assert.ok(src.includes("leftoverVoiceHitchBytes()"), "wanted hitch must be planned VITA packet, not 10-byte tag");
    const sellEnd = src.indexOf("\nasync function ", sellFn + 1);
    const sellBody = src.slice(sellFn, sellEnd > 0 ? sellEnd : sellFn + 8000);
    assert.ok(sellBody.includes("hitchCostMult: 1"), "sell hitch size is leftover-after-plus, not 2× veto");
    assert.ok(sellBody.includes("earningsEth: 0"), "earnings must not add hitch fuel on top of leftover");
    assert.ok(sellBody.includes("sellSkipHitch"), "orch must not re-embed hitch after plus strip");
    assert.ok(sellBody.includes("leftoverEth"), "KEY+LOC planner must see leftover, not hitch-force");
  });

  it("still reaches buy / MANUAL SELL / sellhalf after the armed-idle log", () => {
    const hasPos = fn.search(/\bconst hasPosition\b/);
    const buy = fn.indexOf('cmd.action === "buy"');
    const sell = fn.indexOf('cmd.action === "sell"');
    const sellhalf = fn.indexOf('cmd.action === "sellhalf"');
    assert.ok(buy > hasPos, "manual buy must run after hasPosition is live");
    assert.ok(sell > hasPos, "manual sell must run after hasPosition is live");
    assert.ok(sellhalf > hasPos, "sellhalf / OPERATOR_SELL must run after hasPosition is live");
    assert.ok(fn.includes("manualSellReason"), "OPERATOR_SELL reason path must remain");
    assert.ok(fn.includes("MANUAL SELL HALF"), "Telegram /sellhalf path must remain");
    const piggyUnlock = fn.indexOf('cmd.action === "piggyunlock"');
    assert.ok(piggyUnlock > hasPos, "piggyunlock must run after hasPosition is live");
  });

  it("executeBuy is the shared freeze gate for every buy entry", () => {
    const buyFn = src.indexOf("async function executeBuy(");
    assert.ok(buyFn >= 0, "executeBuy must exist");
    const cascade = src.indexOf("async function findCascadeTarget(");
    const ripple = src.indexOf("const rippleTargets = []");
    const shouldBuy = fn.indexOf("const shouldBuy");
    const buyGate = src.indexOf("isCatalogFrozen(token)", buyFn);
    const nextFn = src.indexOf("\nasync function ", buyFn + 1);
    assert.ok(buyGate > buyFn && (nextFn < 0 || buyGate < nextFn), "executeBuy must call isCatalogFrozen");
    assert.ok(src.includes("frozenBuySkipLog"), "skipped buys must log frozenBuySkipLog");
    assert.ok(src.includes("isCatalogFrozen(t)"), "cascade/ripple targets must skip frozen names");
    assert.ok(cascade >= 0 && src.indexOf("isCatalogFrozen(t)", cascade) > cascade, "findCascadeTarget must skip frozen");
    assert.ok(ripple >= 0 && src.indexOf("isCatalogFrozen(t)", ripple) > ripple, "ripple targets must skip frozen");
    assert.ok(shouldBuy >= 0 && fn.includes("!isCatalogFrozen(token)"), "shouldBuy must refuse frozen names");
    const sellFn = src.indexOf("async function executeSell(");
    const sellGate = src.indexOf("isCatalogFrozen", sellFn);
    const sellEnd = src.indexOf("\nasync function ", sellFn + 1);
    assert.ok(sellFn >= 0 && (sellGate < 0 || sellGate > sellEnd), "executeSell must stay open on frozen names");
  });

  it("executeBuy runs the hitch-cover gate for cascade (no !isCascade skip)", () => {
    const buyFn = src.indexOf("async function executeBuy(");
    const nextFn = src.indexOf("\nasync function ", buyFn + 1);
    const body = src.slice(buyFn, nextFn > 0 ? nextFn : buyFn + 4000);
    const gate = body.indexOf("buildBuyGateDecision");
    assert.ok(gate >= 0, "executeBuy must call buildBuyGateDecision");
    const prelude = body.slice(0, gate);
    assert.ok(!prelude.includes("!isCascade &&"), "cascade/ripple must not skip the buy hitch-cover gate");
    assert.ok(body.includes("isLoseZeroMode() || isInjectCoverRequired()"), "gate must run whenever LOSE_ZERO / REQUIRE_INJECT_COVER is on");
    assert.ok(body.includes("isManualOperatorBuy"), "operator /buy is the leftover+edge test bypass");
  });

  it("executeSell and executeBuy run amountOutMinimum sanity before submit", () => {
    assert.ok(src.includes("sanitizeAmountOutMinimum"), "minOut helper must be imported");
    const sellFn = src.indexOf("async function executeSell(");
    const buyFn = src.indexOf("async function executeBuy(");
    const sellEnd = src.indexOf("\nasync function ", sellFn + 1);
    const buyEnd = src.indexOf("\nasync function ", buyFn + 1);
    const sellSanity = src.indexOf("sanitizeAmountOutMinimum", sellFn);
    const buySanity = src.indexOf("sanitizeAmountOutMinimum", buyFn);
    const sellSend = src.indexOf("encodeSwap(", sellFn);
    const buySend = src.indexOf("encodeSwap(", buyFn);
    assert.ok(sellFn >= 0 && sellSanity > sellFn && sellSanity < sellEnd, "executeSell must sanitize minOut");
    assert.ok(buyFn >= 0 && buySanity > buyFn && buySanity < buyEnd, "executeBuy must sanitize minOut");
    assert.ok(sellSanity < sellSend, "executeSell must sanitize before encodeSwap");
    assert.ok(buySanity < buySend, "executeBuy must sanitize before encodeSwap");
    assert.ok(src.includes("buildSellGateDecision"), "must size hitch or skip it — never lose to insert storage");
    assert.ok(src.includes("isCatalogFrozen(token)"), "must not drop the frozen buy gate");
    assert.ok(src.includes("evaluatePriceInsane"), "PRICE_INSANE must run before hitch/minOut");
    assert.ok(src.includes("quoteHitchL1ForGates") || src.includes("estimateHitchL1FeeEth"), "live L1 hitch fee must be quoted");
    assert.ok(src.includes("buy hitch skipped — L1 fee unknown"), "buy L1 fallback must SKIP hitch, not hitch VITA anyway");
    assert.ok(!src.includes("hitch VITA anyway"), "leftoverWouldCover must not re-attach VITA without live L1");
    assert.ok(src.includes("planVoiceHitch") && src.includes("appendUtf8Hitch"), "UTF-8 §$STORE§ hitch must ride the swap");
    assert.ok(src.includes("hitchTelegramFooter"), "Telegram must not claim a letter that is not on-chain");
    assert.ok(src.includes("hitchLedgerSignature"), "ledger must not stamp Eureka on a plain swap");
    assert.ok(src.includes("sendStoreVoiceProof") && src.includes("/prove"), "dedicated 0-ETH /prove must exist");
    assert.ok(src.includes("storeVoiceEnabled()"), "voice hitch must not depend on BTP auto-suspend");
    assert.ok(src.includes("isSuccessfulBuyFill"), "buys must refuse 0-token success");
    assert.ok(src.includes("nextVitaModel"), "VITA must cycle models");
    assert.ok(!src.includes("enabled: BTP_INSCRIPTIONS_ENABLED && !btpAutoSuspended"), "must not gate UTF-8 voice on BTP suspend");
    assert.ok(src.includes("GAS_PRICE_ORACLE"), "GasPriceOracle predeploy helper");
    assert.ok(src.includes("formatHitchFeeSplit") || src.includes("HITCH FEE"), "must log L1 vs L2 hitch split");
    assert.ok(!src.includes("HALT_NEW_ENTRIES=\"\"") && !src.includes("HALT_NEW_ENTRIES = \"\""), "must not clear HALT_NEW_ENTRIES");
    const sellInsane = src.indexOf("gatePriceInsane", sellFn);
    assert.ok(sellInsane > sellFn && sellInsane < sellSanity, "PRICE_INSANE before minOut on sell");
  });

  it("does not unfreeze overnight data-only names or flip deep earners", () => {
    assert.match(src, /symbol: "STONKEX"[\s\S]*?frozen: true/);
    assert.match(src, /symbol: "BLUECHIP"[\s\S]*?frozen: true/);
    assert.match(src, /symbol: "VELVET"[\s\S]*?frozen: true/);
    assert.match(src, /symbol: "KTA"[\s\S]{0,400}?frozen: true/);
    assert.ok(src.includes('address: "0xc0634090F2Fe6C6D75e61Be2b949464aBb498973"'), "KTA Base address");
    assert.match(src, /symbol: "TIBBIR"[\s\S]*?frozen: true/);
    assert.ok(!/\bsymbol: "(BSTONK|FLOCK|HYDX)"/.test(src), "do not add BSTONK/FLOCK/HYDX");
    for (const sym of ["DRB", "CLANKER", "LINK", "UNI", "VVV", "ZORA", "BNKR", "AERO", "TOSHI", "DEGEN", "BRETT", "VIRTUAL", "MORPHO", "DOGINME"]) {
      const base = src.indexOf(`symbol: "${sym}"`);
      assert.ok(base >= 0, `${sym} must remain in catalog`);
      const next = src.indexOf("{ symbol:", base + 1);
      const row = src.slice(base, next > 0 ? next : base + 400);
      assert.ok(!row.includes("frozen: true"), `${sym} must stay tradeable`);
    }
    // Thin gas-burners + BASECAT CAUTION/CUT — exits-only. GAME already frozen.
    for (const sym of ["AIXBT", "KEYCAT", "SKI", "LUNA", "REI", "BASECAT", "GAME"]) {
      const base = src.indexOf(`symbol: "${sym}"`);
      assert.ok(base >= 0, `${sym} must remain in catalog`);
      const next = src.indexOf("{ symbol:", base + 1);
      const row = src.slice(base, next > 0 ? next : base + 500);
      assert.ok(row.includes("frozen: true"), `${sym} must stay frozen exits-only`);
    }
    assert.ok(src.includes('address: "0xB2000000000000000000004c27f6523082f41D01"'), "BASECAT catalog address");
    assert.match(src, /FIFO 12\/31 red sells/);
    // CBBTC/AAVE stay catalogued but FROZEN — fractional bags locked the RISK book.
    for (const sym of ["CBBTC", "AAVE"]) {
      const base = src.indexOf(`symbol: "${sym}"`);
      assert.ok(base >= 0, `${sym} must remain in catalog`);
      const next = src.indexOf("{ symbol:", base + 1);
      const row = src.slice(base, next > 0 ? next : base + 500);
      assert.ok(row.includes("frozen: true"), `${sym} must stay frozen (locked majors)`);
    }
  });

  it("documents the TDZ error the live logs showed", () => {
    assert.throws(() => {
      new Function(`
        const arm = { armed: true };
        const shouldBuy = false;
        const shouldSell = false;
        if (arm.armed && !shouldBuy && !shouldSell && !hasPosition) {}
        const hasPosition = true;
      `)();
    }, /before initialization/);
  });
});
