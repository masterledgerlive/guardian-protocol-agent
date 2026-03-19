// ═══════════════════════════════════════════════════════════════════════════════
// 🧠 IKN MEMORY ENGINE — Blockchain-anchored agent memory
// ───────────────────────────────────────────────────────────────────────────────
// Two-layer memory system inscribed permanently on Base blockchain:
//
// LAYER 1 — CLIFF NOTE (fires live during conversation)
//   ~200 chars | key facts only | rides next BTP trade slot
//   Format: [MEM:CN:SEQ:DATE] WHO|BUILT|DECIDED|PROVED|NEXT
//
// LAYER 2 — FULL SUMMARY (fires when conversation closes)
//   ~800 chars | complete semantic record | queued as BTP transmission
//   Format: [MEM:FS:SEQ:DATE] full structured record
//
// RETRIEVAL
//   Recent 3 cliff notes → auto-injected at conversation start
//   Full summaries → pulled on demand by date or topic keyword
//   All memories → indexed in memory-registry.json on GitHub
//
// STRAND LINKING
//   Each chunk references hash of previous chunk
//   Forms provable chain — flip book of agent memory
//   Any chunk can be verified against the chain
// ═══════════════════════════════════════════════════════════════════════════════

import { createHash } from "crypto";

// ── Memory registry — in-memory index of all inscribed memories ───────────────
// { seq: { type, date, txHash, preview, topic, prevHash } }
let memoryRegistry = [];
let memorySeq      = 0;
let lastMemHash    = "0000"; // hash chain anchor

export function getMemoryRegistry()  { return memoryRegistry; }
export function setMemoryRegistry(r) { memoryRegistry = r; memorySeq = r.length; }
export function getLastMemHash()     { return lastMemHash; }
export function setLastMemHash(h)    { lastMemHash = h; }

// ── Hash linking ──────────────────────────────────────────────────────────────
function memHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

// ── Calldata encoding ─────────────────────────────────────────────────────────
function encodeHex(text) {
  return "0x" + Buffer.from(text, "utf8").toString("hex");
}

// ── Compress text to fit target size ─────────────────────────────────────────
// Removes vowels from less critical words, abbreviates common terms
// Preserves proper nouns, code names, numbers fully
function compress(text, maxLen) {
  if (text.length <= maxLen) return text;

  // Abbreviation map for common agentic/crypto terms
  const abbrevs = {
    "blockchain":   "chain",
    "transaction":  "tx",
    "encrypted":    "enc",
    "decrypted":    "dec",
    "inscription":  "inscr",
    "conversation": "conv",
    "implemented":  "impl",
    "architecture": "arch",
    "autonomous":   "auto",
    "deployment":   "deploy",
    "permanently":  "perm",
    "password":     "pw",
    "retrieval":    "retr",
    "compression":  "compress",
    "established":  "estab",
    "protocol":     "proto",
    "validated":    "valid",
    "configured":   "config",
    "successfully": "ok",
    "working":      "✅",
    "failed":       "❌",
    "building":     "→",
    "TELEGRAM_BOT_TOKEN": "TG_TOKEN",
    "DECRYPT_PASSWORD":   "DEC_PW",
    "GITHUB_TOKEN":       "GH_TOKEN",
    "GITHUB_REPO":        "GH_REPO",
  };

  let result = text;
  for (const [full, short] of Object.entries(abbrevs)) {
    result = result.replace(new RegExp(full, "gi"), short);
  }

  // If still too long, truncate with ellipsis
  if (result.length > maxLen) {
    result = result.slice(0, maxLen - 3) + "...";
  }
  return result;
}

// ── Build a CLIFF NOTE chunk ──────────────────────────────────────────────────
// 200 char target. Key facts only.
// Input: { who, built, decided, proved, next, topic }
export function buildCliffNote(data) {
  const seq     = ++memorySeq;
  const date    = new Date().toISOString().slice(0, 10);
  const header  = `[MEM:CN:${String(seq).padStart(4,"0")}:${date}:${lastMemHash}]`;

  // Build content fields — compress each to fit
  const parts = [];
  if (data.who)     parts.push("WHO:" + compress(data.who, 30));
  if (data.built)   parts.push("BUILT:" + compress(data.built, 60));
  if (data.decided) parts.push("DECIDED:" + compress(data.decided, 40));
  if (data.proved)  parts.push("PROVED:" + compress(data.proved, 40));
  if (data.next)    parts.push("NEXT:" + compress(data.next, 30));

  const content  = parts.join("|");
  const full     = header + content;
  const trimmed  = full.length > 220 ? full.slice(0, 217) + "..." : full;

  // Update hash chain
  const thisHash = memHash(trimmed);
  lastMemHash    = thisHash;

  return {
    seq, type: "CN", date, text: trimmed,
    preview: content.slice(0, 60),
    topic: data.topic || "general",
    hash: thisHash,
  };
}

// ── Build a FULL SUMMARY chunk ────────────────────────────────────────────────
// 800 char target. Complete semantic record.
// Input: { session, built, decisions, insights, vision, codeFiles, nextSteps, chainRefs }
export function buildFullSummary(data) {
  const seq     = ++memorySeq;
  const date    = new Date().toISOString().slice(0, 10);
  const header  = `[MEM:FS:${String(seq).padStart(4,"0")}:${date}:${lastMemHash}]\n`;

  const lines = [];
  if (data.session)   lines.push("SESSION:" + compress(data.session, 80));
  if (data.built)     lines.push("BUILT:" + compress(data.built, 120));
  if (data.decisions) lines.push("DECIDED:" + compress(data.decisions, 100));
  if (data.insights)  lines.push("INSIGHT:" + compress(data.insights, 100));
  if (data.vision)    lines.push("VISION:" + compress(data.vision, 80));
  if (data.codeFiles) lines.push("FILES:" + data.codeFiles.join(","));
  if (data.nextSteps) lines.push("NEXT:" + compress(data.nextSteps, 80));
  if (data.chainRefs) lines.push("REFS:" + data.chainRefs.join(","));
  lines.push("SIGN:DA|ᛞᚨᚡᛁᛞ|VITA|INFINITUM×IKN");

  const content  = lines.join("\n");
  const full     = header + content;
  const trimmed  = full.length > 850 ? full.slice(0, 847) + "..." : full;

  const thisHash = memHash(trimmed);
  lastMemHash    = thisHash;

  return {
    seq, type: "FS", date, text: trimmed,
    preview: (data.session || "session").slice(0, 60),
    topic: data.topic || "session",
    hash: thisHash,
  };
}

// ── Inscribe a memory chunk on Base ──────────────────────────────────────────
export async function inscribeMemory(cdpClient, walletAddress, chunk) {
  const calldata = encodeHex(chunk.text);

  const { transactionHash } = await cdpClient.evm.sendTransaction({
    address: walletAddress,
    network: "base",
    transaction: { to: walletAddress, value: BigInt(0), data: calldata }
  });

  // Add to registry
  memoryRegistry.push({
    seq:       chunk.seq,
    type:      chunk.type,
    date:      chunk.date,
    txHash:    transactionHash,
    preview:   chunk.preview,
    topic:     chunk.topic,
    hash:      chunk.hash,
    basescan:  "https://basescan.org/tx/" + transactionHash,
  });

  console.log("🧠 MEMORY INSCRIBED [" + chunk.type + " #" + chunk.seq + "] → " + transactionHash);
  console.log("   Preview: " + chunk.preview);

  return { ...chunk, txHash: transactionHash };
}

// ── Queue a cliff note into BTP (rides next trade) ────────────────────────────
// Returns the text to enqueue — caller adds to btpQueue
export function queueCliffNoteAsBTP(chunk) {
  return {
    name:   "MEM-CN-" + chunk.seq,
    chunks: [chunk.text],
    sent:   0,
    totalChunks: 1,
    prevHash: "0000",
    startTime: Date.now(),
    isMem: true,
  };
}

// ── Retrieve recent cliff notes (for auto-injection) ─────────────────────────
export function getRecentCliffNotes(count = 3) {
  return memoryRegistry
    .filter(m => m.type === "CN")
    .slice(-count);
}

// ── Retrieve full summaries by topic or date ──────────────────────────────────
export function searchMemory(query) {
  const q = query.toLowerCase();
  return memoryRegistry.filter(m =>
    m.preview.toLowerCase().includes(q) ||
    m.topic.toLowerCase().includes(q) ||
    m.date.includes(q)
  );
}

// ── Build context string for injection at conversation start ──────────────────
export async function buildMemoryContext(fetchTxCalldata, count = 3) {
  const recent = getRecentCliffNotes(count);
  if (recent.length === 0) return null;

  const lines = ["🧠 MEMORY CONTEXT (last " + recent.length + " sessions):"];
  for (const m of recent) {
    // Try to fetch full text from chain, fall back to preview
    try {
      const calldata = await fetchTxCalldata(m.txHash);
      lines.push(calldata);
    } catch {
      lines.push("[" + m.date + "] " + m.preview);
    }
  }
  return lines.join("\n");
}

// ── Save/load registry from GitHub state ─────────────────────────────────────
export function serializeRegistry() {
  return { memories: memoryRegistry, lastHash: lastMemHash, seq: memorySeq };
}

export function deserializeRegistry(data) {
  if (!data?.memories) return;
  memoryRegistry = data.memories;
  lastMemHash    = data.lastHash || "0000";
  memorySeq      = data.seq || data.memories.length;
}

// ── Format registry for Telegram /memories command ───────────────────────────
export function getMemoryListMessage() {
  if (memoryRegistry.length === 0) {
    return (
      "🧠 <b>IKN MEMORY — Empty</b>\n\n" +
      "No memories inscribed yet.\n\n" +
      "Save a cliff note:\n" +
      "<code>/remember Built vault system, proved blockchain key retrieval</code>\n\n" +
      "At conversation end:\n" +
      "<code>/savesession</code>"
    );
  }

  const cns = memoryRegistry.filter(m => m.type === "CN");
  const fss = memoryRegistry.filter(m => m.type === "FS");

  let msg = "🧠 <b>IKN MEMORY — " + memoryRegistry.length + " chunk(s)</b>\n";
  msg += "━━━━━━━━━━━━━━━━━━━━\n\n";

  if (fss.length > 0) {
    msg += "<b>📚 Full Sessions (" + fss.length + "):</b>\n";
    for (const m of fss.slice(-5)) {
      msg += "📖 <b>" + m.date + "</b> — " + m.preview.slice(0, 50) + "\n";
      msg += "   <a href=\"" + m.basescan + "\">↗ BaseScan</a>\n";
    }
    msg += "\n";
  }

  if (cns.length > 0) {
    msg += "<b>📌 Cliff Notes (" + cns.length + "):</b>\n";
    for (const m of cns.slice(-5)) {
      msg += "📌 <b>#" + m.seq + "</b> " + m.date + " — " + m.preview.slice(0, 50) + "\n";
      msg += "   <a href=\"" + m.basescan + "\">↗ BaseScan</a>\n";
    }
  }

  msg += "\n<i>/recall [topic] — search memories\n/context — inject recent into chat</i>";
  return msg;
}

// ── Parse /remember command into cliff note fields ────────────────────────────
// Smart parser: detects BUILT: DECIDED: PROVED: NEXT: prefixes
// Falls back to treating whole text as "decided" field
export function parseRememberCommand(text) {
  const data = { topic: "manual" };

  if (text.includes("BUILT:") || text.includes("DECIDED:") || text.includes("PROVED:")) {
    // Structured input
    const match = (key) => {
      const m = text.match(new RegExp(key + ":([^|\\n]+)"));
      return m ? m[1].trim() : null;
    };
    data.who     = match("WHO") || "DA+VITA";
    data.built   = match("BUILT");
    data.decided = match("DECIDED");
    data.proved  = match("PROVED");
    data.next    = match("NEXT");
    data.topic   = match("TOPIC") || "manual";
  } else {
    // Freeform — treat as decided/insight
    data.who     = "DA+VITA";
    data.decided = text.slice(0, 120);
    data.topic   = "manual";
  }

  return data;
}
