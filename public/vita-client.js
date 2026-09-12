/**
 * Browser VITA console — Telegram-equivalent chat.
 * Loads /vita/lib/vita-parse.js (same parser as the bot).
 * Pulls hitch UTF-8 from public Base RPC. Memory stays in localStorage
 * until /inject reconstructs from sealed locations.
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
} from "/vita/lib/vita-parse.js";
import {
  extractMemoryRecords,
  formatXmemMatches,
  retrieveXmem,
  xmemHelpText,
} from "/vita/lib/xmem.js";

/** Prefer infected HTML mainframe anchors when present; else hardcoded genesis. */
function readInfectedMainframe() {
  try {
    if (typeof document === "undefined") return null;
    const el = document.getElementById("vita-mainframe");
    return el ? JSON.parse(el.textContent) : null;
  } catch {
    return null;
  }
}

const FALLBACK_KEYCAT_TX = "0x5c0a93e4707a4dcf49afd4c785cb2829bce11ed026e08ba08435272d19122adf";
const FALLBACK_EUREKA_TX = "0xd9827a9c70c78be7e165934b101b8774c10fdfe8d9720bafd293fff4e5203d73";
const FALLBACK_VITA_TX = "0x931d84115692190a393b3a040debc5145bf8f05c8ad359ba61b861f6dbfb19db";

const infected = readInfectedMainframe();
export const KEYCAT_TX = infected?.anchors?.keycatPlainTx || FALLBACK_KEYCAT_TX;
export const EUREKA_ONCHAIN_TX = infected?.anchors?.eurekaProveTx || FALLBACK_EUREKA_TX;
export const VITA_STRAND_TX = infected?.anchors?.vitaStrandTx || FALLBACK_VITA_TX;
export const MAINFRAME = infected;
export const ANCHORS = Object.freeze(
  (infected?.anchors?.known || [
    { tx: KEYCAT_TX, expect: "none", note: "KEYCAT plain swap — no hitch" },
    { tx: EUREKA_ONCHAIN_TX, expect: "eureka", note: "Eureka love note on Base" },
    { tx: VITA_STRAND_TX, expect: "vita", note: "VITA §TOKEN§ strand on Base" },
  ]).map((a) => ({
    tx: a.tx,
    expect: a.expect || a.kind || "vita",
    note: a.note || a.label || a.id || "",
  })),
);

const STORE_TAG = "§$STORE§";
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const LS_KEY = "vita-html-console-v1";
const SELECTOR = "04e45aaf";
const PREFIX_BYTES = 228;

function hitchShort(s, n = 4) {
  const hex = String(s || "").replace(/^0x/i, "").toLowerCase();
  return (hex || "0".repeat(n)).slice(0, n);
}

function locToken(nodes) {
  const sealed = (nodes || []).filter((n) => n.sealed && n.location);
  if (!sealed.length) return "n=0|t=0000";
  return [
    "n=" + sealed.length,
    "t=" + hitchShort(sealed[sealed.length - 1].location),
    "r=" + hitchShort(sealed[0].location),
  ].join("|");
}

function stampPacketLoc(state) {
  const loc = locToken(state.nodes);
  const fields = parseVitaPacket(state.packet).fields;
  fields.LOC = loc;
  if (!fields.KEY) fields.KEY = VITA_LOVE_KEY;
  state.packet = packVitaFields(fields);
  return loc;
}

export function createState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.packet) return { log: [], ...saved, log: saved.log || [] };
    }
  } catch { /* start fresh */ }
  return {
    packet: buildGenesisPacket(),
    notes: [],
    nodes: [],
    pendingInject: null,
    injected: false,
    leftoverScan: null,
    mode: "vita",
    reveal: "plaintext",
    log: [],
  };
}

export function persist(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      packet: state.packet,
      notes: state.notes,
      nodes: state.nodes,
      pendingInject: state.pendingInject,
      injected: state.injected,
      leftoverScan: state.leftoverScan || null,
      mode: state.mode,
      reveal: state.reveal,
      log: (state.log || []).slice(-40),
    }));
  } catch { /* quota */ }
}

function plannedHitch(state) {
  const refined = refineVitaPacket(state.packet, { LOC: locToken(state.nodes) });
  return STORE_TAG + " " + packVitaFields(projectLeftoverHitchFields(refined.fields), { dense: true });
}

function hexToUtf8(hex) {
  const h = String(hex || "").replace(/^0x/i, "");
  if (!h || h.length % 2) return "";
  try {
    const bytes = new Uint8Array(h.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function extractHitch(text) {
  const s = String(text || "");
  const store = s.indexOf("§$STORE§");
  if (store >= 0) return s.slice(store);
  const token = s.search(/§(SESS|WHO|STACK|BUILT|PROVED|ARCH|VISION|NEXT|KEY|LEARN|LOC|HAT)§/);
  if (token >= 0) return s.slice(token);
  const eureka = s.search(/Eureka!/i);
  if (eureka >= 0) return s.slice(eureka);
  return "";
}

export function readHitchFromHex(data) {
  const raw = String(data || "");
  if (!raw || raw === "0x") return { utf8: "", kind: detectHitchKind(""), source: "empty" };
  const hex = raw.toLowerCase();
  if (/^0x[0-9a-f]+$/.test(hex) && hex.length >= 10) {
    const body = hex.slice(2);
    if (body.startsWith(SELECTOR) && body.length > PREFIX_BYTES * 2) {
      const trail = hexToUtf8(body.slice(PREFIX_BYTES * 2));
      if (trail) return { utf8: trail, kind: detectHitchKind(trail), source: "v3-trailer" };
    }
    const voice = extractHitch(hexToUtf8(body));
    if (voice) return { utf8: voice, kind: detectHitchKind(voice), source: "store-voice" };
    return { utf8: "", kind: detectHitchKind(""), source: "no-hitch" };
  }
  const embedded = extractHitch(raw);
  return embedded
    ? { utf8: embedded, kind: detectHitchKind(embedded), source: "utf8" }
    : { utf8: "", kind: detectHitchKind(""), source: "no-hitch" };
}

export async function fetchTxHex(hash) {
  const res = await fetch("https://mainnet.base.org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionByHash",
      params: [hash],
    }),
  });
  const data = await res.json();
  const hex = data?.result?.input;
  if (!hex || hex === "0x") throw new Error("no calldata");
  return hex;
}

function ingestUtf8(state, hash, utf8, kind, source) {
  const ingestible = ["vita", "eureka", "hat", "tag"].includes(kind);
  const existing = state.nodes.find((n) => String(n.location).toLowerCase() === hash.toLowerCase());
  if (!utf8 || !ingestible) {
    if (!existing) {
      state.nodes.push({ location: hash, sealed: true, utf8: "", hitchKind: kind, source });
    }
    return hash.slice(0, 10) + "… " + (source || kind) + " (no ingestible hitch)";
  }
  if (existing) {
    existing.utf8 = utf8;
    existing.hitchKind = kind;
  } else {
    state.nodes.push({
      location: hash,
      sealed: true,
      utf8,
      hitchKind: kind,
      kind: kind === "eureka" ? "prove" : "hitch",
    });
  }
  const det = detectHitchKind(utf8);
  if (det.vita) state.packet = refineVitaPacket(state.packet, parseVitaPacket(utf8).fields).packed;
  else if (det.eureka) {
    state.packet = refineVitaPacket(state.packet, { KEY: VITA_LOVE_KEY, LEARN: "ingested-eureka-prove" }).packed;
  }
  const loc = locToken(state.nodes);
  const fields = parseVitaPacket(state.packet).fields;
  fields.LOC = loc;
  if (!fields.KEY) fields.KEY = VITA_LOVE_KEY;
  state.packet = packVitaFields(fields);
  return hash.slice(0, 10) + "… " + kind + " ingested · KEY=" + (vitaQuality(state.packet).hasKey ? "yes" : "LOSS");
}

function readerPacked(state) {
  let packed = buildGenesisPacket();
  for (const n of state.nodes) {
    if (!n.utf8) continue;
    const kind = detectHitchKind(n.utf8);
    if (kind.vita) packed = refineVitaPacket(packed, parseVitaPacket(n.utf8).fields).packed;
    else if (kind.eureka) packed = refineVitaPacket(packed, { KEY: VITA_LOVE_KEY, LEARN: "loc-eureka" }).packed;
  }
  return refineVitaPacket(packed, parseVitaPacket(state.packet).fields).packed;
}

function helpText() {
  return [
    "VITA HTML console — Telegram commands, local memory until inject.",
    "/vitanote [text]  queue a fact (stays on this page)",
    "/vitasave         fold notes into §TOKEN§ — still not on chain",
    "/inject           pull known Base locations + leftover hitch hashes → reader reconstructs",
    "/vitapull 0xHASH  pull one hitch from Base",
    "/vitascan         leftover hitch eureka vs VITA (reader pulls locations)",
    "/xmem [query]     search pulled hitch UTF-8 (XMEM / STORE KEY / tags)",
    "/reader           show reconstructed packet from locations",
    "/vita [question]  answer from KEY / LOC / LEARN",
    "/zk  locations-only preview (future ZK path)",
    "/plain  plaintext open source (default)",
  ].join("\n");
}

function answer(state, q) {
  const fields = parseVitaPacket(state.packet).fields;
  if (/krystian|kai|koda|love/i.test(q)) return "§KEY§ " + (fields.KEY || VITA_LOVE_KEY);
  if (/hitch|leftover|router/i.test(q)) {
    return "Leftover hitch is KEY+LOC VITA parse, not Eureka. /prove keeps the love note.\n" + plannedHitch(state);
  }
  if (/loc|location|pull/i.test(q)) {
    return "§LOC§ " + locToken(state.nodes) + "\n" + state.nodes.map((n) => n.location).join("\n");
  }
  if (/zk|zero/i.test(q)) {
    return "Today: plaintext open source. Future ZK: this page would only handle locations; only the encoder decodes. /zk previews that.";
  }
  const hit = Object.entries(fields).find(([, v]) => String(v).toLowerCase().includes(q.toLowerCase()));
  if (hit) return "§" + hit[0] + "§ " + hit[1];
  return Object.entries(fields).map(([k, v]) => k + ": " + v).join("\n").slice(0, 800);
}

function leftoverScanIncomplete(scan) {
  if (!scan) return true;
  if (scan.scanning === true) return true;
  if (scan.counts == null && scan.leftoverKinds == null) return true;
  const eureka = Number(scan.counts?.eureka || scan.leftoverKinds?.eureka || 0);
  const vita = Number(scan.counts?.vita || scan.leftoverKinds?.vita || 0);
  const eurekaMin = Number((scan.hitchBytes || scan.leftoverHitchBytes)?.eurekaMin || 0);
  return Boolean(scan.leftoverStillEureka) && eureka === 0 && vita === 0 && eurekaMin === 0;
}

function snapshotLeftoverScan(scan) {
  if (leftoverScanIncomplete(scan)) return null;
  return {
    counts: scan.counts || scan.leftoverKinds,
    leftoverStillEureka: Boolean(scan.leftoverStillEureka),
    vitaLeftoverPresent: Boolean(scan.vitaLeftoverPresent),
    hitchBytes: scan.hitchBytes || scan.leftoverHitchBytes || null,
  };
}

async function fetchLeftoverScanJson() {
  const maxAttempts = 12;
  let scan = null;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch("/vita/leftover");
    scan = await res.json();
    if (scan?.error && !scan.ok && scan.scanning !== true) {
      throw new Error(scan.error || "scan failed");
    }
    if (!leftoverScanIncomplete(scan)) return scan;
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return scan;
}

export async function handleCommand(state, raw) {
  const input = String(raw || "").trim();
  const low = input.toLowerCase();
  const say = (text) => {
    state.log.push({ role: "user", text: input });
    state.log.push({ role: "vita", text });
    persist(state);
    return text;
  };

  if (!input || low === "/help") return say(helpText());
  if (low === "/vitarouter") {
    return say("mode " + state.mode + " · leftover KEY+LOC\n§LOC§ " + locToken(state.nodes));
  }
  if (low.startsWith("/vitamode ")) {
    const mode = input.slice(10).trim().toLowerCase();
    if (!["vita", "eureka", "hat", "auto"].includes(mode)) return say("use vita|eureka|hat|auto");
    state.mode = mode;
    return say("mode → " + mode);
  }
  if (low === "/vitacourse") {
    if (leftoverScanIncomplete(state.leftoverScan)) {
      try {
        const scan = await fetchLeftoverScanJson();
        const snap = snapshotLeftoverScan(scan);
        if (snap) {
          state.leftoverScan = snap;
          persist(state);
        }
      } catch { /* course still scores KEY/loc without chain scan */ }
    }
    if (state.leftoverScan?.leftoverStillEureka) state.mode = "vita";
    const packed = readerPacked(state);
    if (vitaQuality(packed).hasKey) {
      state.packet = packed;
      stampPacketLoc(state);
    }
    const q = vitaQuality(state.packet);
    const sealed = state.nodes.filter((n) => n.utf8).length;
    const score = Math.min(100, Math.round((50 + q.score) / 2) + Math.min(20, sealed));
    const issues = [];
    if (q.lossy) issues.push("key_fact_loss");
    const vitaLeftover = Number(state.leftoverScan?.counts?.vita || 0) > 0
      || Boolean(state.leftoverScan?.vitaLeftoverPresent);
    if (!vitaLeftover) issues.push("leftover_still_eureka");
    const hitchPlan = plannedHitch(state);
    const plannedBytes = new TextEncoder().encode(hitchPlan).length;
    const eurekaMin = Number(state.leftoverScan?.hitchBytes?.eurekaMin) || 0;
    const leftoverWouldCover = plannedBytes > 0 && eurekaMin > 0 && plannedBytes <= eurekaMin;
    persist(state);
    return say(
      "COURSE " + score + "/100 · " + (issues.length ? "correct" : "achieving") +
      "\nSealed " + sealed + " · notes " + state.notes.length +
      " · " + (state.injected ? "reader-ready" : "HTML-local until inject") +
      (state.leftoverScan
        ? "\nLeftover eureka=" + Number(state.leftoverScan.counts?.eureka || 0) +
          " vita=" + Number(state.leftoverScan.counts?.vita || 0) +
          (state.leftoverScan.hitchBytes?.eurekaMin
            ? " · Eureka min " + state.leftoverScan.hitchBytes.eurekaMin + "B"
            : "")
        : "") +
      (plannedBytes ? "\nHitch plan " + plannedBytes + "B" : "") +
      (leftoverWouldCover ? " · leftover would cover names-only KEY+LOC" : "") +
      (issues.length ? "\nIssues: " + issues.join(", ") : ""),
    );
  }
  if (low === "/vitascan") {
    try {
      const scan = await fetchLeftoverScanJson();
      if (leftoverScanIncomplete(scan)) {
        return say("leftover scan still pending — hashes not pulled yet. Try /vitascan again shortly.");
      }
      const lines = [];
      for (const row of scan.rows || []) {
        if (!TX_RE.test(row.hash) || !row.leftover) continue;
        try {
          const hex = await fetchTxHex(row.hash);
          const read = readHitchFromHex(hex);
          lines.push(ingestUtf8(state, row.hash, read.utf8, read.kind.kind, read.source));
        } catch (e) {
          lines.push(row.hash.slice(0, 10) + "… " + (e.message || e));
        }
      }
      const snap = snapshotLeftoverScan(scan);
      if (snap) {
        state.leftoverScan = snap;
        persist(state);
      }
      return say(
        "LEFTOVER SCAN eureka=" + Number(scan.counts?.eureka || 0) +
        " vita=" + Number(scan.counts?.vita || 0) +
        " plain=" + Number(scan.counts?.plain || 0) +
        "\n" + (scan.vitaLeftoverPresent
          ? "VITA leftover hitch is on chain."
          : "No leftover-covered VITA hitch yet — still Eureka prose.") +
        (lines.length ? "\n" + lines.join("\n") : ""),
      );
    } catch (e) {
      return say("leftover scan failed: " + (e.message || e));
    }
  }
  if (low === "/xmem" || low.startsWith("/xmem ")) {
    const arg = input.slice("/xmem".length).trim();
    if (!arg || /^help$/i.test(arg)) return say(xmemHelpText());
    if (/^decode\s+/i.test(arg)) {
      return say(formatXmemMatches(retrieveXmem(extractMemoryRecords(arg.replace(/^decode\s+/i, "")), "")));
    }
    const payloads = [
      ...(state.nodes || []).map((n) => n.utf8),
      state.packet,
    ].filter(Boolean);
    const records = payloads.flatMap((p) => extractMemoryRecords(p));
    return say(formatXmemMatches(retrieveXmem(records, arg)));
  }
  if (low.startsWith("/vitanote ")) {
    const note = input.slice(10).trim();
    state.notes.push({ text: note, at: new Date().toISOString() });
    return say("queued (" + state.notes.length + ") — HTML-side until /vitasave + /inject");
  }
  if (low === "/vitaqueue") {
    return say(state.notes.length ? state.notes.map((n, i) => (i + 1) + ". " + n.text).join("\n") : "queue empty");
  }
  if (low === "/vitaclear") {
    state.notes = [];
    return say("queue cleared");
  }
  if (low.startsWith("/vitalearn ")) {
    const topic = input.slice(11).trim();
    state.packet = refineVitaPacket(state.packet, { LEARN: topic.slice(0, 400) }).packed;
    return say("learned locally (not on chain yet):\n" + topic.slice(0, 280));
  }
  if (low === "/vitasave") {
    const learned = state.notes.map((n) => n.text).join("|").slice(0, 400);
    state.packet = refineVitaPacket(state.packet, {
      LEARN: learned || "html-save",
      SESS: new Date().toISOString().slice(0, 10) + "|html-console",
      LOC: locToken(state.nodes),
    }).packed;
    state.pendingInject = plannedHitch(state);
    const n = state.notes.length;
    state.notes = [];
    return say("saved locally (" + n + " notes). Hitch staged, not mined. /inject to reconstruct from Base locations.");
  }
  if (low === "/vitamemory" || low === "/vitarecall") {
    const q = vitaQuality(state.packet);
    return say(
      (state.injected ? "injected from locations" : "HTML-local") +
      " KEY=" + (q.hasKey ? "yes" : "LOSS") +
      "\n" + (state.reveal === "locations" ? locToken(state.nodes) : state.packet),
    );
  }
  if (low === "/zk") {
    state.reveal = "locations";
    return say("locations-only preview. Future ZK hides payload; today plaintext is still stored locally (open source).");
  }
  if (low === "/plain") {
    state.reveal = "plaintext";
    return say("plaintext open source — packet visible");
  }
  if (low === "/reader") {
    const packed = readerPacked(state);
    const q = vitaQuality(packed);
    return say(
      "READER nodes " + state.nodes.filter((n) => n.utf8).length + " KEY=" + (q.hasKey ? "yes" : "LOSS") +
      "\n§LOC§ " + locToken(state.nodes) +
      (state.reveal === "locations" ? "" : "\n\n" + packed),
    );
  }
  if (low.startsWith("/vitapull ")) {
    const hash = input.slice(10).trim();
    if (!TX_RE.test(hash)) return say("need 0x + 64 hex");
    try {
      const hex = await fetchTxHex(hash);
      const read = readHitchFromHex(hex);
      return say(ingestUtf8(state, hash, read.utf8, read.kind.kind, read.source));
    } catch (e) {
      return say("pull failed: " + (e.message || e));
    }
  }
  if (low === "/inject") {
    const lines = [];
    const seen = new Set();
    for (const a of ANCHORS) {
      seen.add(a.tx.toLowerCase());
      try {
        const hex = await fetchTxHex(a.tx);
        const read = readHitchFromHex(hex);
        lines.push(ingestUtf8(state, a.tx, read.utf8, read.kind.kind, read.source));
      } catch (e) {
        lines.push(a.tx.slice(0, 10) + "… " + (e.message || e));
      }
    }
    try {
      const scan = await fetchLeftoverScanJson();
      if (leftoverScanIncomplete(scan)) {
        lines.push("leftover scan still pending — hashes not pulled yet");
      } else {
        const snap = snapshotLeftoverScan(scan);
        if (snap) state.leftoverScan = snap;
        for (const row of scan.rows || []) {
          if (!TX_RE.test(row.hash) || !row.leftover) continue;
          const key = row.hash.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            const hex = await fetchTxHex(row.hash);
            const read = readHitchFromHex(hex);
            lines.push(ingestUtf8(state, row.hash, read.utf8, read.kind.kind, read.source));
          } catch (e) {
            lines.push(row.hash.slice(0, 10) + "… " + (e.message || e));
          }
        }
      }
    } catch (e) {
      lines.push("leftover scan: " + (e.message || e));
    }
    const packed = readerPacked(state);
    state.packet = packed;
    state.injected = vitaQuality(packed).hasKey && state.nodes.some((n) => n.utf8);
    if (state.injected) state.pendingInject = null;
    persist(state);
    return say("INJECT\n" + lines.join("\n") + "\n\n" + (state.reveal === "locations" ? locToken(state.nodes) : packed));
  }
  if (low.startsWith("/vita ")) return say(answer(state, input.slice(6)));
  if (low.startsWith("/")) return say("unknown — /help");
  return say(answer(state, input));
}

export function snapshot(state) {
  const q = vitaQuality(state.packet);
  const sealed = state.nodes.filter((n) => n.location);
  return {
    mode: state.mode,
    reveal: state.reveal,
    injected: state.injected,
    pending: Boolean(state.pendingInject) || state.notes.length > 0,
    notes: state.notes.length,
    sealed: sealed.length,
    loc: locToken(state.nodes),
    leftoverScan: state.leftoverScan || null,
    quality: q,
    hitch: state.reveal === "plaintext" ? plannedHitch(state) : null,
    packet: state.reveal === "plaintext" ? state.packet : null,
    locations: sealed.map((n) => ({
      location: n.location,
      kind: n.hitchKind || n.kind,
      utf8: state.reveal === "plaintext" ? (n.utf8 || "") : null,
      short: hitchShort(n.location),
    })),
    log: state.log || [],
    anchors: ANCHORS,
    loveKey: state.reveal === "plaintext" ? VITA_LOVE_KEY : null,
  };
}
