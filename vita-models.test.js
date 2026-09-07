import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_VITA_MODEL_CYCLE,
  parseVitaModels,
  peekVitaModel,
  nextVitaModel,
  vitaModelStatus,
  resetVitaModelCursor,
  vitaModelStatusMessage,
} from "./vita-models.js";

const root = dirname(fileURLToPath(import.meta.url));

describe("VITA model cycle", () => {
  beforeEach(() => resetVitaModelCursor());

  it("defaults to sonnet then opus so we can compare quality", () => {
    assert.equal(DEFAULT_VITA_MODEL_CYCLE[0], "claude-sonnet-4-20250514");
    assert.ok(DEFAULT_VITA_MODEL_CYCLE.length >= 2);
    assert.equal(parseVitaModels({}).length, DEFAULT_VITA_MODEL_CYCLE.length);
  });

  it("honors VITA_MODELS env as a comma list", () => {
    const list = parseVitaModels({ VITA_MODELS: "claude-sonnet-4-20250514, claude-opus-4-20250514, claude-haiku-4-20250514" });
    assert.deepEqual(list, [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-haiku-4-20250514",
    ]);
  });

  it("round-robins nextVitaModel without repeating until the ring wraps", () => {
    const a = nextVitaModel({});
    const b = nextVitaModel({});
    const c = nextVitaModel({});
    assert.equal(a.model, DEFAULT_VITA_MODEL_CYCLE[0]);
    assert.equal(b.model, DEFAULT_VITA_MODEL_CYCLE[1]);
    assert.equal(c.model, DEFAULT_VITA_MODEL_CYCLE[0]);
    assert.notEqual(a.model, b.model);
  });

  it("peek does not advance the cursor", () => {
    assert.equal(peekVitaModel({}), DEFAULT_VITA_MODEL_CYCLE[0]);
    assert.equal(peekVitaModel({}), DEFAULT_VITA_MODEL_CYCLE[0]);
    assert.equal(vitaModelStatus({}).index, 0);
  });

  it("status message lists the ring", () => {
    const msg = vitaModelStatusMessage({});
    assert.match(msg, /VITA MODEL CYCLE/);
    assert.match(msg, /claude-sonnet-4-20250514/);
    assert.match(msg, /VITA_MODELS/);
  });
});

describe("agent.js wires the cycle into every Claude call", () => {
  const src = readFileSync(join(root, "agent.js"), "utf8");

  it("imports nextVitaModel and does not hardcode a single sonnet id on every call", () => {
    assert.ok(src.includes("nextVitaModel"), "must import nextVitaModel");
    assert.ok(src.includes("/models"), "Telegram /models must exist");
    const hardcoded = [...src.matchAll(/model:\s*"claude-sonnet-4-20250514"/g)];
    assert.equal(hardcoded.length, 0, "must not pin every Claude call to one id");
    assert.match(src, /model:\s*nextVitaModel/);
  });
});
