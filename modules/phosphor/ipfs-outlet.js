/**
 * IPFS outlet. The chain injector is the store. This only publishes a copy
 * when a local daemon answers. A missing daemon is STANDBY — never a made-up CID.
 */

export function ipfsStandby(reason) {
  return {
    ok: false,
    outlet: "standby",
    cid: null,
    loc: null,
    reason: String(reason || "ipfs outlet standby"),
  };
}

export async function ipfsAdd(bytes, {
  api = process.env.IPFS_API || "http://127.0.0.1:5001",
  timeoutMs = 800,
} = {}) {
  const base = String(api || "").replace(/\/$/, "");
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const boundary = "----phosphorBoundary7b60";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="phosphor.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([head, payload, tail]);
  try {
    const res = await fetch(base + "/api/v0/add?pin=false", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return ipfsStandby("ipfs http " + res.status);
    const json = await res.json();
    const cid = String(json.Hash || json.cid || "").trim();
    if (!cid || cid.includes(" ")) return ipfsStandby("ipfs response missing Hash");
    return { ok: true, outlet: "ipfs", cid, loc: "ipfs://" + cid, reason: null };
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? "ipfs outlet standby" : (error?.message || "ipfs outlet standby");
    return ipfsStandby(reason);
  }
}

export async function ipfsCat(cid, {
  api = process.env.IPFS_API || "http://127.0.0.1:5001",
  timeoutMs = 800,
} = {}) {
  const id = String(cid || "").replace(/^ipfs:\/\//, "").trim();
  if (!id) return null;
  const base = String(api || "").replace(/\/$/, "");
  try {
    const res = await fetch(base + "/api/v0/cat?arg=" + encodeURIComponent(id), {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
