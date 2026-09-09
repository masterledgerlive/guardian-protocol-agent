/**
 * Sparse multi-node placement — stripe fragments across ALL connected nodes.
 *
 * Vision: inject a movie (or any blob) once; pieces land on every online node
 * in the swarm (not only the injector's machine). Reconstruction needs
 * `k` of `n` shards (simulated erasure threshold).
 *
 * Does not mutate production hitch code. Uses StorageModel nodes only.
 */

import { sha256Hex } from "../core/hashing.js";

/**
 * Split a buffer into `shardCount` contiguous shards (last may be shorter).
 * For true erasure coding research later — this is identity striping.
 */
export function stripeBytes(data, shardCount) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const n = Math.max(1, Math.floor(Number(shardCount) || 1));
  const shardSize = Math.ceil(buf.length / n) || 1;
  const shards = [];
  for (let i = 0; i < n; i++) {
    const start = i * shardSize;
    if (start >= buf.length && i > 0) break;
    const slice = buf.subarray(start, Math.min(buf.length, start + shardSize));
    shards.push({
      index: i,
      data: Buffer.from(slice),
      sha256: sha256Hex(slice),
      length: slice.length,
    });
  }
  return { shards, shardSize, originalLength: buf.length, originalSha256: sha256Hex(buf) };
}

/**
 * Place every shard on a distinct online node (round-robin if more shards
 * than nodes). Optional `replicas` copies each shard to additional nodes.
 *
 * @returns {{ ok, placements, paid, failed, online_used, reconstruct_k }}
 */
export function sparseInject(storage, fragmentPrefix, data, {
  replicas = 1,
  tokenLedger = null,
  publicPool = true,
  reconstructK = null,
} = {}) {
  const online = storage.nodes.filter((n) => n.online !== false);
  if (online.length === 0) {
    return { ok: false, reason: "NO_ONLINE_NODES", placements: [], paid: [] };
  }

  const { shards, originalLength, originalSha256 } = stripeBytes(data, online.length);
  const k =
    reconstructK != null
      ? Math.max(1, Math.min(shards.length, Math.floor(reconstructK)))
      : shards.length; // identity stripe needs all shards unless erasure later

  const placements = [];
  const paid = [];
  const failed = [];

  for (const shard of shards) {
    for (let r = 0; r < Math.max(1, replicas); r++) {
      const node = online[(shard.index + r) % online.length];
      const fragmentId = `${fragmentPrefix}:s${shard.index}:r${r}`;
      const result = node.store(fragmentId, shard.data);
      if (!result.ok) {
        failed.push({ fragmentId, node_id: node.id, reason: result.reason });
        continue;
      }
      placements.push({
        fragmentId,
        node_id: node.id,
        shard_index: shard.index,
        replica: r,
        length: shard.length,
        sha256: shard.sha256,
      });
      if (tokenLedger) {
        const reward = tokenLedger.rewardNode(node.id, shard.length, { publicPool });
        paid.push(reward);
      }
    }
  }

  const uniqueShards = new Set(placements.map((p) => p.shard_index));
  const recoverable = uniqueShards.size >= k;

  return {
    ok: recoverable && failed.length === 0,
    reason: recoverable ? "SPARSED" : "INSUFFICIENT_SHARDS",
    placements,
    paid,
    failed,
    online_used: online.map((n) => n.id),
    shard_count: shards.length,
    reconstruct_k: k,
    original_length: originalLength,
    original_sha256: originalSha256,
    kind: "simulated_sparse",
  };
}

/**
 * Reconstruct by gathering shards 0..n-1 from any online replica.
 * Identity stripe: concatenates in index order.
 */
export function sparseRetrieve(storage, fragmentPrefix, shardCount, {
  replicas = 1,
} = {}) {
  const parts = [];
  for (let i = 0; i < shardCount; i++) {
    let found = null;
    for (let r = 0; r < Math.max(1, replicas); r++) {
      const fragmentId = `${fragmentPrefix}:s${i}:r${r}`;
      const res = storage.retrieveAnywhere(fragmentId);
      if (res.ok) {
        found = res.data;
        break;
      }
    }
    if (!found) {
      return { ok: false, reason: "MISSING_SHARD", shard_index: i, parts };
    }
    parts.push(found);
  }
  const data = Buffer.concat(parts);
  return {
    ok: true,
    data,
    sha256: sha256Hex(data),
    length: data.length,
    shards_recovered: parts.length,
  };
}
