/**
 * Dedicated V4 hot wallet — viem account from GUARDIAN_V4_PRIVATE_KEY.
 * Never reads root V3 CDP secrets. Live broadcast only when DRY_RUN=no.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  DEFAULT_RPCS,
  DRY_RUN,
  PERMIT2,
  UNIVERSAL_ROUTER,
  WETH,
  env,
} from "./config.js";

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
];

const ERC20_ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
];

export function normalizePrivateKey(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // Valid secp256k1 keys are 32 bytes hex — same shape as a tx hash; do not
  // reject on looksLikeTxHash. Vault hashes belong in VAULT_* env names only.
  if (/^0x[a-fA-F0-9]{64}$/.test(s)) return s;
  if (/^[a-fA-F0-9]{64}$/.test(s)) return `0x${s}`;
  return null;
}

export function loadV4Account(privateKey = env("PRIVATE_KEY")) {
  const pk = normalizePrivateKey(privateKey);
  if (!pk) return null;
  try {
    return privateKeyToAccount(pk);
  } catch {
    return null;
  }
}

export function makePublicClient(rpcs = DEFAULT_RPCS) {
  const list = (Array.isArray(rpcs) ? rpcs : [rpcs]).filter(Boolean);
  return createPublicClient({
    chain: base,
    transport: http(list[0] || "https://mainnet.base.org"),
  });
}

export function makeWalletClient(account, rpcs = DEFAULT_RPCS) {
  const list = (Array.isArray(rpcs) ? rpcs : [rpcs]).filter(Boolean);
  return createWalletClient({
    account,
    chain: base,
    transport: http(list[0] || "https://mainnet.base.org"),
  });
}

export async function readNativeEth(publicClient, address) {
  const wei = await publicClient.getBalance({ address });
  return { wei, eth: Number(formatEther(wei)) };
}

export async function readWethEth(publicClient, address) {
  const wei = await publicClient.readContract({
    address: WETH,
    abi: [
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ type: "uint256" }],
      },
    ],
    functionName: "balanceOf",
    args: [address],
  });
  return { wei, eth: Number(formatEther(wei)) };
}

/**
 * Broadcast a Universal Router execute (optional hitch trailer already in data).
 * Refuses when DRY_RUN or missing key.
 */
export async function broadcastV4Swap({
  to = UNIVERSAL_ROUTER,
  data,
  value = 0n,
  account = loadV4Account(),
  publicClient = null,
  walletClient = null,
  dryRun = DRY_RUN,
} = {}) {
  if (dryRun) {
    return { sent: false, reason: "dry-run", hash: null };
  }
  if (!account) {
    return { sent: false, reason: "missing-GUARDIAN_V4_PRIVATE_KEY", hash: null };
  }
  if (!data || String(data).length < 10) {
    return { sent: false, reason: "empty-calldata", hash: null };
  }
  const pub = publicClient || makePublicClient();
  const wallet = walletClient || makeWalletClient(account);
  const bal = await readNativeEth(pub, account.address);
  const need = BigInt(value || 0n);
  if (bal.wei < need) {
    return {
      sent: false,
      reason: `insufficient-native need ${formatEther(need)} have ${bal.eth}`,
      hash: null,
      address: account.address,
    };
  }
  const hash = await wallet.sendTransaction({
    to,
    data,
    value: need,
  });
  return { sent: true, reason: null, hash, address: account.address };
}

/** Best-effort max approve WETH → Permit2 + Universal Router (idempotent). */
export async function ensureWethApprovals(account, { publicClient, walletClient } = {}) {
  if (!account) return { ok: false, reason: "no-account" };
  const pub = publicClient || makePublicClient();
  const wallet = walletClient || makeWalletClient(account);
  const max = 2n ** 256n - 1n;
  const spenders = [PERMIT2, UNIVERSAL_ROUTER];
  const out = [];
  for (const spender of spenders) {
    const current = await pub.readContract({
      address: WETH,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: "allowance",
      args: [account.address, spender],
    });
    if (current >= parseEther("1")) {
      out.push({ spender, skipped: true });
      continue;
    }
    const hash = await wallet.writeContract({
      address: WETH,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [spender, max],
    });
    out.push({ spender, hash });
  }
  return { ok: true, approvals: out };
}
