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

  it("does not touch lines before const lines is declared", () => {
    const decl = fn.search(/\bconst lines\b/);
    const firstPush = fn.search(/\blines\.push\b/);
    assert.ok(decl >= 0, "const lines must be declared in processToken");
    assert.ok(firstPush > decl, "lines.push before initialization (TDZ)");
  });

  it("executeSell and moonshot trim use the 2× hitch sell floor", () => {
    assert.ok(src.includes("buildSellGateDecision"), "sell floor helper must be imported");
    assert.ok(src.includes("HITCH_COST_MULT"), "sell floor must mention HITCH_COST_MULT");
    const sellFn = src.indexOf("async function executeSell(");
    const moon = src.indexOf("MOONSHOT SELL-DOWN");
    const sellGate = src.indexOf("buildSellGateDecision", sellFn);
    const moonGate = src.indexOf("buildSellGateDecision", moon);
    assert.ok(sellFn >= 0 && sellGate > sellFn, "executeSell must call buildSellGateDecision");
    assert.ok(moon >= 0 && moonGate > moon, "moonshot trim must call buildSellGateDecision");
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

  it("does not unfreeze catalog names or flip BASECAT", () => {
    assert.match(src, /symbol: "STONKEX"[\s\S]*?frozen: true/);
    assert.match(src, /symbol: "BLUECHIP"[\s\S]*?frozen: true/);
    assert.match(src, /symbol: "VELVET"[\s\S]*?frozen: true/);
    const base = src.indexOf('symbol: "BASECAT"');
    const next = src.indexOf("{ symbol:", base + 1);
    const row = src.slice(base, next > 0 ? next : base + 400);
    assert.ok(!row.includes("frozen: true"), "BASECAT must stay tradeable");
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
