/**
 * Real Base tokens for GRAFT tests and RAIL settlement.
 * Addresses come from the live catalog / canonical Base deployments.
 * Never invent a ticker or a contract.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Canonical Base assets — same as price-oracle.js / tokens.json. */
export const BASE_WETH = "0x4200000000000000000000000000000000000006";
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
export const BASE_VIRTUAL = "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b";
export const BASE_TOSHI = "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4";
export const BASE_BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4";
export const BASE_DEGEN = "0x4ed4e862860bed51a9570b96d89af5e1b0efefed";

/** RAIL / GRAFT piggy settles in WETH, not a made-up V_CREDIT token. */
export const SETTLEMENT = Object.freeze({
  symbol: "WETH",
  address: BASE_WETH,
  decimals: 18,
  chain: "base",
  chainId: 8453,
});

export const TEST_UNIVERSE = Object.freeze([
  { symbol: "WETH", address: BASE_WETH, decimals: 18 },
  { symbol: "USDC", address: BASE_USDC, decimals: 6 },
  { symbol: "AERO", address: BASE_AERO, decimals: 18 },
  { symbol: "VIRTUAL", address: BASE_VIRTUAL, decimals: 18 },
  { symbol: "TOSHI", address: BASE_TOSHI, decimals: 18 },
]);

export function loadCatalogTokens() {
  const p = path.join(HERE, "..", "tokens.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return (raw.tokens || []).filter((t) => t.symbol && t.address);
}

export function assertCatalogMatchesCanonical(tokens = loadCatalogTokens()) {
  const want = {
    AERO: BASE_AERO,
    VIRTUAL: BASE_VIRTUAL,
    TOSHI: BASE_TOSHI,
    BRETT: BASE_BRETT,
    DEGEN: BASE_DEGEN,
  };
  const got = {};
  for (const t of tokens) got[String(t.symbol).toUpperCase()] = t.address;
  const mismatches = [];
  for (const [sym, addr] of Object.entries(want)) {
    if (!got[sym]) {
      mismatches.push(`${sym} missing from tokens.json`);
      continue;
    }
    if (got[sym].toLowerCase() !== addr.toLowerCase()) {
      mismatches.push(`${sym} catalog ${got[sym]} != canonical ${addr}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches, got };
}

export function formatTokenLine(t = SETTLEMENT) {
  return `${t.symbol} ${t.address}`;
}
