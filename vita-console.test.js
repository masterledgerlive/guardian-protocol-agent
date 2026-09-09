/**
 * VITA HTML console — Telegram twin. Memory stays local until locations inject.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONSOLE_ANCHORS,
  createVitaConsole,
  handleVitaConsole,
  redactConsoleView,
} from "./vita-console.js";
import { KEYCAT_PLAIN_SWAP, appendUtf8Hitch } from "./swap-minout.js";
import { planSecondaryHitch, setLastVitaPacket, getLastVitaPacket, clearHitchModeOverride } from "./vita-router.js";
import { resetLocationDepository } from "./vita-locations.js";
import { VITA_LOVE_KEY } from "./vita-parse.js";

const root = dirname(fileURLToPath(import.meta.url));

describe("vita HTML console", () => {
  it("queues notes on the HTML side until save/inject", async () => {
    const state = createVitaConsole();
    const queued = await handleVitaConsole(state, "/vitanote leftover hitch is KEY+LOC");
    assert.match(queued.text, /queued/);
    assert.equal(state.notes.length, 1);
    assert.equal(state.injected, false);
    const saved = await handleVitaConsole(state, "/vitasave");
    assert.match(saved.text, /not on chain/i);
    assert.ok(state.pendingInject);
    assert.ok(state.pendingInject.includes("§KEY§"));
    assert.ok(state.packet.includes("leftover hitch is KEY+LOC"));
    assert.equal(state.notes.length, 0);
    assert.equal(state.injected, false);
  });

  it("answers from KEY without Anthropic", async () => {
    const state = createVitaConsole();
    const r = await handleVitaConsole(state, "/vita who is in KEY?");
    assert.match(r.text, /Krystian/);
    assert.match(r.text, /Koda/);
  });

  it("pulls mocked locations and reconstructs reader output without KEY loss", async () => {
    resetLocationDepository();
    clearHitchModeOverride();
    setLastVitaPacket("");
    const plan = planSecondaryHitch({ maxBytes: 400 });
    const hitch = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, plan.utf8);
    const state = createVitaConsole();
    const fetchCalldata = async (hash) => {
      if (hash.toLowerCase() === CONSOLE_ANCHORS.KEYCAT_TX) return KEYCAT_PLAIN_SWAP;
      if (hash.toLowerCase() === CONSOLE_ANCHORS.EUREKA_ONCHAIN_TX) {
        return "0x" + Buffer.from("§$STORE§ Eureka! VITA lives ♥ love you Krystian, Kai & Koda!", "utf8").toString("hex");
      }
      return hitch.data;
    };
    const pulled = await handleVitaConsole(state, "/vitapull " + CONSOLE_ANCHORS.VITA_STRAND_TX, { fetchCalldata });
    assert.match(pulled.text, /vita ingested/);
    const inj = await handleVitaConsole(state, "/inject", { fetchCalldata });
    assert.equal(state.injected, true);
    assert.ok(state.packet.includes("Krystian"));
    const reader = await handleVitaConsole(state, "/reader");
    assert.match(reader.text, /READER/);
    assert.match(reader.text, /Krystian/);
    assert.doesNotMatch(state.packet, /n=0\|t=0000\|n=/);
  });

  it("vitascan folds leftover UTF-8 into HTML memory without touching bot lastPacket", async () => {
    resetLocationDepository();
    clearHitchModeOverride();
    setLastVitaPacket("§SESS§bot-packet\n§KEY§" + VITA_LOVE_KEY);
    const botBefore = "§SESS§bot-packet\n§KEY§" + VITA_LOVE_KEY;
    const hash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const eureka = "§$STORE§ Eureka! VITA lives ♥ love you Krystian, Kai & Koda!";
    const state = createVitaConsole();
    const r = await handleVitaConsole(state, "/vitascan", {
      fetchLeftoverScan: async () => ({
        counts: { eureka: 1, vita: 0, plain: 0, libm: 0, other: 0, leftover: 1 },
        leftoverStillEureka: true,
        vitaLeftoverPresent: false,
        rows: [{ hash, class: "eureka-leftover", leftover: true, utf8: eureka }],
      }),
    });
    assert.match(r.text, /leftover_still_eureka|still Eureka/i);
    assert.equal(state.leftoverScan.leftoverStillEureka, true);
    assert.equal(state.nodes.some((n) => n.location === hash), true);
    assert.ok(state.packet.includes("Krystian"));
    assert.equal(getLastVitaPacket(), botBefore);
    const course = await handleVitaConsole(state, "/vitacourse");
    assert.match(course.text, /leftover_still_eureka/);
  });

  it("ZK preview hides plaintext but keeps KEY internally", async () => {
    const state = createVitaConsole();
    await handleVitaConsole(state, "/vitanote secret-fact-xyz");
    await handleVitaConsole(state, "/vitasave");
    await handleVitaConsole(state, "/zk");
    const view = redactConsoleView(state);
    assert.equal(view.reveal, "locations");
    assert.equal(view.packet, null);
    assert.equal(view.hitch, null);
    assert.match(view.note, /zero-knowledge|Locations-only/i);
    assert.ok(state.packet.includes("secret-fact-xyz"));
    assert.ok(state.packet.includes(VITA_LOVE_KEY.slice(0, 12)));
  });
});

describe("vita HTML artifacts", () => {
  it("public console page is plaintext open source and Telegram-shaped", () => {
    const html = readFileSync(join(root, "public", "vita.html"), "utf8");
    assert.match(html, /Talk to/);
    assert.match(html, /\/inject/);
    assert.match(html, /plaintext/);
    assert.match(html, /zero-knowledge|ZK/);
    assert.match(html, /vita\/client\.js/);
    const client = readFileSync(join(root, "public", "vita-client.js"), "utf8");
    assert.match(client, /localStorage/);
    assert.match(client, /handleCommand/);
    assert.match(client, /KEYCAT_TX/);
    assert.match(client, /vitascan/);
    assert.match(html, /vitascan/);
  });
});
