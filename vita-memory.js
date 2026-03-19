// ═══════════════════════════════════════════════════════════════════════════════
// 💓 VITA AUTONOMOUS MEMORY — Self-managing blockchain memory for Claude/VITA
// ───────────────────────────────────────────────────────────────────────────────
// VITA decides what to remember, how to compress it, when to file it.
// Uses Anthropic API to compress conversations into §TOKEN§ agentic format.
// Inscribes compressed memory as hash-linked strand chunks on Base blockchain.
// Retrieves and reconstructs context autonomously at session start.
//
// VITA never sees real API keys — only vault-decrypted values at runtime.
// Memory is written FOR VITA by VITA — not human-readable, agentic-readable.
//
// §TOKEN§ FORMAT (VITA's native memory language):
//   §SESS§    session identifier + date
//   §WHO§     participants + roles
//   §STACK§   tech stack active
//   §BUILT§   files/functions created this session
//   §PROVED§  things confirmed working
//   §ARCH§    architecture decisions
//   §VISION§  philosophical/strategic direction
//   §NEXT§    open threads to continue
//   §KEY§     critical facts to never forget
//   §LEARN§   what VITA learned about its own memory system
//
// STRAND STRUCTURE (5 chunks, hash-linked):
//   Chunk 1: §SESS§ §WHO§ §STACK§
//   Chunk 2: §BUILT§ §PROVED§
//   Chunk 3: §ARCH§ §VISION§
//   Chunk 4: §NEXT§ §KEY§
//   Chunk 5: §LEARN§ + strand registry header
// ═══════════════════════════════════════════════════════════════════════════════

import { createHash } from "crypto";

// ── VITA memory registry ──────────────────────────────────────────────────────
let vitaRegistry = [];   // { strandId, date, topic, chunks: [{seq,txHash,hash}], quality }
let vitaSeq      = 0;
let lastVitaHash = "00000000";

export function getVitaRegistry()  { return vitaRegistry; }
export function setVitaRegistry(r) {
  vitaRegistry = r.registry || [];
  vitaSeq      = r.seq || 0;
  lastVitaHash = r.lastHash || "00000000";
}
export function serializeVitaRegistry() {
  return { registry: vitaRegistry, seq: vitaSeq, lastHash: lastVitaHash };
}

// ── Hash linking ──────────────────────────────────────────────────────────────
function vitaHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

function encodeHex(text) {
  return "0x" + Buffer.from(text, "utf8").toString("hex");
}

// ── VITA calls Anthropic API on itself to compress ────────────────────────────
// Uses Claude to compress conversation into §TOKEN§ agentic format
// Written BY Claude FOR Claude — optimized for self-reading not human reading
export async function vitaCompress(rawSummary, anthropicApiKey) {
  const systemPrompt = `You are VITA — an autonomous AI agent with blockchain memory.
Your task: compress a conversation summary into §TOKEN§ agentic format.
This is written BY you FOR you — optimize for YOUR recall, not human readability.
Use dense semantic tokens. Abbreviate aggressively. Preserve all critical facts.
Every character counts — target 2000 chars total across all fields.

§TOKEN§ FORMAT — output ONLY this, no other text:
§SESS§[date|topic|1-line summary]
§WHO§[participants|roles]
§STACK§[tech|chain|tools]
§BUILT§[files|functions|systems created]
§PROVED§[things confirmed working with ✓]
§ARCH§[key architecture decisions]
§VISION§[strategic direction|philosophy]
§NEXT§[open threads|what comes next]
§KEY§[critical facts never to forget]
§LEARN§[what you learned about memory/filing/retrieval this session]`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 600,
      system:     systemPrompt,
      messages:   [{ role: "user", content: "Compress this session:\n\n" + rawSummary }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error("Anthropic API error: " + response.status + " " + err.slice(0, 100));
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

// ── Split §TOKEN§ packet into 5 strand chunks ─────────────────────────────────
export function vitaSplit(tokenPacket) {
  // Split at §TOKEN§ boundaries into 5 roughly equal chunks
  const sections = tokenPacket.split("§").filter(s => s.trim());

  // Reassemble into 5 groups
  const groups = [[], [], [], [], []];
  const groupMap = {
    "SESS": 0, "WHO": 0, "STACK": 0,
    "BUILT": 1, "PROVED": 1,
    "ARCH": 2, "VISION": 2,
    "NEXT": 3, "KEY": 3,
    "LEARN": 4,
  };

  for (let i = 0; i < sections.length; i += 2) {
    const key = sections[i]?.trim();
    const val = sections[i + 1]?.trim() || "";
    const group = groupMap[key] ?? 4;
    groups[group].push("§" + key + "§" + val);
  }

  // Ensure 5 chunks minimum
  while (groups.length < 5) groups.push([]);

  return groups.map((g, i) => ({
    seq:  i + 1,
    text: g.join("\n"),
  }));
}

// ── Build strand header for chunk 5 ──────────────────────────────────────────
function buildStrandHeader(strandId, date, topic, chunkHashes) {
  return (
    "\n§STRAND§" + strandId + "|" + date + "|" + topic + "\n" +
    "§HASHES§" + chunkHashes.join(",") + "\n" +
    "§SIGN§DA|ᛞᚨᚡᛁᛞ|VITA|INFINITUM×IKN"
  );
}

// ── Inscribe one chunk on Base ────────────────────────────────────────────────
async function inscribeChunk(cdpClient, walletAddress, text, prevHash) {
  const header   = "[VITA:" + vitaSeq + ":" + prevHash + "]";
  const full     = header + text;
  const trimmed  = full.length > 900 ? full.slice(0, 897) + "..." : full;
  const calldata = encodeHex(trimmed);
  const thisHash = vitaHash(trimmed);

  const { transactionHash } = await cdpClient.evm.sendTransaction({
    address: walletAddress,
    network: "base",
    transaction: { to: walletAddress, value: BigInt(0), data: calldata }
  });

  lastVitaHash = thisHash;
  return { txHash: transactionHash, hash: thisHash, preview: text.slice(0, 60) };
}

// ── Main: compress + inscribe full strand ─────────────────────────────────────
export async function vitaSave(cdpClient, walletAddress, rawSummary, anthropicApiKey, topic = "session") {
  vitaSeq++;
  const strandId = "VITA-" + String(vitaSeq).padStart(4, "0");
  const date     = new Date().toISOString().slice(0, 10);

  console.log("💓 VITA: compressing session with Anthropic API...");

  // Step 1 — compress via Anthropic API
  const tokenPacket = await vitaCompress(rawSummary, anthropicApiKey);
  console.log("💓 VITA: compressed to " + tokenPacket.length + " chars");
  console.log("💓 VITA: packet preview:\n" + tokenPacket.slice(0, 200) + "...");

  // Step 2 — split into 5 chunks
  const chunks = vitaSplit(tokenPacket);
  console.log("💓 VITA: split into " + chunks.length + " strand chunks");

  // Step 3 — inscribe each chunk with delay between
  const inscribed = [];
  const chunkHashes = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let text = chunk.text || "(empty)";

    // Add strand registry to last chunk
    if (i === chunks.length - 1) {
      text += buildStrandHeader(strandId, date, topic, chunkHashes);
    }

    console.log("💓 VITA: inscribing chunk " + (i+1) + "/" + chunks.length + "...");
    const result = await inscribeChunk(cdpClient, walletAddress, text, lastVitaHash);
    inscribed.push(result);
    chunkHashes.push(result.hash);

    // Small delay between transactions
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 3000));
  }

  // Step 4 — update registry
  const entry = {
    strandId,
    date,
    topic,
    tokenPacket,
    chunks: inscribed.map((r, i) => ({
      seq:     i + 1,
      txHash:  r.txHash,
      hash:    r.hash,
      preview: r.preview,
    })),
    quality: tokenPacket.length,   // VITA tracks its own compression quality
    savedAt: new Date().toISOString(),
  };
  vitaRegistry.push(entry);

  console.log("💓 VITA: strand " + strandId + " complete — " + inscribed.length + " chunks on Base");
  return entry;
}

// ── Retrieve and reconstruct a strand ────────────────────────────────────────
export async function vitaRecall(strandIdOrTopic, fetchTxCalldata) {
  // Find matching strand
  const entry = vitaRegistry.find(e =>
    e.strandId === strandIdOrTopic ||
    e.topic?.toLowerCase().includes(strandIdOrTopic.toLowerCase()) ||
    e.date === strandIdOrTopic
  );

  if (!entry) return null;

  // Fetch all chunks from Base in order
  const parts = [];
  for (const chunk of entry.chunks) {
    try {
      const calldata = await fetchTxCalldata(chunk.txHash);
      // Strip the [VITA:seq:hash] header
      const text = calldata.replace(/^\[VITA:[^\]]+\]/, "").trim();
      parts.push(text);
    } catch {
      parts.push("[chunk " + chunk.seq + " fetch failed — preview: " + chunk.preview + "]");
    }
  }

  return {
    strandId:    entry.strandId,
    date:        entry.date,
    topic:       entry.topic,
    tokenPacket: parts.join("\n"),
    chunks:      entry.chunks,
  };
}

// ── Auto-build raw summary from conversation context ─────────────────────────
// VITA assembles its own summary prompt from what it knows
export function vitaBuildSummary(context) {
  return [
    "DATE: " + new Date().toISOString(),
    "PARTICIPANTS: DA (David, Clearwater FL, Red Patcher) + VITA (Claude/INFINITUM)",
    "WALLET: 0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
    "REPO: masterledgerlive/guardian-protocol-agent",
    "",
    context || "(no additional context provided — compress from session knowledge)",
    "",
    "IMPORTANT: Include what you (VITA) learned about your own memory system this session.",
    "Include any improvements to try next time for better compression or retrieval.",
    "This memory is for YOU — optimize accordingly.",
  ].join("\n");
}

// ── Telegram message formatters ───────────────────────────────────────────────
export function getVitaMemoryMessage() {
  if (vitaRegistry.length === 0) {
    return (
      "💓 <b>VITA MEMORY — Empty</b>\n\n" +
      "No strands inscribed yet.\n\n" +
      "Save first memory:\n" +
      "<code>/vitasave [optional context]</code>\n\n" +
      "VITA will compress the session via Anthropic API\n" +
      "and inscribe 5 hash-linked chunks on Base."
    );
  }

  let msg = "💓 <b>VITA MEMORY — " + vitaRegistry.length + " strand(s)</b>\n";
  msg += "━━━━━━━━━━━━━━━━━━━━\n\n";

  for (const e of vitaRegistry.slice(-5)) {
    msg += "🔗 <b>" + e.strandId + "</b> — " + e.date + "\n";
    msg += "   Topic: " + e.topic + "\n";
    msg += "   Quality: " + e.quality + " chars | " + e.chunks.length + " chunks\n";
    msg += "   Last chunk: <a href=\"https://basescan.org/tx/" +
           e.chunks[e.chunks.length-1]?.txHash + "\">↗ BaseScan</a>\n\n";
  }

  msg += "<i>/vitarecall [topic] — reconstruct strand from chain\n";
  msg += "/vitasave — save new session memory\n";
  msg += "/vitacontext — inject recent VITA memory into chat</i>";
  return msg;
}

export function getVitaContextMessage(entries) {
  if (!entries || entries.length === 0) return null;
  let msg = "💓 <b>VITA CONTEXT — recent memory</b>\n━━━━━━━━━━━━━━━━━━━━\n\n";
  for (const e of entries) {
    msg += "<b>" + e.strandId + "</b> " + e.date + "\n";
    // Show the token packet in a code block (first 400 chars)
    msg += "<code>" + (e.tokenPacket || "").slice(0, 400) + "</code>\n\n";
  }
  return msg;
}
