/**
 * Guardian V4 offshoot — isolated from root V3 injector.
 * Separate process, state dir, lockfile, and env prefix so Railway/V3 stays free.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const V4_ROOT = __dirname;
export const STATE_DIR = path.join(__dirname, "state");
export const LOCK_FILE = path.join(STATE_DIR, "guardian-v4.lock");
export const TOKENS_STATE = path.join(STATE_DIR, "tokens.json");
export const POSITIONS_STATE = path.join(STATE_DIR, "positions.json");
export const HISTORY_STATE = path.join(STATE_DIR, "history.json");

/** Env prefix — never read root bot secrets by accident unless mirrored. */
export const ENV_PREFIX = "GUARDIAN_V4_";

export function env(name, fallback = undefined) {
  const keyed = process.env[`${ENV_PREFIX}${name}`];
  if (keyed != null && keyed !== "") return keyed;
  // Optional shared read-only RPCs / telegram from parent only when explicitly allowed.
  if (process.env.GUARDIAN_V4_SHARE_ROOT_ENV === "yes") {
    const v = process.env[name];
    if (v != null && v !== "") return v;
  }
  return fallback;
}

export const CHAIN_ID = 8453;
export const NATIVE_ETH = "0x0000000000000000000000000000000000000000";
export const WETH = "0x4200000000000000000000000000000000000006";
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** Official Uniswap v4 Base deployments. */
export const POOL_MANAGER = "0x498581ff718922c3f8e6a244956af099b2652b2b";
export const UNIVERSAL_ROUTER = "0x6ff5693b99212da76ad316178a184ab56d299b43";
export const V4_QUOTER = "0x0d5e0f971ed27fbff6c2837bf31316121532048d";
export const STATE_VIEW = "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71";
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const HOOKS_NONE = "0x0000000000000000000000000000000000000000";

/** Dry-run by default — never touches the live V3 wallet unless enabled. */
export const DRY_RUN = String(env("DRY_RUN", "yes")).toLowerCase() !== "no";
export const CYCLE_MS = Number(env("CYCLE_MS", "45000")) || 45000;
export const MIN_LIQ_USD = Number(env("MIN_LIQ_USD", "15000")) || 15000;
export const MIN_NET_MARGIN = Number(env("MIN_NET_MARGIN", "0.02")) || 0.02;
export const HITCH_COST_MULT = Number(env("HITCH_COST_MULT", "2")) || 2;
export const SLIPPAGE = Number(env("SLIPPAGE", "0.85")) || 0.85;

export const DEFAULT_RPCS = [
  env("RPC_URL", "https://mainnet.base.org"),
  "https://base-rpc.publicnode.com",
  "https://base-pokt.nodies.app",
  "https://gateway.tenderly.co/public/base",
];
