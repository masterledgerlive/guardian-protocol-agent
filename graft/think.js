/**
 * GRAFT thought engine — deterministic, visible steps, never a black box.
 * Optional later LLM hook is gated; default is local classification so we
 * can study how filing/activation actually behaves.
 */

import { THINK_COST_ETH, THINK_FREE } from "./config.js";
import { sha256hex } from "./hash.js";
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
];

  const KEEP_HINTS = ["last-root", "merkle", "lossless", "telegram", "human", "harvest", "compact", "hash", "directory", "piggy", "snark", "cas", "rooted"];
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

/** Agentic AI prefers the most rooted (survived / harvest / rooted lib) when refining. */
export function rootedPreferScore(artifact, ledger) {
  if (!artifact) return 0;
  let s = 0;
  if (artifact.rooted) s += 0.25;
  if (artifact.status === "survived" || artifact.status === "harvest-candidate") s += 0.35;
  if (artifact.status === "thought" || artifact.status === "active") s += 0.1;
  if (String(artifact.loc || "").startsWith("cas://")) s += 0.1;
  if ((artifact.nodeIds || []).includes("libraries")) s += 0.15;
  const thoughts = (ledger?.thoughts || []).filter((t) => t.artifactId === artifact.id).length;
  s += Math.min(0.15, thoughts * 0.03);
  return Number(Math.min(0.99, s).toFixed(3));
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

function derivedBrief(artifact, cls, rootedScore = 0) {
  const layerList = cls.layers.length
    ? cls.layers.map((l) => `${l.nodeId} (hits ${l.hits})`).join(", ")
    : "none matched — stays on PROMPTS until a human maps it";
  return [
    `# GRAFT thought — ${artifact.title}`,
    ``,
    `Source artifact: ${artifact.shortId}`,
    `Location: ${artifact.loc || "cas://(pending)"}`,
    `Snark: ${artifact.snark || "(none)"}`,
    `Survival score: ${cls.survival} (heuristic, not P&L, not a chain proof)`,
    `Rooted prefer score: ${rootedScore} — agentic edits orbit the most rooted code`,
    ``,
    `## Keep in GRAFT (offshoot)`,
    `- Lossless raw blob in CAS (never delete). /graft raw shows it.`,
    `- Local cas:// location always; chain loc empty until harvest.`,
    `- Snark-compress whole code with /graft snark code.`,
    `- Inject libraries once (/graft inject local|github) then activate without GitHub.`,
    `- Visible thought steps. Money-gated think on the GRAFT piggy.`,
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
  const rootedScore = rootedPreferScore(artifact, ledger);
  // Blend: agentic AI uses the most rooted when refining survival.
  cls.survival = Number(Math.min(0.99, cls.survival + rootedScore * 0.2).toFixed(3));
  cls.rootedPrefer = rootedScore;
  const steps = [
    { agent: "ingestor", action: "read-cas", note: `${artifact.bytes} bytes · sha256 ${artifact.shortId} · loc ${artifact.loc || "—"}` },
    { agent: "classifier", action: "layer-map", note: cls.layers.map((l) => l.nodeId).join(",") || "prompts-only" },
    { agent: "refiner", action: "keep-vs-drop", note: `keepHits=${cls.keepHits} dropHits=${cls.dropHits} lossless=${cls.lossless} compact=${cls.compact}` },
    { agent: "rooted", action: "prefer-rooted", note: `rootedScore=${rootedScore} — edits orbit most rooted code` },
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

  const derivedText = derivedBrief(artifact, cls, rootedScore);
  const derived = ingestRaw(derivedText, {
    title: `thought:${artifact.shortId}`,
    source: "think",
    mimeType: "text/markdown",
    nodeIds: ["archive", "daisy-l3", ...cls.layers.map((l) => l.nodeId)],
    derivedFrom: [artifact.id],
    provenance: { origin: "graft-think", parent: artifact.shortId, rootedPrefer: rootedScore },
    status: ARTIFACT_THOUGHT,
  }, ledger);

  const thought = appendThought({
    thoughtId: sha256hex(`thought:${artifact.id}:${Date.now()}:${cls.survival}`),
    artifactId: artifact.id,
    derivedId: derived.artifact.id,
    ts: new Date().toISOString(),
    costEth: free ? 0 : cost,
    survival: cls.survival,
    rootedPrefer: rootedScore,
    classify: cls,
    steps,
    tx: null,
    note: "tx — (not broadcast; never invented)",
  }, ledger);

  return {
    ok: true,
    artifact,
    derived: derived.artifact,
    thought,
    classify: cls,
    rootedPrefer: rootedScore,
    costEth: free ? 0 : cost,
    piggyEth: ledger.piggyEth,
    lastRoot: ledger.lastRoot,
    tx: null,
  };
}
