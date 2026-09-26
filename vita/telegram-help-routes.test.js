/**
 * HELP click-through + route domino systems-check.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HELP_SECTIONS,
  TOKEN_PICK_VERBS,
  assertHelpCallbacksFit,
  buildFolderMerkleTree,
  buildHelpNavKeyboard,
  buildHelpSectionKeyboard,
  buildRouteCheckKeyboard,
  buildTokenPickKeyboard,
  formatRouteSystemsCheckCard,
  handleHelpAction,
  parseHelpCommand,
  parsePickCommand,
  runRouteAvenueDomino,
  runRouteSystemsCheck,
} from "./telegram-help-routes.js";
import { parseChainLayerCommand } from "./chain-layer.js";
import { parseVitaMirrorCommand } from "./mirror-chain.js";
import { HOME_SECTIONS } from "./telegram-home.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

describe("telegram help click-through", () => {
  it("exposes help sections with ≤64B callbacks", () => {
    assert.ok(HELP_SECTIONS.some((s) => s.id === "trade"));
    assert.ok(HELP_SECTIONS.some((s) => s.id === "check"));
    const fit = assertHelpCallbacksFit();
    assert.equal(fit.ok, true, JSON.stringify(fit.bad));
    const nav = buildHelpNavKeyboard();
    assert.ok(nav.inline_keyboard.flat().some((b) => b.callback_data === "/help trade" || b.callback_data === "/vita check routes"));
  });

  it("/sell bare opens token picker; /pick sell wires symbols", () => {
    assert.equal(parsePickCommand("/sell").action, "pick");
    assert.equal(parsePickCommand("/sell").verb, "sell");
    assert.equal(parsePickCommand("/pick buy").verb, "buy");
    assert.equal(parsePickCommand("/buy AERO").ok, false); // has symbol — real command
    const kb = buildTokenPickKeyboard("sell", ["AERO", "BRETT", "VIRTUAL"]);
    const cbs = kb.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(cbs.includes("/sell AERO"));
    assert.ok(cbs.includes("/sell BRETT"));
    assert.ok(cbs.every((c) => c.length <= 64));
    for (const v of ["buy", "exit", "piggyunlock"]) {
      assert.ok(TOKEN_PICK_VERBS.includes(v));
    }
  });

  it("help section trade lists pick verbs", () => {
    const out = handleHelpAction({ action: "section", section: "trade" });
    assert.match(out.reply, /Sell|Buy/i);
    assert.ok(out.keyboard.inline_keyboard.flat().some((b) => b.callback_data === "/pick sell"));
  });

  it("HOME includes trade + syscheck sections", () => {
    const ids = HOME_SECTIONS.map((s) => s.id);
    assert.ok(ids.includes("trade"));
    assert.ok(ids.includes("syscheck"));
    assert.ok(ids.includes("agents"));
  });
});

describe("route domino systems-check", () => {
  it("merkle folders + core files", () => {
    const tree = buildFolderMerkleTree({ cwd: ROOT });
    assert.ok(tree.containerRoot);
    assert.ok(tree.folders.length >= 4);
    assert.ok(tree.core.some((c) => c.path.includes("mainframe.js")));
    assert.ok(["PASS", "QUESTIONABLE", "FAIL"].includes(tree.verdict));
  });

  it("avenue domino uses min tokens and flags empty catalog", () => {
    const withTok = runRouteAvenueDomino({
      cwd: ROOT,
      symbols: ["AERO", "BRETT"],
    });
    assert.ok(withTok.total >= 10);
    assert.deepEqual(withTok.minTokensUsed, ["AERO", "BRETT"]);
    assert.ok(withTok.nodes.some((n) => n.id === "pick-sell" && n.status === "PASS"));

    const empty = runRouteAvenueDomino({ cwd: ROOT, symbols: [] });
    const cat = empty.nodes.find((n) => n.id === "token-catalog");
    assert.equal(cat.status, "QUESTIONABLE");
  });

  it("runRouteSystemsCheck logs + stages force body", async () => {
    const report = await runRouteSystemsCheck({
      cwd: ROOT,
      symbols: ["AERO", "VIRTUAL", "BRETT"],
      write: true,
      includeChainLayer: true,
    });
    assert.ok(report.forceInjectBody.includes("§SYSCHECK§"));
    assert.ok(report.containerRoot);
    assert.match(formatRouteSystemsCheckCard(report), /ROUTE SYSTEMS CHECK/);
    assert.ok(existsSync(join(HERE, "memory", "systems-check-routes-latest.json")));
    assert.ok(existsSync(join(HERE, "strands", "systems-check-routes.json")));
    const latest = JSON.parse(
      readFileSync(join(HERE, "memory", "systems-check-routes-latest.json"), "utf8"),
    );
    assert.equal(latest.verdict, report.verdict);
    assert.ok(Array.isArray(latest.errorLocations));
    const kb = buildRouteCheckKeyboard();
    assert.ok(kb.inline_keyboard.flat().some((b) => b.callback_data === "/vitafeed override"));
  });

  it("/vita check routes parses through chain-layer + mirror", () => {
    assert.equal(parseChainLayerCommand("/vita check routes").action, "routes");
    assert.equal(parseVitaMirrorCommand("/vita check routes").action, "routes");
    assert.equal(parseHelpCommand("/help check").action, "routes");
  });

  it("agent wires help + pick + route check", () => {
    const agent = readFileSync(join(ROOT, "agent.js"), "utf8");
    assert.match(agent, /telegram-help-routes/);
    assert.match(agent, /parseHelpCommand/);
    assert.match(agent, /parsePickCommand/);
    assert.match(agent, /runRouteSystemsCheck/);
  });
});
