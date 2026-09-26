/**
 * GRAFT library inject — pull code into local CAS, then activate without GitHub.
 *
 * Primary path: read rooted files from this repo's graft/ tree (offline).
 * Optional path: fetch raw.githubusercontent.com when online (never required
 * after CAS ingest). Never invents tx hashes. Never touches VITA.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { snarkCompressLibrary, casLocation, snarkCompressBlob } from "./snark.js";
import {
  ingestRaw,
  findArtifact,
  listArtifacts,
  readLedger,
  setActive,
  persistLedger,
} from "./store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Rooted graft modules — the main code agents edit around until it refines. */
export const ROOTED_GRAFT_FILES = Object.freeze([
  "hash.js",
  "store.js",
  "think.js",
  "commands.js",
  "snark.js",
  "libraries.js",
  "config.js",
  "seed.js",
  "telegram.js",
  "agent.js",
  "FORMULA.md",
  "AGENTS.md",
  "README.md",
]);

export const LIBRARY_NODE = "libraries";
export const LIBRARY_TITLE = "GRAFT-ROOTED-LIB";

function sha256bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function ensureLibraryNode(ledger) {
  if (ledger.nodes[LIBRARY_NODE]) return ledger.nodes[LIBRARY_NODE];
  const node = {
    nodeId: LIBRARY_NODE,
    title: "LIBRARIES",
    description: "Injected code libraries — local CAS; activate without GitHub",
    parentId: "graft-root",
    children: [],
    artifacts: [],
    tags: ["library", "rooted", "snark"],
    version: 0,
    snapshotIds: [],
    confidence: 0.9,
  };
  ledger.nodes[LIBRARY_NODE] = node;
  const root = ledger.nodes["graft-root"];
  if (root && !root.children.includes(LIBRARY_NODE)) root.children.push(LIBRARY_NODE);
  return node;
}

/** Read rooted graft files from disk (no network). */
export function readRootedLibraryFiles({ rootDir = HERE, names = ROOTED_GRAFT_FILES } = {}) {
  const files = [];
  for (const name of names) {
    const full = path.join(rootDir, name);
    if (!fs.existsSync(full)) continue;
    const body = fs.readFileSync(full, "utf8");
    const buf = Buffer.from(body, "utf8");
    files.push({
      name,
      path: full,
      body,
      hash: sha256bytes(buf),
      bytes: buf.length,
      source: "local-disk",
    });
  }
  return files;
}

/**
 * Optional GitHub raw fetch. Fail soft — local inject is the proof path.
 * Uses raw.githubusercontent.com (no PAT required for public repos).
 */
export async function fetchGithubRawLibrary({
  owner = "masterledgerlive",
  repo = "guardian-protocol-agent",
  ref = "main",
  paths = ROOTED_GRAFT_FILES.map((n) => `graft/${n}`),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, error: "no-fetch", files: [], errors: [], note: "fetch unavailable — use local inject" };
  }
  const files = [];
  const errors = [];
  for (const p of paths) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${p}`;
    try {
      const res = await fetchImpl(url, { headers: { Accept: "text/plain" } });
      if (!res.ok) {
        errors.push({ path: p, status: res.status });
        continue;
      }
      const body = await res.text();
      const buf = Buffer.from(body, "utf8");
      files.push({
        name: path.basename(p),
        path: p,
        body,
        hash: sha256bytes(buf),
        bytes: buf.length,
        source: "github-raw",
        url,
      });
    } catch (err) {
      errors.push({ path: p, error: String(err?.message || err) });
    }
  }
  return {
    ok: files.length > 0,
    files,
    errors,
    note: files.length
      ? "GitHub raw pulled — now store in CAS so activate works offline"
      : "GitHub pull failed — fall back to local disk inject",
  };
}

/**
 * Inject a library into CAS + snark-compress the whole set.
 * Prefer local files; github is optional inlet only.
 */
export function injectLibraryFromFiles(files, {
  title = LIBRARY_TITLE,
  source = "local-inject",
  activate = false,
} = {}) {
  const ledger = readLedger();
  ensureLibraryNode(ledger);
  const snark = snarkCompressLibrary(files, { title });
  const catalogBody = [
    `# ${title}`,
    ``,
    `Injected ${files.length} files · ${snark.bytes} bytes`,
    `Snark: ${snark.short}`,
    `Library loc: ${snark.loc}`,
    `Root commit: ${snark.commit}`,
    `Activate without GitHub: yes (local CAS)`,
    ``,
    `## Files`,
    ...files.map((f) =>
      `- ${f.name} · ${f.bytes} B · sha ${f.hash.slice(0, 12)} · loc ${casLocation(f.hash)} · via ${f.source || source}`
    ),
    ``,
    `## Snark English`,
    snark.note,
    ``,
    `## Machine`,
    snark.short,
  ].join("\n");

  const catalog = ingestRaw(catalogBody, {
    title,
    source,
    mimeType: "text/markdown",
    nodeIds: [LIBRARY_NODE, "archive"],
    provenance: {
      origin: source,
      snarkCommit: snark.commit,
      snarkLoc: snark.loc,
      fileCount: files.length,
      activateWithoutGithub: true,
    },
  }, ledger);

  const filed = [];
  for (const f of files) {
    const r = ingestRaw(f.body, {
      title: `lib:${f.name}`,
      source: `${source}:file`,
      mimeType: f.name.endsWith(".md") ? "text/markdown" : "application/javascript",
      nodeIds: [LIBRARY_NODE, "archive"],
      derivedFrom: [catalog.artifact.id],
      provenance: {
        origin: source,
        fileName: f.name,
        fileHash: f.hash,
        loc: casLocation(f.hash),
        rooted: true,
      },
    }, ledger);
    const fileSnark = snarkCompressBlob(f.body, { title: f.name, name: f.name });
    r.artifact.loc = casLocation(r.artifact.id);
    r.artifact.snark = fileSnark.short;
    r.artifact.rooted = true;
    if (ledger.directory[r.artifact.shortId]) {
      ledger.directory[r.artifact.shortId].loc = r.artifact.loc;
      ledger.directory[r.artifact.shortId].snark = r.artifact.snark;
      ledger.directory[r.artifact.shortId].rooted = true;
    }
    filed.push(r.artifact);
  }

  catalog.artifact.loc = snark.loc;
  catalog.artifact.snark = snark.short;
  catalog.artifact.snarkCommit = snark.commit;
  catalog.artifact.rooted = true;
  catalog.artifact.activateWithoutGithub = true;
  if (ledger.directory[catalog.artifact.shortId]) {
    ledger.directory[catalog.artifact.shortId].loc = snark.loc;
    ledger.directory[catalog.artifact.shortId].snark = snark.short;
    ledger.directory[catalog.artifact.shortId].rooted = true;
  }
  persistLedger(ledger);

  if (activate) {
    setActive(catalog.artifact.shortId, true, ledger);
  }

  return {
    ok: true,
    catalog: catalog.artifact,
    files: filed,
    snark,
    activateWithoutGithub: true,
    source,
    note: "Libraries in local CAS. /graft activate + /graft think work offline.",
  };
}

/** Inject rooted graft library from local disk (proof: no GitHub needed). */
export function injectRootedLibraryLocal(opts = {}) {
  const files = readRootedLibraryFiles({
    rootDir: opts.rootDir || HERE,
    names: opts.names || ROOTED_GRAFT_FILES,
  });
  if (!files.length) {
    return { ok: false, error: "no-files", note: "rooted graft files missing on disk" };
  }
  return injectLibraryFromFiles(files, {
    title: opts.title || LIBRARY_TITLE,
    source: "local-disk",
    activate: opts.activate === true,
  });
}

/** Inject from GitHub raw, falling back to local disk if pull fails. */
export async function injectRootedLibrary({ preferGithub = true, activate = false } = {}) {
  if (preferGithub) {
    const pulled = await fetchGithubRawLibrary();
    if (pulled.ok && pulled.files.length) {
      return {
        ...injectLibraryFromFiles(pulled.files, {
          title: LIBRARY_TITLE,
          source: "github-raw",
          activate,
        }),
        github: { ok: true, errors: pulled.errors },
      };
    }
    const local = injectRootedLibraryLocal({ activate });
    return {
      ...local,
      github: { ok: false, errors: pulled.errors, fellBackToLocal: true },
    };
  }
  return injectRootedLibraryLocal({ activate });
}

export function listLibraries(ledger = readLedger()) {
  return listArtifacts(ledger).filter((a) =>
    (a.nodeIds || []).includes(LIBRARY_NODE)
    || a.rooted === true
    || String(a.title || "").startsWith("lib:")
    || String(a.title || "") === LIBRARY_TITLE
  );
}

export function findRootedCatalog(ledger = readLedger()) {
  return findArtifact(LIBRARY_TITLE, ledger)
    || listLibraries(ledger).find((a) => a.title === LIBRARY_TITLE)
    || null;
}
