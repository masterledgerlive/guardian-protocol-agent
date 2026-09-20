/**
 * GRAFT command parser + dispatch — Telegram and CLI share this.
 */

import { FUND_TO, THINK_COST_ETH, THINK_FREE } from "./config.js";
import { formatShortTag, shortId } from "./hash.js";
import {
  ARTIFACT_DIED,
  ARTIFACT_HARVEST,
  ARTIFACT_SURVIVED,
  bag,
  findArtifact,
  fundPiggy,
  inclusionProof,
  ingestRaw,
  listArtifacts,
  markStatus,
  readLedger,
  readThought,
  setActive,
  thoughtsFor,
  treeView,
} from "./store.js";
import { think } from "./think.js";
import { MODELS, findModelSpec, INJECT_AVENUE } from "./models.js";
import { listReceipts, readDataLog, stageInject } from "./datalog.js";
import { readRail, runRailCycle } from "./rail.js";
import { SETTLEMENT, formatTokenLine } from "./tokens.js";

export function parseGraftCommand(text) {
  const raw = String(text || "").trim();
  const stripped = raw.replace(/^\/graft(?:@[A-Za-z0-9_]+)?/i, "").trim();
  if (!/^\/graft(?:@|$|\s)/i.test(raw) && raw.toLowerCase() !== "/graft") {
    return { ok: false, error: "not-graft", raw };
  }
  if (!stripped) return { ok: true, cmd: "help", arg: "", raw };
  const m = stripped.match(/^(\S+)(?:\s+([\s\S]+))?$/);
  const cmd = String(m?.[1] || "help").toLowerCase();
  const arg = String(m?.[2] || "").trim();
  const aliases = {
    file: "insert",
    ingest: "insert",
    add: "insert",
    start: "activate",
    on: "activate",
    stop: "sleep",
    off: "sleep",
    status: "help",
    piggy: "bag",
    wallet: "bag",
    ideas: "list",
    ls: "list",
    directory: "dir",
    catalog: "models",
    model: "models",
    receipt: "receipts",
    cycle: "rail",
  };
  return { ok: true, cmd: aliases[cmd] || cmd, arg, raw };
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clip(s, n = 3500) {
  const t = String(s ?? "");
  if (t.length <= n) return t;
  return `${t.slice(0, n)}\n…`;
}

function parseEth(arg) {
  const s = String(arg || "").trim().split(/\s+/)[0];
  if (!s) return NaN;
  const n = Number(s);
  return n;
}

function ideaLine(a) {
  const flag = a.active ? "ON" : "filed";
  return `<code>${esc(a.shortId)}</code> [${flag}] ${esc(a.title)} · ${esc(a.status)}`;
}

export function formatHelp(ledger = readLedger()) {
  const b = bag(ledger);
  return clip([
    `<b>GRAFT</b> — prompt-trial nursery (not VITA)`,
    `file a dump, activate it, throw money, watch thought, harvest later.`,
    ``,
    `piggy <code>${b.piggyEth}</code> ETH · last-root <code>${shortId(b.lastRoot, 12)}</code>`,
    `filed ${b.filed} · active ${b.active} · thoughts ${b.thoughts} · snap ${b.snapSeq}`,
    `tx — (none invented)`,
    ``,
    `<code>/graft insert …</code> — file a prompt (lossless)`,
    `<code>/graft list</code> — filed vs activated`,
    `<code>/graft activate [id|last]</code> — turn an idea ON`,
    `<code>/graft sleep [id]</code> — turn it OFF (still stored)`,
    `<code>/graft fund &lt;eth&gt;</code> — throw money at GRAFT piggy`,
    `<code>/graft think [id|last]</code> — one visible thought cycle (costs piggy)`,
    `<code>/graft log [id]</code> · <code>/graft tree</code> · <code>/graft dir [MODELS]</code>`,
    `<code>/graft models</code> — activate-ready catalog`,
    `<code>/graft rail</code> — run RAIL L0–L5 cycle (must be ON)`,
    `<code>/graft inject [id|all]</code> — compact old-way KEY+LOC packet (no broadcast)`,
    `<code>/graft receipts</code> · <code>/graft dlog</code> — inject avenue log`,
    `<code>/graft proof</code> · <code>/graft bag</code>`,
    `<code>/graft survive [id]</code> · <code>/graft die [id]</code> · <code>/graft harvest [id]</code>`,
    FUND_TO ? `fund-to (you send): <code>${esc(FUND_TO)}</code> then /graft fund` : `paper piggy default — GRAFT does not sweep V3`,
  ].join("\n"));
}

export function formatList(ledger = readLedger()) {
  const arts = listArtifacts(ledger).filter((a) => a.source !== "think");
  if (!arts.length) return "GRAFT list — empty. <code>/graft insert</code> a prompt.";
  const lines = ["<b>GRAFT list</b> (raw prompts; derived thoughts hidden)", ...arts.map(ideaLine)];
  return clip(lines.join("\n"));
}

export function formatTree(ledger = readLedger()) {
  const rows = treeView(ledger);
  const lines = ["<b>GRAFT tree</b>"];
  for (const row of rows) {
    const pad = "·".repeat(row.depth);
    const bits = (row.artifacts || []).map((a) => `${a.shortId}${a.active ? "*" : ""}`).join(" ");
    lines.push(`${pad}<code>${esc(row.nodeId)}</code> ${esc(row.title)}${bits ? ` — ${esc(bits)}` : ""}`);
  }
  lines.push(`last-root <code>${shortId(ledger.lastRoot, 12)}</code>`);
  return clip(lines.join("\n"));
}

export function formatBag(ledger = readLedger()) {
  const b = bag(ledger);
  return [
    `<b>GRAFT bag</b>`,
    `piggy <code>${b.piggyEth}</code> ETH`,
    `last-root <code>${b.lastRoot}</code>`,
    `artifacts ${b.artifacts} · filed ${b.filed} · active ${b.active}`,
    `survived ${b.survived} · died ${b.died} · harvest ${b.harvest} · thoughts ${b.thoughts}`,
    `tx hashes: ${b.txHashes.length ? b.txHashes.map(esc).join(", ") : "(none — never invented)"}`,
    `think cost <code>${THINK_COST_ETH}</code> ETH${THINK_FREE ? " · THINK_FREE yes" : ""}`,
  ].join("\n");
}

export function formatProof(ref, ledger = readLedger()) {
  const artifact = findArtifact(ref, ledger);
  const b = bag(ledger);
  const lines = [
    `<b>GRAFT proof</b>`,
    `last-root <code>${b.lastRoot}</code>`,
    `tx — (not broadcast; never invented)`,
  ];
  if (artifact) {
    const proof = inclusionProof(artifact.id, ledger);
    lines.push(`artifact <code>${artifact.shortId}</code> ${esc(artifact.title)}`);
    lines.push(`tag ${esc(artifact.tag || formatShortTag({ short: artifact.shortId, root: b.lastRoot, snap: ledger.snapSeq }))}`);
    lines.push(`inclusion ${proof.ok ? "yes" : "no"} · proof steps ${proof.proof?.length || 0}`);
    lines.push(`loc slot: ${artifact.loc || "(empty until harvest into VITA)"}`);
  } else {
    const dirs = Object.values(ledger.directory || {});
    for (const d of dirs.slice(-8)) {
      lines.push(`<code>${d.artifactId.slice(0, 8)}</code> ${esc(d.title)} loc=${d.loc || "—"}`);
    }
  }
  return clip(lines.join("\n"));
}

export function formatLog(ref, ledger = readLedger()) {
  const artifact = findArtifact(ref, ledger);
  if (!artifact) return "GRAFT log — not found. /graft list";
  const entries = thoughtsFor(artifact.id, ledger);
  if (!entries.length) {
    return `GRAFT log <code>${artifact.shortId}</code> — no think yet. Activate + fund + <code>/graft think ${artifact.shortId}</code>`;
  }
  const lines = [`<b>GRAFT log</b> <code>${artifact.shortId}</code> ${esc(artifact.title)}`];
  for (const e of entries) {
    const full = readThought(e.thoughtId);
    lines.push(`— ${e.ts} · cost ${e.costEth} · survival ${e.survival}`);
    for (const step of full?.steps || []) {
      lines.push(`  ${esc(step.agent)}/${esc(step.action)}: ${esc(step.note)}`);
    }
    lines.push(`  tx — (not broadcast; never invented)`);
  }
  return clip(lines.join("\n"));
}

export function formatDir(ledger = readLedger(), which = "") {
  const want = String(which || "").trim().toUpperCase();
  if (want === "MODELS" || want === "MODEL") return formatModels(ledger);
  const lines = [
    `<b>GRAFT:\\</b> ${INJECT_AVENUE}`,
    `MODELS\\  LOG\\  RECEIPTS\\  INJECT\\  ARCHIVE\\`,
  ];
  for (const [short, d] of Object.entries(ledger.directory || {})) {
    lines.push(`${short}\\ ${esc(d.title)} [${d.active ? "ON" : "filed"}] loc=${d.loc || "—"}`);
  }
  lines.push(`last-root <code>${shortId(ledger.lastRoot, 12)}</code>`);
  lines.push(`tx — (none invented)`);
  return clip(lines.join("\n"));
}

export function formatModels(ledger = readLedger()) {
  const lines = [`<b>GRAFT:\\MODELS\\</b> activate-ready · avenue ${INJECT_AVENUE}`];
  for (const spec of MODELS) {
    const art = findArtifact(spec.match, ledger);
    if (!art) {
      lines.push(`${spec.id}\\ (not seeded)`);
      continue;
    }
    lines.push(
      `${spec.id}\\ <code>${art.shortId}</code> [${art.active ? "ON" : "filed"}] ${spec.layers} loc=${art.loc || "—"}`,
    );
    lines.push(`  ${esc(spec.activate)}`);
  }
  lines.push(`last-root <code>${shortId(ledger.lastRoot, 12)}</code> · tx none invented`);
  return clip(lines.join("\n"));
}

export function formatReceipts() {
  const r = listReceipts();
  const lines = [
    `<b>GRAFT receipts</b> avenue <code>${r.avenue}</code>`,
    `packets ${r.packets.length} · data-log ${r.logCount}`,
    `tx hashes: ${r.txHashes.length ? r.txHashes.map(esc).join(", ") : "(none — never invented)"}`,
  ];
  for (const p of r.packets.slice(-8)) {
    lines.push(`<code>${p.shortId}</code> ${esc(p.model)} ${p.bytes}B KEY+LOC loc=${shortId(p.lastRoot, 16)} tx=none`);
  }
  return clip(lines.join("\n"));
}

export function formatDlog(limit = 12) {
  const rows = readDataLog().slice(-limit);
  if (!rows.length) return "GRAFT data-log empty. File / think / rail / inject first.";
  const lines = [`<b>GRAFT data-log</b> ${INJECT_AVENUE} (last ${rows.length})`];
  for (const row of rows) {
    lines.push(
      `${esc(row.ts)} ${esc(row.kind)} ${esc(row.model || "")} ${esc(row.artifactId || "")} root=${shortId(row.lastRoot || "", 8)} tx=none`,
    );
  }
  return clip(lines.join("\n"));
}

function formatRailCard(result) {
  if (!result.ok) {
    if (result.error === "not-active") {
      return `REFUSE rail — not ON. <code>/graft activate RAIL</code>`;
    }
    if (result.error === "insufficient") {
      return `REFUSE rail — piggy ${result.have} ETH, need ${result.need}. <code>/graft fund ${result.need}</code>`;
    }
    if (result.error === "not-found") return "REFUSE rail — seed missing. /graft models";
    return `REFUSE rail — ${esc(result.error)}`;
  }
  return [
    `<b>GRAFT RAIL cycle</b> <code>${result.artifact.shortId}</code>`,
    `L0 ${result.proof.bytes}B hash <code>${shortId(result.proof.payloadHash, 12)}</code> (not a SNARK)`,
    `L1 agg WETH piggy · L2 blob stand-in (not EIP-4844)`,
    `L3 W_ag <code>${result.arena.wag}</code> threshold ${result.arena.threshold} → ${result.verified ? "FOLD" : "HOLD"}`,
    `L4 dual-hash (not Dilithium) · L5 G_n <code>${shortId(result.motherRoot, 12)}</code>`,
    `paperCredit <code>${result.wethCredit ?? result.paperCredit}</code> ${esc(formatTokenLine(result.settlement || SETTLEMENT))} · piggy <code>${result.piggyEth}</code> ETH`,
    `last-root <code>${shortId(result.lastRoot, 12)}</code>`,
    `tx — (not broadcast; never invented)`,
    `next: <code>/graft inject RAIL</code>`,
  ].join("\n");
}

function formatThinkCard(result) {
  if (!result.ok) {
    if (result.error === "not-active") {
      return `REFUSE think — <code>${result.artifact.shortId}</code> is filed, not ON.\n<code>/graft activate ${result.artifact.shortId}</code>`;
    }
    if (result.error === "insufficient") {
      return `REFUSE think — piggy ${result.have} ETH, need ${result.need}.\n<code>/graft fund ${result.need}</code>`;
    }
    if (result.error === "not-found") return "REFUSE think — not found. /graft list";
    return `REFUSE think — ${esc(result.error)}`;
  }
  return [
    `<b>GRAFT think</b>`,
    `idea <code>${result.artifact.shortId}</code> ${esc(result.artifact.title)}`,
    `cost <code>${result.costEth}</code> ETH · piggy <code>${result.piggyEth}</code> after`,
    `survival <code>${result.classify.survival}</code> · layers ${esc((result.classify.layers || []).map((l) => l.nodeId).join(",") || "—")}`,
    `derived <code>${result.derived.shortId}</code> (original untouched)`,
    `last-root <code>${shortId(result.lastRoot, 12)}</code>`,
    `tag ${esc(result.artifact.tag || "")}`,
    `tx — (not broadcast; never invented)`,
    `next: <code>/graft log ${result.artifact.shortId}</code>`,
  ].join("\n");
}

export function dispatchGraftCommand(text, extra = {}) {
  const parsed = parseGraftCommand(text);
  if (!parsed.ok) return { ok: false, error: parsed.error, html: null };
  const cmd = parsed.cmd;
  const arg = extra.replyText && !parsed.arg ? String(extra.replyText) : parsed.arg;
  const ledger = readLedger();

  if (cmd === "help") return { ok: true, cmd, html: formatHelp(ledger) };
  if (cmd === "list") return { ok: true, cmd, html: formatList(ledger) };
  if (cmd === "tree") return { ok: true, cmd, html: formatTree(ledger) };
  if (cmd === "bag") return { ok: true, cmd, html: formatBag(ledger) };
  if (cmd === "dir") return { ok: true, cmd, html: formatDir(ledger, arg) };
  if (cmd === "models") return { ok: true, cmd, html: formatModels(ledger) };
  if (cmd === "proof") return { ok: true, cmd, html: formatProof(arg || "last", ledger) };
  if (cmd === "log") return { ok: true, cmd, html: formatLog(arg || "last", ledger) };
  if (cmd === "receipts") return { ok: true, cmd, html: formatReceipts() };
  if (cmd === "dlog") return { ok: true, cmd, html: formatDlog() };

  if (cmd === "insert") {
    const body = String(arg || extra.replyText || "").trim();
    if (!body) {
      return {
        ok: true,
        cmd,
        html: "GRAFT insert — paste the prompt after the command, or reply to a dump with <code>/graft insert</code>",
      };
    }
    const title = extra.title || firstTitle(body);
    const ingested = ingestRaw(body, {
      title,
      source: extra.source || "telegram",
      provenance: { origin: extra.source || "telegram" },
      nodeIds: extra.nodeIds || ["prompts"],
    });
    const a = ingested.artifact;
    return {
      ok: true,
      cmd,
      html: [
        `<b>GRAFT filed</b> ${ingested.duplicate ? "(duplicate hash — linked, not re-stored)" : "(lossless CAS)"}`,
        `<code>${a.shortId}</code> ${esc(a.title)} · ${a.bytes} bytes`,
        `status filed · active no`,
        `tag ${esc(a.tag)}`,
        `tx — (not broadcast; never invented)`,
        `activate: <code>/graft activate ${a.shortId}</code>`,
        `then throw money: <code>/graft fund 0.001</code> · <code>/graft think ${a.shortId}</code>`,
      ].join("\n"),
      artifact: a,
    };
  }

  if (cmd === "activate") {
    const r = setActive(arg || "last", true);
    if (!r.ok) return { ok: true, cmd, html: `REFUSE activate — not found. /graft list` };
    return {
      ok: true,
      cmd,
      html: [
        `<b>GRAFT activate</b> <code>${r.artifact.shortId}</code> ${esc(r.artifact.title)}`,
        `status ${r.artifact.status} · ON`,
        `think cost <code>${THINK_COST_ETH}</code> ETH · piggy <code>${r.ledger.piggyEth}</code>`,
        r.ledger.piggyEth >= THINK_COST_ETH || THINK_FREE
          ? (String(r.artifact.title).includes("RAIL")
            ? `next: <code>/graft rail</code> then <code>/graft inject RAIL</code>`
            : `next: <code>/graft think ${r.artifact.shortId}</code>`)
          : `next: <code>/graft fund ${THINK_COST_ETH}</code> then think|rail`,
      ].join("\n"),
      artifact: r.artifact,
    };
  }

  if (cmd === "sleep") {
    const r = setActive(arg || "last", false);
    if (!r.ok) return { ok: true, cmd, html: `REFUSE sleep — not found.` };
    return {
      ok: true,
      cmd,
      html: `<b>GRAFT sleep</b> <code>${r.artifact.shortId}</code> ${esc(r.artifact.title)} — filed, still stored, not thinking.`,
    };
  }

  if (cmd === "fund") {
    const eth = parseEth(arg);
    const r = fundPiggy(eth, extra.note || "telegram-fund");
    if (!r.ok) {
      return { ok: true, cmd, html: `REFUSE fund — amount like <code>/graft fund 0.001</code>` };
    }
    return {
      ok: true,
      cmd,
      html: [
        `<b>GRAFT fund</b> +<code>${r.credited}</code> ETH`,
        `piggy <code>${r.piggyEth}</code> ETH`,
        FUND_TO ? `on-chain send (you): <code>${esc(FUND_TO)}</code> — GRAFT only recorded the paper/credit; no invented tx` : `paper piggy (DRY) — no tx broadcast, none invented`,
        `next: <code>/graft think last</code> (idea must be ON)`,
      ].join("\n"),
    };
  }

  if (cmd === "think") {
    const result = think(arg || "last");
    return { ok: true, cmd, html: formatThinkCard(result), result };
  }

  if (cmd === "rail") {
    const result = runRailCycle(arg || "RAIL");
    return { ok: true, cmd, html: formatRailCard(result), result };
  }

  if (cmd === "inject") {
    const which = String(arg || "all").trim() || "all";
    const staged = [];
    const targets = [];
    if (which.toLowerCase() === "all") {
      for (const spec of MODELS) {
        const art = findArtifact(spec.match, ledger);
        if (art) targets.push({ spec, art });
      }
    } else {
      const spec = findModelSpec(which);
      const art = findArtifact(spec?.match || which, ledger);
      if (art) targets.push({ spec: spec || { id: art.shortId }, art });
    }
    if (!targets.length) {
      return { ok: true, cmd, html: "REFUSE inject — nothing to stage. /graft models" };
    }
    const railState = readRail();
    const mother = railState?.motherRoot || "";
    for (const t of targets) {
      const r = stageInject(t.art, {
        model: t.spec.id,
        motherRoot: t.spec.id === "RAIL" ? mother : "",
        note: "compact-old-way KEY+LOC",
      });
      if (r.ok) staged.push(r.packet);
    }
    const lines = [
      `<b>GRAFT inject</b> ${staged.length} compact packet(s) · ${INJECT_AVENUE}`,
      `old-way KEY+LOC spirit — not the raw dump. not broadcast.`,
    ];
    for (const p of staged) {
      lines.push(`<code>${p.shortId}</code> ${esc(p.model)} ${p.bytes}B loc=${shortId(p.lastRoot, 16)} tx=none`);
    }
    lines.push(`receipts: <code>/graft receipts</code> · log: <code>/graft dlog</code>`);
    return { ok: true, cmd, html: clip(lines.join("\n")), staged };
  }

  if (cmd === "survive" || cmd === "die" || cmd === "harvest") {
    const status = cmd === "survive" ? ARTIFACT_SURVIVED : cmd === "die" ? ARTIFACT_DIED : ARTIFACT_HARVEST;
    const r = markStatus(arg || "last", status);
    if (!r.ok) return { ok: true, cmd, html: `REFUSE ${cmd} — not found.` };
    const harvestNote = cmd === "harvest"
      ? `\nmark only — does <b>not</b> write VITA. Study last-root + log first.`
      : "";
    return {
      ok: true,
      cmd,
      html: `<b>GRAFT ${cmd}</b> <code>${r.artifact.shortId}</code> ${esc(r.artifact.title)} → ${status}${harvestNote}`,
    };
  }

  return { ok: true, cmd, html: formatHelp(ledger) };
}

function firstTitle(body) {
  const line = String(body).split(/\n/).map((l) => l.trim()).find((l) => l.length > 8) || "untitled prompt";
  return line.replace(/^#+\s*/, "").replace(/\*+/g, "").slice(0, 80);
}
