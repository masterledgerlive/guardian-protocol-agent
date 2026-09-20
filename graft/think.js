/**
 * GRAFT thought engine — deterministic, visible steps, never a black box.
 * Optional later LLM hook is gated; default is local classification so we
 * can study how filing/activation actually behaves.
 */

import { THINK_COST_ETH, THINK_FREE } from "./config.js";
import { sha256hex } from "./hash.js";
import { appendDataLog } from "./datalog.js";
import {
  ARTIFACT_ACTIVE,
  ARTIFACT_THOUGHT,
  appendThought,
  debitPiggy,
  findArtifact,
  ingestRaw,
  persistLedger,
  rawBlob,
  readLedger,
} from "./store.js";

const LAYER_HINTS = [
  { nodeId: "daisy-l0", keys: ["jam", "coretime", "polkadot", "zk", "subroutine", "multicore", "post-quantum"] },
  { nodeId: "daisy-l1", keys: ["base", "evm", "wallet", "iao", "gas", "treasury", "virtuals", "funding"] },
  { nodeId: "daisy-l2", keys: ["acp", "swarm", "escrow", "rfc", "hire", "commerce", "upwork", "bid"] },
  { nodeId: "daisy-l3", keys: ["memory", "g.a.m.e", "game", "recursive", "vector", "squash", "mind", "lossless"] },
  { nodeId: "daisy-l4", keys: ["telegram", "twitter", "github", "agentkit", "sensory", "interface", "api"] },
  { nodeId: "rail-l0", keys: ["npu", "prover", "snark", "telemetry", "smartphone", "edge"] },
  { nodeId: "rail-l1", keys: ["compression", "aggregate", "shard", "batch"] },
  { nodeId: "rail-l2", keys: ["rollup", "blob", "eip-4844", "op-stack", "op-geth"] },
  { nodeId: "rail-l3", keys: ["x402", "micropayment", "bounty", "agentkit"] },
  { nodeId: "rail-l4", keys: ["dilithium", "xmss", "post-quantum", "arweave", "pqc"] },
  { nodeId: "rail-l5", keys: ["mother", "poseidon", "knowledge", "folding", "ledger"] },
];

const KEEP_HINTS = ["last-root", "merkle", "lossless", "telegram", "human", "harvest", "compact", "hash", "directory", "piggy"];
const DROP_HINTS = ["neo4j", "pinecone", "aws", "kms", "hsm", "s3", "28 week", "iao", "jam network", "render", "akash"];

function words(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9.]+/g)
    .filter((w) => w.length >= 4);
}

function headings(text) {
  return String(text || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => /^#{1,6}\s|^\*\*[A-Z0-9].*\*\*$|^Layer\s+\d|^###\s/i.test(l))
    .slice(0, 12);
}

function firstSentences(text, n = 3) {
  const bits = String(text || "").split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 20);
  return bits.slice(0, n);
}

function scoreOverlap(pool, hints) {
  const set = new Set(pool);
  let hits = 0;
  for (const h of hints) {
    if (set.has(h) || pool.some((w) => w.includes(h))) hits += 1;
  }
  return hits;
}

export function classifyText(text) {
  const pool = words(text);
  const layers = [];
  for (const hint of LAYER_HINTS) {
    const hits = scoreOverlap(pool, hint.keys);
    if (hits > 0) layers.push({ nodeId: hint.nodeId, hits });
  }
  layers.sort((a, b) => b.hits - a.hits);
  const keep = scoreOverlap(pool, KEEP_HINTS);
  const drop = scoreOverlap(pool, DROP_HINTS);
  const lossless = /lossless|never delete|never forget|append-only/i.test(text);
  const compact = /merkle|hash|on-chain pointer|last.root|short.?hand|tag anchor/i.test(text);
  const human = /human|approval|activate|harvest/i.test(text);
  let survival = 0.35 + Math.min(0.25, keep * 0.04) + (lossless ? 0.15 : 0) + (compact ? 0.15 : 0) + (human ? 0.1 : 0);
  survival -= Math.min(0.3, drop * 0.05);
  survival = Math.max(0, Math.min(0.99, Number(survival.toFixed(3))));
  return {
    layers,
    keepHits: keep,
    dropHits: drop,
    lossless,
    compact,
    human,
    survival,
    headings: headings(text),
    preview: firstSentences(text),
    tokens: pool.length,
  };
}

function derivedBrief(artifact, cls) {
  const layerList = cls.layers.length
    ? cls.layers.map((l) => `${l.nodeId} (hits ${l.hits})`).join(", ")
    : "none matched — stays on PROMPTS until a human maps it";
  return [
    `# GRAFT thought — ${artifact.title}`,
    ``,
    `Source artifact: ${artifact.shortId}`,
    `Survival score: ${cls.survival} (heuristic, not P&L, not a chain proof)`,
    ``,
    `## Keep in GRAFT (offshoot)`,
    `- Lossless raw blob in CAS (never delete).`,
    `- Visible thought steps.`,
    `- Last-root Merkle + short §GRAFT§ tag. No invented tx hashes.`,
    `- Money-gated think on the GRAFT piggy.`,
    `- Human activate / sleep / survive / die / harvest.`,
    ``,
    `## Do not build from this dump (yet)`,
    `- No Polkadot JAM, no IAO token, no Pinecone/Neo4j/KMS.`,
    `- No AWS/Render/Akash hire. L2 "hire" stays a GRAFT mark between filed ideas.`,
    `- Do not touch VITA or root agent.js.`,
    ``,
    `## Layer map (daisy offshoot)`,
    layerList,
    ``,
    `## Headings seen`,
    ...(cls.headings.length ? cls.headings.map((h) => `- ${h}`) : ["- (none)"]),
    ``,
    `## Preview`,
    ...cls.preview.map((s) => `> ${s}`),
  ].join("\n");
}

/**
 * Run one thought cycle. Requires the idea to be active unless THINK_FREE.
 * Charges GRAFT piggy (not V3). Writes a derived artifact + thought log.
 */
export function think(ref = "last", { costEth = THINK_COST_ETH, free = THINK_FREE } = {}) {
  const ledger = readLedger();
  const artifact = findArtifact(ref, ledger);
  if (!artifact) return { ok: false, error: "not-found", ref };
  if (!artifact.active && !free) {
    return {
      ok: false,
      error: "not-active",
      artifact,
      hint: `/graft activate ${artifact.shortId}`,
    };
  }
  const cost = Math.max(0, Number(costEth) || 0);
  if (!free && cost > 0) {
    const paid = debitPiggy(cost, `think ${artifact.shortId}`, artifact.id, ledger);
    if (!paid.ok) {
      return {
        ok: false,
        error: "insufficient",
        need: paid.need,
        have: paid.have,
        hint: "/graft fund <eth>",
        artifact,
      };
    }
  }

  const blob = rawBlob(artifact);
  const cls = classifyText(blob);
  const steps = [
    { agent: "ingestor", action: "read-cas", note: `${artifact.bytes} bytes · sha256 ${artifact.shortId}` },
    { agent: "classifier", action: "layer-map", note: cls.layers.map((l) => l.nodeId).join(",") || "prompts-only" },
    { agent: "refiner", action: "keep-vs-drop", note: `keepHits=${cls.keepHits} dropHits=${cls.dropHits} lossless=${cls.lossless} compact=${cls.compact}` },
    { agent: "scorer", action: "survival", note: `score=${cls.survival} (study later; not a proof)` },
    { agent: "filer", action: "derived-brief", note: "new artifact; original untouched" },
    { agent: "anchor", action: "last-root", note: "recompute Merkle; tag only — tx not broadcast" },
  ];

  const extraNodes = ["archive", "daisy-l3", ...cls.layers.map((l) => l.nodeId)];
  for (const nid of extraNodes) {
    if (ledger.nodes[nid] && !artifact.nodeIds.includes(nid)) {
      artifact.nodeIds.push(nid);
      if (!ledger.nodes[nid].artifacts.includes(artifact.id)) {
        ledger.nodes[nid].artifacts.push(artifact.id);
      }
    }
  }
  if (artifact.status === ARTIFACT_ACTIVE) artifact.status = ARTIFACT_THOUGHT;
  persistLedger(ledger);

  const derivedText = derivedBrief(artifact, cls);
  const derived = ingestRaw(derivedText, {
    title: `thought:${artifact.shortId}`,
    source: "think",
    mimeType: "text/markdown",
    nodeIds: ["archive", "daisy-l3", ...cls.layers.map((l) => l.nodeId)],
    derivedFrom: [artifact.id],
    provenance: { origin: "graft-think", parent: artifact.shortId },
    status: ARTIFACT_THOUGHT,
  }, ledger);

  const thought = appendThought({
    thoughtId: sha256hex(`thought:${artifact.id}:${Date.now()}:${cls.survival}`),
    artifactId: artifact.id,
    derivedId: derived.artifact.id,
    ts: new Date().toISOString(),
    costEth: free ? 0 : cost,
    survival: cls.survival,
    classify: cls,
    steps,
    tx: null,
    note: "tx — (not broadcast; never invented)",
  }, ledger);

  appendDataLog({
    kind: "think",
    model: artifact.title.split("—")[0].trim(),
    artifactId: artifact.shortId,
    lastRoot: ledger.lastRoot,
    survival: cls.survival,
    costEth: free ? 0 : cost,
  });

  return {
    ok: true,
    artifact,
    derived: derived.artifact,
    thought,
    classify: cls,
    costEth: free ? 0 : cost,
    piggyEth: ledger.piggyEth,
    lastRoot: ledger.lastRoot,
    tx: null,
  };
}
