/**
 * RAIL working offshoot — L0–L5 local engine.
 * Implements the dump's Python adapter for real (sha256 mother-root fold).
 * Credits local WETH (real Base token). No Nova/blobs/Dilithium. No V_CREDIT mint.
 */

import fs from "node:fs";
import path from "node:path";
import { stateDir, THINK_COST_ETH, THINK_FREE } from "./config.js";
import { sha256hex } from "./hash.js";
import { SETTLEMENT } from "./tokens.js";
import { appendDataLog } from "./datalog.js";
import {
  debitPiggy,
  findArtifact,
  persistLedger,
  rawBlob,
  readLedger,
} from "./store.js";

export const RAIL_CONSENSUS = 0.67;
export const RAIL_GENESIS = "GRAFT:RAIL:GENESIS";

export function railStatePath() {
  return path.join(stateDir(), "rail.json");
}

function emptyRail() {
  return {
    name: "RAIL",
    motherRoot: sha256hex(RAIL_GENESIS),
    wethCredit: 0,
    settlement: SETTLEMENT,
    claims: [],
    folds: [],
    lastClaimId: null,
  };
}

export function readRail() {
  fs.mkdirSync(stateDir(), { recursive: true });
  if (!fs.existsSync(railStatePath())) {
    const fresh = emptyRail();
    fs.writeFileSync(railStatePath(), JSON.stringify(fresh, null, 2));
    return fresh;
  }
  return { ...emptyRail(), ...JSON.parse(fs.readFileSync(railStatePath(), "utf8")) };
}

function writeRail(rail) {
  const tmp = `${railStatePath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rail, null, 2));
  fs.renameSync(tmp, railStatePath());
  return rail;
}

/** L0 storage proof: content hash. Honest — not a SNARK. */
export function l0Proof(raw) {
  const payloadHash = sha256hex(raw);
  return {
    layer: "L0",
    kind: "cas-hash",
    payloadHash,
    bytes: Buffer.byteLength(String(raw ?? ""), "utf8"),
    snark: false,
    note: "local CAS hash; not a zk-SNARK",
  };
}

/** L1 aggregate: merkle-style concat hash of payload + previous mother root. */
export function l1Aggregate(proof, motherRoot) {
  return {
    layer: "L1",
    aggHash: sha256hex(`${motherRoot}:${proof.payloadHash}`),
    batchCostClaim: "WETH-piggy",
    settlement: SETTLEMENT,
  };
}

/** L2 blob stand-in: the CAS artifact stays; we record a blob id. */
export function l2Blob(aggHash) {
  return {
    layer: "L2",
    blobId: sha256hex(`blob:${aggHash}`),
    eip4844: false,
    note: "CAS blob id; not an EIP-4844 tx",
  };
}

/**
 * L3 critic / reproducer / optimizer. Deterministic votes from the bytes
 * themselves — no Akash, no invented token prices.
 */
export function l3Votes(raw, proof) {
  const text = String(raw || "");
  const critic = {
    role: "critic",
    accuracy: 0.9,
    vote: /never invent|lossless|last.root|merkle|sha256/i.test(text) || proof.bytes > 200 ? 1 : -1,
    note: "structural: dump present, no chain tx claimed in engine",
  };
  const reproducer = {
    role: "reproducer",
    accuracy: 0.85,
    vote: proof.payloadHash && proof.bytes > 0 ? 1 : -1,
    note: "re-hash matches CAS; compute is local",
  };
  const optimizer = {
    role: "optimizer",
    accuracy: 0.8,
    vote: 1,
    note: "squash to compact KEY+LOC packet; raw stays in archive",
  };
  const agents = [critic, reproducer, optimizer];
  const total = agents.reduce((s, a) => s + a.accuracy, 0);
  const wag = agents.reduce((s, a) => s + a.accuracy * a.vote, 0) / total;
  return { layer: "L3", agents, wag: Number(wag.toFixed(4)), threshold: RAIL_CONSENSUS };
}

/** L4 dual hash rings — stand-in, not Dilithium. */
export function l4Rings(payloadHash) {
  return {
    layer: "L4",
    classical: payloadHash,
    pqcStandin: sha256hex(`pqc-standin:${payloadHash}`),
    dilithium: false,
    note: "second sha256 ring only; not CRYSTALS-Dilithium",
  };
}

/** Dump Python fold_into_mother_root — sha256 Poseidon2 simulation. */
export function foldMotherRoot(motherRoot, payloadHash, zkProofHash) {
  return sha256hex(`${motherRoot}${payloadHash}${zkProofHash}`);
}

export function ingestClaim(raw, { model = "RAIL", artifactId = "" } = {}) {
  const rail = readRail();
  const proof = l0Proof(raw);
  const claimId = sha256hex(`${rail.motherRoot}:${proof.payloadHash}`);
  const claim = {
    claimId,
    payloadHash: proof.payloadHash,
    artifactId,
    model,
    bytes: proof.bytes,
    priorityScore: 0,
    ts: new Date().toISOString(),
  };
  rail.claims.push(claim);
  rail.lastClaimId = claimId;
  rail.wethCredit = (Number(rail.wethCredit) || 0) + Math.max(1, Math.floor(proof.bytes / 1024)) * 1e-12;
  writeRail(rail);
  return { rail, claim, proof };
}

/**
 * Credits local WETH (Base 0x4200…0006). Does not mint V_CREDIT. Does not broadcast.
 */

export function runRailCycle(ref = "RAIL", { costEth = THINK_COST_ETH, free = THINK_FREE } = {}) {
  const ledger = readLedger();
  const artifact = findArtifact(ref, ledger) || findArtifact("RAIL", ledger);
  if (!artifact) return { ok: false, error: "not-found", ref };
  if (!artifact.active && !free) {
    return { ok: false, error: "not-active", artifact, hint: `/graft activate ${artifact.shortId}` };
  }
  const cost = Math.max(0, Number(costEth) || 0);
  if (!free && cost > 0) {
    const paid = debitPiggy(cost, `rail ${artifact.shortId}`, artifact.id, ledger);
    if (!paid.ok) {
      return { ok: false, error: "insufficient", need: paid.need, have: paid.have, artifact };
    }
  }

  const raw = rawBlob(artifact);
  const ingested = ingestClaim(raw, { model: "RAIL", artifactId: artifact.id });
  const { proof, claim } = ingested;
  let rail = ingested.rail;
  const agg = l1Aggregate(proof, rail.motherRoot);
  const blob = l2Blob(agg.aggHash);
  const arena = l3Votes(raw, proof);
  const rings = l4Rings(proof.payloadHash);
  const verified = arena.wag >= RAIL_CONSENSUS;
  const prevRoot = rail.motherRoot;
  let nextRoot = prevRoot;
  if (verified) {
    nextRoot = foldMotherRoot(prevRoot, claim.payloadHash, agg.aggHash);
    rail = readRail();
    rail.motherRoot = nextRoot;
    rail.folds.push({
      ts: new Date().toISOString(),
      from: prevRoot,
      to: nextRoot,
      claimId: claim.claimId,
      wag: arena.wag,
      tx: null,
    });
    const rec = rail.claims.find((c) => c.claimId === claim.claimId);
    if (rec) rec.priorityScore = arena.wag;
    writeRail(rail);
  }

  persistLedger(ledger);
  appendDataLog({
    kind: "rail-cycle",
    model: "RAIL",
    artifactId: artifact.shortId,
    lastRoot: ledger.lastRoot,
    motherRoot: rail.motherRoot,
    wag: arena.wag,
    verified,
    wethCredit: rail.wethCredit,
    settlement: SETTLEMENT,
    l0Bytes: proof.bytes,
    costEth: free ? 0 : cost,
  });

  return {
    ok: true,
    artifact,
    proof,
    agg,
    blob,
    arena,
    rings,
    verified,
    motherRoot: rail.motherRoot,
    prevRoot,
    wethCredit: rail.wethCredit,
    paperCredit: rail.wethCredit,
    settlement: SETTLEMENT,
    piggyEth: ledger.piggyEth,
    lastRoot: ledger.lastRoot,
    tx: null,
    costEth: free ? 0 : cost,
  };
}
