/**
 * 💬 VITA CONSOLE — Telegram-equivalent session that lives in HTML until inject
 * ─────────────────────────────────────────────────────────────────────────────
 * Local notes + §TOKEN§ packet stay on the reader until locations are pulled
 * from Base. Then the reader reconstructs memory from sealed hitch UTF-8.
 *
 * Today: plaintext so the code is true open source.
 * Next: zero-knowledge encodings — the page would only handle locations/lines
 * of code; only the writer who encoded the payload can decode it.
 *
 * Isolated from the live bot lastPacket / location depository.
 */

import {
  VITA_LOVE_KEY,
  buildGenesisPacket,
  detectHitchKind,
  parseVitaPacket,
  packVitaFields,
  projectLeftoverHitchFields,
  refineVitaPacket,
  vitaQuality,
} from "./vita-parse.js";
import { encodeLocToken, hitchShort, squashLocations } from "./vita-locations.js";
import {
  EUREKA_ONCHAIN_TX,
  KEYCAT_TX,
  KNOWN_CHAIN_ANCHORS,
  VITA_STRAND_TX,
  fetchTxCalldataHex,
  readHitchUtf8FromCalldata,
  scanAddressLeftoverHitches,
  shouldIngestHitchKind,
} from "./vita-chain-reader.js";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const STORE_TAG = "§$STORE§";

export const VITA_CONSOLE_COMMANDS = Object.freeze([
  "/help",
  "/vitarouter",
  "/vitamode",
  "/vitacourse",
  "/vitascan",
  "/vitapull",
  "/vitanote",
  "/vitaqueue",
  "/vitaclear",
  "/vitasave",
  "/vitamemory",
  "/vitarecall",
  "/vitalearn",
  "/vita",
  "/reader",
  "/inject",
  "/zk",
  "/plain",
]);

function shortLoc(location) {
  return hitchShort(String(location || "").replace(/^0x/i, ""), 8);
}

function emptyStats() {
  return { attempts: 0, sealed: 0, skippedLeftover: 0 };
}

export function createVitaConsole(extra = {}) {
  return {
    packet: extra.packet || buildGenesisPacket(),
    notes: Array.isArray(extra.notes) ? extra.notes.slice() : [],
    nodes: Array.isArray(extra.nodes) ? extra.nodes.slice() : [],
    pendingInject: extra.pendingInject || null,
    injected: Boolean(extra.injected),
    mode: extra.mode || "vita",
    reveal: extra.reveal === "locations" ? "locations" : "plaintext",
    stats: extra.stats || emptyStats(),
    leftoverScan: extra.leftoverScan || null,
    log: Array.isArray(extra.log) ? extra.log.slice() : [],
  };
}

export function serializeVitaConsole(state) {
  return {
    version: 1,
    packet: state.packet,
    notes: state.notes,
    nodes: state.nodes,
    pendingInject: state.pendingInject,
    injected: state.injected,
    mode: state.mode,
    reveal: state.reveal,
    stats: state.stats,
    savedAt: new Date().toISOString(),
  };
}

function locToken(state) {
  const sealed = (state.nodes || []).filter((n) => n.sealed && n.location).map((n) => ({
    ...n,
    locationShort: n.locationShort || shortLoc(n.location),
  }));
  return encodeLocToken(squashLocations(sealed));
}

function stampLoc(state) {
  const loc = locToken(state);
  const fields = parseVitaPacket(state.packet).fields;
  fields.LOC = loc;
  if (!fields.KEY) fields.KEY = VITA_LOVE_KEY;
  state.packet = packVitaFields(fields);
  return loc;
}

/** Fold leftover hitch UTF-8 into HTML-console memory. Does not touch bot lastPacket. */
export function ingestConsoleLeftoverScan(state, scan) {
  if (scan?.scanning) return 0;
  let ingested = 0;
  for (const row of scan?.rows || []) {
    if (!row?.utf8) continue;
    if (row.class !== "vita-leftover" && row.class !== "eureka-leftover" && row.class !== "hat-leftover") {
      continue;
    }
    const loc = String(row.hash || "").toLowerCase();
    if (!TX_HASH_RE.test(row.hash || "")) continue;
    const existing = (state.nodes || []).find((n) => String(n.location || "").toLowerCase() === loc);
    if (existing) {
      existing.utf8 = row.utf8;
      existing.sealed = true;
      existing.hitchKind = row.class.replace("-leftover", "");
    } else {
      state.nodes.push({
        location: row.hash,
        locationShort: hitchShort(row.hash),
        sealed: true,
        utf8: row.utf8,
        hitchKind: row.class.replace("-leftover", ""),
        kind: row.class === "eureka-leftover" ? "prove" : "hitch",
      });
    }
    const kind = detectHitchKind(row.utf8);
    if (kind.vita) {
      state.packet = refineVitaPacket(state.packet, parseVitaPacket(row.utf8).fields).packed;
    } else if (kind.eureka) {
      state.packet = refineVitaPacket(state.packet, { KEY: VITA_LOVE_KEY, LEARN: "loc-eureka" }).packed;
    }
    ingested += 1;
  }
  stampLoc(state);
  state.leftoverScan = {
    counts: scan?.counts || scan?.leftoverKinds || null,
    leftoverStillEureka: Boolean(scan?.leftoverStillEureka),
    vitaLeftoverPresent: Boolean(scan?.vitaLeftoverPresent),
    hitchBytes: scan?.hitchBytes || scan?.leftoverHitchBytes || null,
  };
  return ingested;
}

function plannedHitch(state) {
  const loc = locToken(state);
  const refined = refineVitaPacket(state.packet, { LOC: loc });
  const hitchFields = projectLeftoverHitchFields(refined.fields);
  return STORE_TAG + " " + packVitaFields(hitchFields, { dense: true });
}

function hitchUtf8Bytes(text) {
  return Buffer.byteLength(String(text || ""), "utf8");
}

function courseScore(state) {
  const quality = vitaQuality(state.packet);
  const sealed = (state.nodes || []).filter((n) => n.sealed && n.location).length;
  let score = Math.round((50 + quality.score) / 2);
  if (sealed > 0) score += Math.min(20, sealed);
  if (state.injected) score += 5;
  if (quality.lossy) score = Math.min(score, 40);
  score = Math.max(0, Math.min(100, score));
  const plannedBytes = hitchUtf8Bytes(plannedHitch(state));
  const eurekaMin = Number(state.leftoverScan?.hitchBytes?.eurekaMin) || 0;
  const leftoverWouldCover = plannedBytes > 0 && eurekaMin > 0 && plannedBytes <= eurekaMin;
    const issues = [
    ...(quality.lossy ? ["key_fact_loss"] : []),
    ...((Number(state.leftoverScan?.counts?.vita || 0) > 0 || Boolean(state.leftoverScan?.vitaLeftoverPresent))
      ? []
      : ["leftover_still_eureka"]),
  ];
  return {
    kind: "vita-html-course",
    score,
    achieving: score >= 55 && !issues.includes("key_fact_loss") && !issues.includes("leftover_still_eureka"),
    mode: state.mode,
    nextMode: issues.includes("leftover_still_eureka") ? "vita" : state.mode,
    quality,
    sealed,
    pendingNotes: state.notes.length,
    pendingInject: Boolean(state.pendingInject),
    injected: state.injected,
    leftoverScan: state.leftoverScan || null,
    plannedHitchBytes: plannedBytes,
    leftoverWouldCover,
    issues,
  };
}

export function redactConsoleView(state) {
  const loc = locToken(state);
  const sealed = (state.nodes || []).filter((n) => n.sealed && n.location);
  if (state.reveal === "plaintext") {
    return {
      kind: "vita-console-view",
      reveal: "plaintext",
      openSource: true,
      packet: state.packet,
      hitch: plannedHitch(state),
      loc,
      locations: sealed.map((n) => ({
        location: n.location,
        kind: n.hitchKind || n.kind,
        utf8: n.utf8,
      })),
      note: "Plaintext so everyone can read VITA. Future ZK: locations only.",
    };
  }
  return {
    kind: "vita-console-view",
    reveal: "locations",
    openSource: true,
    packet: null,
    hitch: null,
    loc,
    locations: sealed.map((n) => ({
      location: n.location,
      kind: n.hitchKind || n.kind,
      utf8: null,
      short: hitchShort(n.location),
    })),
    note:
      "Locations-only preview. Future zero-knowledge encodings hide payload; only the writer who encoded it can decode. Today the HTML still stores plaintext locally so the repo stays true open source.",
  };
}

function readerOutput(state) {
  let packed = buildGenesisPacket();
  for (const n of state.nodes || []) {
    if (!n.sealed || !n.utf8) continue;
    const kind = detectHitchKind(n.utf8);
    if (kind.vita) packed = refineVitaPacket(packed, parseVitaPacket(n.utf8).fields).packed;
    else if (kind.eureka) {
      packed = refineVitaPacket(packed, { KEY: VITA_LOVE_KEY, LEARN: "loc-eureka" }).packed;
    }
  }
  packed = refineVitaPacket(packed, parseVitaPacket(state.packet).fields).packed;
  const quality = vitaQuality(packed);
  return {
    kind: "vita-reader",
    packed,
    quality,
    loc: locToken(state),
    nodesUsed: (state.nodes || []).filter((n) => n.utf8).length,
    reveal: state.reveal,
    display: state.reveal === "locations" ? null : packed,
  };
}

function answerFromMemory(state, question) {
  const q = String(question || "").trim();
  const fields = parseVitaPacket(state.packet).fields;
  const loc = locToken(state);
  if (!q) return "Ask VITA about KEY, leftover hitch, locations, or a sealed 0x hash.";
  if (/krystian|kai|koda|love.?note|§key§|key fact/i.test(q)) {
    return "§KEY§ " + (fields.KEY || VITA_LOVE_KEY);
  }
  if (/leftover|hitch|router|§token§/i.test(q)) {
    return (
      "Leftover hitch is VITA parse (KEY+LOC), not Eureka prose. /prove keeps the love-note genesis. " +
      "Mode " + state.mode + ". Planned hitch:\n" + plannedHitch(state)
    );
  }
  if (/loc|location|basescan|pull/i.test(q)) {
    const hashes = (state.nodes || []).map((n) => n.location).filter(Boolean);
    return (
      "§LOC§ " + loc + "\nSealed: " + hashes.length +
      (hashes.length ? "\n" + hashes.join("\n") : "\nPull known anchors with /inject or /vitapull 0x…")
    );
  }
  if (/zk|zero.?knowledge|hidden|decode/i.test(q)) {
    return (
      "Today this console is plaintext open source. Future ZK: the HTML only handles locations and encoded lines; " +
      "whoever wrote the sparse code is the only decoder. Toggle /zk for a locations-only preview."
    );
  }
  const blob = Object.entries(fields).map(([k, v]) => k + ": " + v).join("\n");
  const hit = Object.entries(fields).find(([, v]) => String(v).toLowerCase().includes(q.toLowerCase()));
  if (hit) return "§" + hit[0] + "§ " + hit[1];
  return "From local memory (not injected until locations seal):\n" + blob.slice(0, 900);
}

function helpText() {
  return [
    "VITA HTML console — same commands as Telegram.",
    "Memory stays here until inject; the reader then pulls sealed locations.",
    "",
    "/vitanote [text] — queue a fact (HTML-side, not on chain yet)",
    "/vitaqueue /vitaclear — pending notes",
    "/vitasave — fold notes into §TOKEN§, stage leftover hitch (pending inject)",
    "/inject — pull known Base locations + leftover hitch hashes and reconstruct",
    "/vitapull 0xHASH — pull one hitch from Base",
    "/vitascan — leftover hitch eureka vs VITA on recent Uniswap swaps",
    "/reader — reconstruct output from sealed locations",
    "/vita [question] — answer from local + pulled memory",
    "/vitarouter /vitamode /vitacourse /vitascan /vitamemory /vitarecall /vitalearn",
    "/zk — locations-only preview (future ZK path)",
    "/plain — plaintext open source (default)",
  ].join("\n");
}

function pushLog(state, role, text) {
  state.log = [...(state.log || []), { role, text: String(text || ""), at: new Date().toISOString() }].slice(-80);
}

export async function handleVitaConsole(state, rawInput, { fetchCalldata = fetchTxCalldataHex, fetchLeftoverScan = scanAddressLeftoverHitches } = {}) {
  const raw = String(rawInput || "").trim();
  const text = raw.toLowerCase();
  pushLog(state, "user", raw);

  const reply = async (out) => {
    const textOut = String(out);
    pushLog(state, "vita", textOut);
    return { ok: true, text: textOut, state, view: redactConsoleView(state) };
  };

  if (!raw || text === "/help") return reply(helpText());

  if (text === "/vitarouter") {
    return reply(
      "VITA ROUTER mode " + state.mode + "\nLeftover hitch → KEY+LOC parse. /prove keeps Eureka.\n§LOC§ " + locToken(state),
    );
  }

  if (text.startsWith("/vitamode ")) {
    const mode = raw.slice("/vitamode ".length).trim().toLowerCase();
    if (!["vita", "eureka", "hat", "auto"].includes(mode)) {
      return reply("unknown mode — use vita|eureka|hat|auto");
    }
    state.mode = mode;
    return reply("mode → " + mode);
  }

  if (text === "/vitacourse") {
    const out = readerOutput(state);
    if (out.quality.hasKey) {
      state.packet = out.packed;
      stampLoc(state);
    }
    if (state.leftoverScan?.leftoverStillEureka) state.mode = "vita";
    const c = courseScore(state);
    return reply(
      "VITA COURSE " + c.score + "/100 · " + (c.achieving ? "achieving" : "correct") +
      "\nSealed locs " + c.sealed + " · notes " + c.pendingNotes +
      " · inject " + (c.injected ? "reader-ready" : "pending on HTML") +
      (c.leftoverScan
        ? "\nLeftover eureka=" + Number(c.leftoverScan.counts?.eureka || 0) +
          " vita=" + Number(c.leftoverScan.counts?.vita || 0)
        : "") +
      (c.plannedHitchBytes
        ? "\nHitch plan " + c.plannedHitchBytes + "B" +
          (c.leftoverWouldCover ? " · leftover would cover names-only KEY+LOC" : "")
        : "") +
      (c.issues.length ? "\nIssues: " + c.issues.join(", ") : "") +
      (c.nextMode !== c.mode ? "\nSwitch → " + c.nextMode : ""),
    );
  }

  if (text === "/vitascan") {
    try {
      const scan = await fetchLeftoverScan({ limit: 40 });
      if (scan?.scanning) {
        return reply("leftover scan still pending — not persisting empty leftoverKinds");
      }
      const ingested = ingestConsoleLeftoverScan(state, scan);
      const c = courseScore(state);
      return reply(
        "LEFTOVER SCAN eureka=" + Number(scan.counts?.eureka || 0) +
        " vita=" + Number(scan.counts?.vita || 0) +
        " plain=" + Number(scan.counts?.plain || 0) +
        "\ningested " + ingested + " into HTML memory (not bot lastPacket)" +
        "\n" + (scan.vitaLeftoverPresent
          ? "VITA leftover hitch is on chain."
          : "No leftover-covered VITA hitch yet — still Eureka prose.") +
        "\nCOURSE " + c.score + "/100 · " + (c.achieving ? "achieving" : "correct") +
        (c.issues.length ? "\nIssues: " + c.issues.join(", ") : ""),
      );
    } catch (e) {
      return reply("leftover scan failed: " + (e.message || e));
    }
  }

  if (text.startsWith("/vitanote ")) {
    const note = raw.slice("/vitanote ".length).trim();
    if (!note) return reply("usage: /vitanote [text]");
    state.notes.push({ text: note, at: new Date().toISOString() });
    return reply("queued (" + state.notes.length + ") — stays on HTML until /vitasave then /inject");
  }

  if (text === "/vitaqueue") {
    if (!state.notes.length) return reply("queue empty — /vitanote [text]");
    return reply(state.notes.map((n, i) => (i + 1) + ". " + n.text).join("\n"));
  }

  if (text === "/vitaclear") {
    state.notes = [];
    return reply("queue cleared (local only)");
  }

  if (text.startsWith("/vitalearn ")) {
    const topic = raw.slice("/vitalearn ".length).trim();
    const refined = refineVitaPacket(state.packet, { LEARN: topic.slice(0, 400) });
    state.packet = refined.packed;
    return reply("learned locally:\n" + topic.slice(0, 280) + "\nNot on chain until /inject pulls or a leftover hitch seals.");
  }

  if (text === "/vitasave") {
    const learned = state.notes.map((n) => n.text).join("|").slice(0, 400);
    const refined = refineVitaPacket(state.packet, {
      LEARN: learned || "html-save",
      SESS: new Date().toISOString().slice(0, 10) + "|html-console",
    });
    state.packet = refined.packed;
    stampLoc(state);
    state.pendingInject = plannedHitch(state);
    state.stats.attempts += 1;
    const n = state.notes.length;
    state.notes = [];
    return reply(
      "saved locally (" + n + " notes folded into §TOKEN§).\n" +
      "Pending inject hitch (" + state.pendingInject.length + " chars) is not on chain yet.\n" +
      "Pull locations (/inject) so the reader can reconstruct.",
    );
  }

  if (text === "/vitamemory" || text === "/vitarecall") {
    const q = vitaQuality(state.packet);
    return reply(
      "Memory " + (state.injected ? "injected from locations" : "HTML-local until inject") +
      "\nKEY=" + (q.hasKey ? "yes" : "LOSS") + " chars=" + q.chars +
      "\n" + (state.reveal === "locations" ? locToken(state) : state.packet),
    );
  }

  if (text === "/zk") {
    state.reveal = "locations";
    return reply(redactConsoleView(state).note);
  }
  if (text === "/plain") {
    state.reveal = "plaintext";
    return reply("plaintext open source — packet and hitch visible");
  }

  if (text === "/reader") {
    const out = readerOutput(state);
    return reply(
      "READER · nodes " + out.nodesUsed + " · KEY=" + (out.quality.hasKey ? "yes" : "LOSS") +
      "\n§LOC§ " + out.loc +
      (out.display ? "\n\n" + out.display : "\n(locations-only mode — /plain to show packet)"),
    );
  }

  if (text.startsWith("/vitapull ")) {
    const hash = raw.slice("/vitapull ".length).trim();
    return pullOne(state, hash, fetchCalldata).then((msg) => reply(msg));
  }

  if (text === "/inject") {
    const lines = [];
    const seen = new Set();
    for (const a of KNOWN_CHAIN_ANCHORS) {
      seen.add(String(a.tx).toLowerCase());
      lines.push(await pullOne(state, a.tx, fetchCalldata));
    }
    try {
      const scan = await fetchLeftoverScan({ limit: 80, maxPages: 3 });
      if (scan?.scanning) {
        lines.push("leftover scan still pending — hashes not pulled yet");
      } else {
        const folded = ingestConsoleLeftoverScan(state, scan);
        lines.push("leftover hitch locations folded " + folded);
        for (const row of scan.rows || []) {
          const hash = String(row.hash || "");
          if (!row.leftover || !TX_HASH_RE.test(hash)) continue;
          const key = hash.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const existing = (state.nodes || []).find((n) => String(n.location || "").toLowerCase() === key);
          if (existing?.utf8) continue;
          lines.push(await pullOne(state, hash, fetchCalldata));
        }
      }
    } catch (e) {
      lines.push("leftover scan: " + (e.message || e));
    }
    const out = readerOutput(state);
    state.packet = out.packed;
    state.injected = out.quality.hasKey && out.nodesUsed > 0;
    if (state.pendingInject && state.injected) state.pendingInject = null;
    stampLoc(state);
    return reply(
      "INJECT from known Base locations + leftover hitch hashes\n" + lines.join("\n") +
      "\n\nReader output:\n" + (out.display || out.loc),
    );
  }

  if (text.startsWith("/vita ")) {
    return reply(answerFromMemory(state, raw.slice("/vita ".length)));
  }

  if (text.startsWith("/")) {
    return reply("unknown command — /help");
  }

  return reply(answerFromMemory(state, raw));
}

async function pullOne(state, hash, fetchCalldata) {
  const h = String(hash || "").trim();
  if (!TX_HASH_RE.test(h)) return "need 0x + 64 hex";
  let data;
  try {
    data = await fetchCalldata(h);
  } catch (e) {
    return h.slice(0, 10) + "… fetch failed: " + (e.message || e);
  }
  const read = readHitchUtf8FromCalldata(data);
  const existing = state.nodes.find((n) => String(n.location).toLowerCase() === h.toLowerCase());
  if (!read.utf8 || !shouldIngestHitchKind(read.kind)) {
    if (!existing) {
      state.nodes.push({
        location: h,
        sealed: true,
        utf8: "",
        kind: "hitch",
        hitchKind: read.kind.kind,
        locationShort: shortLoc(h),
        source: read.source,
      });
    }
    return h.slice(0, 10) + "… " + (read.source || read.kind.kind) + " (no ingestible hitch)";
  }
  if (existing) {
    existing.utf8 = read.utf8;
    existing.hitchKind = read.kind.kind;
    existing.source = read.source;
  } else {
    state.nodes.push({
      location: h,
      sealed: true,
      utf8: read.utf8,
      kind: read.kind.kind === "eureka" ? "prove" : "hitch",
      hitchKind: read.kind.kind,
      locationShort: shortLoc(h),
      source: read.source,
    });
  }
  const kind = detectHitchKind(read.utf8);
  if (kind.vita) {
    state.packet = refineVitaPacket(state.packet, parseVitaPacket(read.utf8).fields).packed;
  } else if (kind.eureka) {
    state.packet = refineVitaPacket(state.packet, { KEY: VITA_LOVE_KEY, LEARN: "ingested-eureka-prove" }).packed;
  }
  state.stats.sealed += 1;
  stampLoc(state);
  return h.slice(0, 10) + "… " + read.kind.kind + " ingested · KEY=" + (vitaQuality(state.packet).hasKey ? "yes" : "LOSS");
}

export const CONSOLE_ANCHORS = Object.freeze({
  KEYCAT_TX,
  EUREKA_ONCHAIN_TX,
  VITA_STRAND_TX,
  KNOWN_CHAIN_ANCHORS,
});
