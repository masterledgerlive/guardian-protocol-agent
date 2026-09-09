import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  armVitaTailwindPicture,
  isVitaPictureArmed,
  planTailwindPictureHitch,
  confirmTailwindPictureInject,
  planVitaTailwindOrVoiceHitch,
  vitaPictureStatusMessage,
  getVitaPictureCycle,
  resetVitaPictureCycleForTests,
} from "./vita-tailwind-picture.js";
import { encodeExactInputSingle } from "./swap-minout.js";
import { HAT_MAGIC } from "./vita-hat.js";

function fakeSwap() {
  return encodeExactInputSingle({
    tokenIn: "0x4200000000000000000000000000000000000006",
    tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    fee: 3000,
    recipient: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
    amountIn: 1000000000000000n,
    amountOutMinimum: 1n,
    sqrtPriceLimitX96: 0n,
  });
}

describe("vita-tailwind-picture", () => {
  beforeEach(() => {
    resetVitaPictureCycleForTests();
  });

  it("arms on VITA trigger like starting a strand", () => {
    assert.equal(isVitaPictureArmed(), false);
    const arm = armVitaTailwindPicture({ triggeredBy: "vitasave" });
    assert.equal(arm.armed, true);
    assert.equal(isVitaPictureArmed(), true);
    assert.equal(arm.totalBits, 512);
    assert.match(arm.strandId, /^VITA-PIC-/);
    const st = getVitaPictureCycle();
    assert.equal(st.armedBy, "vitasave");
  });

  it("packs sparse picture into leftover hitch (tailwind)", () => {
    armVitaTailwindPicture({ triggeredBy: "test" });
    const hitch = planTailwindPictureHitch(fakeSwap(), {
      leftoverEth: 0.01,
      gwei: 0.05,
      hitchCostMult: 2,
      maxBytes: 2000,
    });
    assert.equal(hitch.onChain, true);
    assert.equal(hitch.kind, "hat-picture");
    assert.ok(hitch.utf8.startsWith(HAT_MAGIC));
    assert.ok(hitch.nodeId);
    assert.ok(hitch.hitchBytes > 0);
  });

  it("skips when leftover too thin (no free invent)", () => {
    armVitaTailwindPicture({ triggeredBy: "test" });
    const hitch = planTailwindPictureHitch(fakeSwap(), {
      leftoverEth: 0,
      gwei: 0.05,
    });
    assert.equal(hitch.onChain, false);
  });

  it("seals on receipt and auto-arms next cycle when picture complete", () => {
    armVitaTailwindPicture({ triggeredBy: "test" });
    let guard = 0;
    let completed = false;
    while (!completed && guard++ < 64) {
      const hitch = planTailwindPictureHitch(fakeSwap(), {
        leftoverEth: 0.05,
        gwei: 0.05,
        hitchCostMult: 1,
        maxBytes: 4096,
      });
      if (!hitch.onChain) break;
      const conf = confirmTailwindPictureInject({
        txHash: "0x" + String(guard).padStart(2, "0").repeat(32),
        receiptStatus: "success",
        hitchOnChain: true,
        hitchBytes: hitch.hitchBytes,
        utf8: hitch.utf8,
        nodeId: hitch.nodeId,
        autoNextCycle: true,
      });
      assert.equal(conf.injected, true);
      if (conf.cycleComplete) {
        completed = true;
        assert.ok(conf.nextCycle?.armed);
        assert.ok(conf.spacedProof.pictureComplete);
        assert.ok(conf.spacedProof.spacedBlockchainLocations >= 1);
        assert.match(conf.receiptHtml, /EXIT INJECT RECEIPT|Picture assembled|spaced/);
      }
    }
    assert.equal(completed, true);
    // Next cycle armed for continuous proof
    assert.equal(isVitaPictureArmed(), true);
  });

  it("planVitaTailwindOrVoiceHitch prefers picture when armed", () => {
    armVitaTailwindPicture({ triggeredBy: "vitasave" });
    const hitch = planVitaTailwindOrVoiceHitch(fakeSwap(), {
      leftoverEth: 0.01,
      gwei: 0.05,
      preferPicture: true,
      voicePlanner: () => ({
        data: fakeSwap(),
        utf8: "voice",
        hitchBytes: 10,
        onChain: true,
      }),
    });
    assert.equal(hitch.kind, "hat-picture");
  });

  it("status message reflects armed cycle", () => {
    assert.match(vitaPictureStatusMessage(), /Not armed/);
    armVitaTailwindPicture({ triggeredBy: "vitasave" });
    assert.match(vitaPictureStatusMessage(), /PICTURE CYCLE/);
  });
});
