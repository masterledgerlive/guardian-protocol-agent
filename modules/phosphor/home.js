/**
 * Internal $HOME filing seat.
 * The address is the verified HOME token. Phosphor copies it so this module
 * does not import the repo-root rotator (the container only ships this folder).
 * Lane is internal filing. This is not a swap and not a Base transaction.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const HOME_SYMBOL = "HOME";
export const HOME_ADDRESS = "0x4BfAa776991E85e5f8b1255461cbbd216cFc714f";

export function homeSeat() {
  return {
    symbol: HOME_SYMBOL,
    address: HOME_ADDRESS,
    lane: "internal",
    note: "Internal filing seat on verified HOME. Not a swap. Base tx location stays empty.",
  };
}

export function appendHomeFiling(stateDir, row) {
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(join(stateDir, "home-filings.jsonl"), JSON.stringify({
    at: row.at,
    commit: row.commit,
    name: row.name,
    filingLoc: row.filingLoc,
    bytes: row.bytes,
    symbol: HOME_SYMBOL,
    address: HOME_ADDRESS,
    lane: "internal",
    baseLocation: null,
  }) + "\n");
}
