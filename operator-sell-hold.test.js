import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPROVE_HOME_SELL_ENV,
  HOLD_ALL_SELLS_ENV,
  HOLD_ALL_SELLS_REASON,
  HOLD_HOME_SELL_REASON,
  armHoldAllSells,
  clearHoldAllSells,
  holdAllSellsStatusLine,
  isHoldAllSells,
  isHomeSellApproved,
  isHomeSymbol,
  shouldBlockSell,
  shouldNeverSellHome,
} from "./operator-sell-hold.js";

describe("operator-sell-hold", () => {
  it("isHoldAllSells is yes-only", () => {
    assert.equal(isHoldAllSells({}), false);
    assert.equal(isHoldAllSells({ [HOLD_ALL_SELLS_ENV]: "yes" }), true);
    assert.equal(isHoldAllSells({ [HOLD_ALL_SELLS_ENV]: "no" }), false);
    assert.equal(isHoldAllSells({ [HOLD_ALL_SELLS_ENV]: "true" }), false);
  });

  it("arm / clear mutate env", () => {
    const env = {};
    armHoldAllSells(env);
    assert.equal(env[HOLD_ALL_SELLS_ENV], "yes");
    assert.equal(isHoldAllSells(env), true);
    clearHoldAllSells(env);
    assert.equal(env[HOLD_ALL_SELLS_ENV], "no");
    assert.equal(isHoldAllSells(env), false);
  });

  it("HOME never-sells unless APPROVE_HOME_SELL=yes", () => {
    assert.equal(isHomeSymbol("home"), true);
    assert.equal(shouldNeverSellHome("HOME", {}), true);
    assert.equal(shouldNeverSellHome("AERO", {}), false);
    assert.equal(isHomeSellApproved({}), false);
    assert.equal(shouldNeverSellHome("HOME", { [APPROVE_HOME_SELL_ENV]: "yes" }), false);
  });

  it("shouldBlockSell freezes all bags when HOLD_ALL_SELLS=yes", () => {
    const env = { [HOLD_ALL_SELLS_ENV]: "yes" };
    const aero = shouldBlockSell({ symbol: "AERO", env });
    assert.equal(aero.block, true);
    assert.equal(aero.code, "HOLD_ALL_SELLS");
    assert.match(aero.why, /HOLD_ALL_SELLS/);
    assert.equal(aero.why, HOLD_ALL_SELLS_REASON);
  });

  it("HOME blocks even when HOLD_ALL_SELLS is off", () => {
    const home = shouldBlockSell({ symbol: "HOME", env: {} });
    assert.equal(home.block, true);
    assert.equal(home.code, "HOLD_HOME");
    assert.equal(home.why, HOLD_HOME_SELL_REASON);
  });

  it("HOME still blocks under HOLD_ALL_SELLS (HOME code wins)", () => {
    const home = shouldBlockSell({
      symbol: "HOME",
      env: { [HOLD_ALL_SELLS_ENV]: "yes" },
    });
    assert.equal(home.block, true);
    assert.equal(home.code, "HOLD_HOME");
  });

  it("APPROVE_HOME_SELL + HOLD_ALL_SELLS off allows HOME", () => {
    const home = shouldBlockSell({
      symbol: "HOME",
      env: { [APPROVE_HOME_SELL_ENV]: "yes" },
    });
    assert.equal(home.block, false);
  });

  it("APPROVE_HOME_SELL does not bypass HOLD_ALL_SELLS for other bags", () => {
    const aero = shouldBlockSell({
      symbol: "AERO",
      env: {
        [HOLD_ALL_SELLS_ENV]: "yes",
        [APPROVE_HOME_SELL_ENV]: "yes",
      },
    });
    assert.equal(aero.block, true);
    assert.equal(aero.code, "HOLD_ALL_SELLS");
  });

  it("status line reports freeze", () => {
    assert.match(holdAllSellsStatusLine({ [HOLD_ALL_SELLS_ENV]: "yes" }), /HOLD_ALL_SELLS=yes/);
    assert.match(holdAllSellsStatusLine({}), /HOME never-sell/);
  });
});
