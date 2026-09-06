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
