/**
 * Exclusive process lock for Guardian V4 — prevents two V4 instances, and
 * documents separation from the root V3 agent (different lock + state dir).
 */

import fs from "node:fs";
import { LOCK_FILE, STATE_DIR } from "./config.js";

export function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

export function acquireLock() {
  ensureStateDir();
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
      if (prev?.pid && prev.pid !== process.pid) {
        try {
          process.kill(prev.pid, 0);
          throw new Error(
            `Guardian V4 already running (pid ${prev.pid}). ` +
              `Stop it before starting another V4 instance. ` +
              `Root V3 agent.js is a separate process — do not share this lock.`,
          );
        } catch (e) {
          if (e.code !== "ESRCH" && !String(e.message || "").includes("already running")) {
            // stale lock
          } else if (String(e.message || "").includes("already running")) {
            throw e;
          }
        }
      }
    } catch (e) {
      if (String(e.message || "").includes("already running")) throw e;
    }
  }
  const payload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    track: "guardian-v4",
    note: "Isolated from root agent.js (Uniswap V3)",
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(payload, null, 2));
  const release = () => {
    try {
      if (fs.existsSync(LOCK_FILE)) {
        const cur = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
        if (cur?.pid === process.pid) fs.unlinkSync(LOCK_FILE);
      }
    } catch {
      /* ignore */
    }
  };
  process.on("exit", release);
  process.on("SIGINT", () => {
    release();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    release();
    process.exit(0);
  });
  return release;
}
