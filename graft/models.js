/**
 * GRAFT model catalog — easy access to filed architecture offshoots.
 * Chosen later from last-root / chain loc; activate locally first.
 */

export const INJECT_AVENUE = "graft-compact-inject";

export const MODELS = Object.freeze([
  {
    id: "MEMORY-INJECTOR",
    match: "MEMORY-INJECTOR",
    layers: "tree",
    dumpFile: "genesis-memory-injector.txt",
    briefFile: "offshoot-graft-brief.md",
    dir: "GRAFT:\\MODELS\\MEMORY-INJECTOR",
    activate: "/graft activate MEMORY-INJECTOR",
  },
  {
    id: "DAISY",
    match: "DAISY — Unified",
    layers: "L0-L4",
    dumpFile: "genesis-unified-agentic-stack.txt",
    briefFile: "offshoot-daisy-brief.md",
    dir: "GRAFT:\\MODELS\\DAISY",
    activate: "/graft activate DAISY",
  },
  {
    id: "RAIL",
    match: "RAIL — Recursive",
    layers: "L0-L5",
    dumpFile: "genesis-rail.txt",
    briefFile: "offshoot-rail-brief.md",
    dir: "GRAFT:\\MODELS\\RAIL",
    activate: "/graft activate RAIL",
  },
]);

export function findModelSpec(ref) {
  const key = String(ref || "").trim().toLowerCase();
  if (!key) return null;
  return MODELS.find((m) => m.id.toLowerCase() === key || m.match.toLowerCase().includes(key)) || null;
}
