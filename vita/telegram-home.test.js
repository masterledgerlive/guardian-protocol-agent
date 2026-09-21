/**
 * VITA Telegram HOME — sectioned buttons, route sims, dual-engine mirror.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CALLBACK_DATA_MAX as MIRROR_CB_MAX,
} from "./mirror-chain.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";
import {
  HOME_SECTIONS,
  TELEGRAM_HOME_ID,
  TELEGRAM_HOME_LABEL,
  allHomeRouteCommands,
  assertHomeCallbacksFit,
  buildHomeNavKeyboard,
  buildHomeSectionKeyboard,
  compareEngines,
  formatEngineCompareCard,
  formatHomeCard,
  formatHomeSimCard,
  handleHomeAction,
  homeIdmLocations,
  mirrorMainEngine,
  mirrorNewEngine,
  parseHomeCommand,
  runHomeRouteSims,
  runSearchRouteSims,
  telegramHomeCallbackData,
  withHomeButton,
} from "./telegram-home.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("telegram-home sectioned keyboard", () => {
  it("exposes every avenue section with clickable routes", () => {
    assert.equal(TELEGRAM_HOME_ID, "vita-telegram-home-v1");
    assert.equal(TELEGRAM_HOME_LABEL, "TELEGRAM_HOME");
    const ids = HOME_SECTIONS.map((s) => s.id);
    assert.ok(ids.includes("memory"));
    assert.ok(ids.includes("feed"));
    assert.ok(ids.includes("search"));
    assert.ok(ids.includes("wave"));
    assert.ok(ids.includes("mirror"));
    assert.ok(ids.includes("dual"));
    assert.ok(ids.includes("status"));
    assert.ok(ids.includes("trade"));
    assert.ok(ids.includes("syscheck"));
    const routes = allHomeRouteCommands();
    assert.ok(routes.length >= 40, "enough interactive routes");
    assert.ok(routes.some((r) => r.cmd === "/vitafeed ref calculator"));
    assert.ok(routes.some((r) => r.cmd === "/xmem STORE"));
    assert.ok(routes.some((r) => r.cmd === "/wavetest"));
    assert.ok(routes.some((r) => r.cmd.startsWith("/vita read")));
    assert.ok(routes.some((r) => r.cmd === "/pick sell"));
    assert.ok(routes.some((r) => r.cmd === "/vita check routes"));
  });

  it("fits every callback_data under Telegram 64-byte limit", () => {
    const fit = assertHomeCallbacksFit();
    assert.equal(fit.ok, true, JSON.stringify(fit.bad));
    assert.equal(fit.max, MIRROR_CB_MAX);
    for (const r of allHomeRouteCommands()) {
      assert.ok(telegramHomeCallbackData(r.cmd).length <= 64);
    }
  });

  it("builds HOME nav + section keyboards with 🏠 always", () => {
    const nav = buildHomeNavKeyboard();
    assert.ok(nav.inline_keyboard.length >= 3);
    const flat = nav.inline_keyboard.flat();
    assert.ok(flat.some((b) => b.callback_data === "/home"));
    assert.ok(flat.some((b) => b.callback_data === "/home search"));
    assert.ok(flat.some((b) => b.callback_data === "/home sim"));

    const search = buildHomeSectionKeyboard("search");
    const sFlat = search.inline_keyboard.flat();
    assert.ok(sFlat.some((b) => b.callback_data === "/home"));
    assert.ok(sFlat.some((b) => b.callback_data === "/vitafeed ref calculator"));
    assert.ok(sFlat.some((b) => b.callback_data === "/vitafeed proven"));
    assert.ok(sFlat.some((b) => b.callback_data === "/xmem STORE"));

    const wrapped = withHomeButton({ inline_keyboard: [[{ text: "X", callback_data: "/status" }]] });
    assert.ok(wrapped.inline_keyboard.flat().some((b) => b.callback_data === "/home"));
  });

  it("parses /home|/menu|/start|/home sim|/home engines", () => {
    assert.equal(parseHomeCommand("/home").action, "home");
    assert.equal(parseHomeCommand("/menu").action, "home");
    assert.equal(parseHomeCommand("/start").action, "home");
    assert.equal(parseHomeCommand("/home search").action, "section");
    assert.equal(parseHomeCommand("/home search").section, "search");
    assert.equal(parseHomeCommand("/home sim").action, "sim");
    assert.equal(parseHomeCommand("/home sim search").section, "search");
    assert.equal(parseHomeCommand("/home engines").action, "engines");
    assert.equal(parseHomeCommand("/vitafeed brain").ok, false);
  });
});

describe("telegram-home dual engine mirror + IDM", () => {
  it("mirrors the same body into MAIN exact and NEW snark", () => {
    const body =
      "HOME dual mirror — message-first; never invent hashes. ".repeat(12) +
      "Recursive memory seed for MAIN exact UTF-8 VITAFEED vs NEW snark-short cost learn.";
    const main = mirrorMainEngine(body, { ethUsd: 3000, gwei: 0.05 });
    const neu = mirrorNewEngine(body, { title: "test-mirror" });
    assert.equal(main.ok, true);
    assert.equal(neu.ok, true);
    assert.equal(main.engine, "MAIN");
    assert.equal(neu.engine, "NEW");
    assert.equal(neu.snarkReady, true);
    assert.ok(neu.bytes < main.bytes, "snark-short should be cheaper on bytes for large seed");
    assert.ok(main.chunks >= 1);
    assert.equal(neu.chunks, 1);
    assert.equal(neu.rawBytes, Buffer.byteLength(body, "utf8"));
  });

  it("compares engines and attaches static IDM anchor locs only", () => {
    const cmp = compareEngines("seed for cheaper/faster learn", { quotes: { ethUsd: 2500 } });
    assert.equal(cmp.ok, true);
    assert.ok(["MAIN", "NEW", "tie"].includes(cmp.cheaper));
    assert.ok(["MAIN", "NEW", "tie"].includes(cmp.faster));
    assert.ok(cmp.idm.length >= 1);
    for (const loc of cmp.idm) {
      assert.match(loc.location, /^0x[0-9a-fA-F]{64}$/);
      assert.ok(
        MAINFRAME_ANCHORS.known.some((a) => a.tx.toLowerCase() === loc.location.toLowerCase()),
      );
      assert.match(loc.basescan, /basescan\.org\/tx\//);
      assert.match(loc.idmChat, /Input Data/);
    }
    const card = formatEngineCompareCard(cmp);
    assert.match(card, /DUAL ENGINE MIRROR/);
    assert.match(card, /cheaper=/);
    assert.match(card, /IDM CHAT/);
  });

  it("homeIdmLocations never invents hashes", () => {
    const locs = homeIdmLocations(["0x" + "f".repeat(64), "not-a-hash", "0xdead"]);
    for (const loc of locs) {
      assert.match(loc.location, /^0x[0-9a-fA-F]{64}$/);
    }
    assert.ok(locs.some((l) => l.location.toLowerCase() === ("0x" + "f".repeat(64)).toLowerCase()));
  });
});

describe("telegram-home many route + search simulations", () => {
  it("runs search route sims with packaged ref memory + proven tests", () => {
    const search = runSearchRouteSims();
    assert.ok(search.count >= 6);
    assert.ok(search.passed >= 5, "most search queries resolve true-name");
    for (const r of search.results) {
      assert.equal(r.invented, false);
      if (r.ok && r.route === "ref-memory") {
        assert.ok(r.trueName);
        assert.ok(r.locCount >= 1);
      }
    }
    const proven = search.results.find((r) => r.route === "proven-calculator");
    assert.equal(proven.ok, true);
  });

  it("runs full home route sims and seeds learn ledger", () => {
    const report = runHomeRouteSims({ section: "all" });
    assert.equal(report.routesOk, report.routeCount);
    assert.ok(report.routeCount >= 40);
    assert.ok(report.search?.passed >= 5);
    assert.ok(report.snarkBatch?.snarkReady);
    assert.match(report.snarkBatch.root, /^[0-9a-f]{64}$/);
    assert.ok(report.idm.every((l) => /^0x[0-9a-fA-F]{64}$/.test(l.location)));
    const card = formatHomeSimCard(report);
    assert.match(card, /HOME ROUTE SIM/);
    assert.match(card, /search /);
    assert.ok(existsSync(join(root, "vita/memory/telegram-home-learn.json")));
    assert.ok(existsSync(join(root, "vita/memory/telegram-home-sim-ledger.json")));
  });

  it("section sim for search only stays connected", () => {
    const report = runHomeRouteSims({ section: "search" });
    assert.ok(report.routes.every((r) => r.section === "search"));
    assert.equal(report.routesOk, report.routeCount);
    assert.ok(report.search);
  });

  it("handleHomeAction returns keyboards for home/section/sim/engines", async () => {
    const home = handleHomeAction({ action: "home" });
    assert.equal(home.ok, true);
    assert.ok(home.keyboard.inline_keyboard.length >= 3);
    assert.match(home.reply, /VITA HOME/);
    assert.match(formatHomeCard(), /every route is a button/);

    const sec = handleHomeAction({ action: "section", section: "feed" });
    assert.equal(sec.section, "feed");
    assert.ok(sec.keyboard.inline_keyboard.flat().some((b) => b.callback_data === "/vitafeed brain"));

    const eng = handleHomeAction({ action: "engines" });
    assert.equal(eng.ok, true);
    assert.ok(eng.compare.cheaper);
    assert.match(eng.reply, /MAIN|NEW/);

    const sim = handleHomeAction({ action: "sim", section: "wave" });
    assert.equal(sim.ok, true);
    assert.ok(sim.report.routes.every((r) => r.section === "wave"));
  });
});

describe("telegram-home agent + filing wiring", () => {
  it("agent.js wires /home|/menu|/start and imports telegram-home", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");
    assert.match(agent, /from ["']\.\/vita\/telegram-home\.js["']/);
    assert.match(agent, /parseHomeCommand/);
    assert.match(agent, /handleHomeAction/);
    assert.match(agent, /text === "\/home"|\/home\|/);
  });

  it("FILING + AGENTS mention TELEGRAM_HOME", () => {
    const filing = readFileSync(join(root, "vita/FILING.md"), "utf8");
    const agents = readFileSync(join(root, "vita/AGENTS.md"), "utf8");
    assert.match(filing, /TELEGRAM_HOME|telegram-home/);
    assert.match(agents, /\/home|telegram-home|sectioned/);
  });
});
