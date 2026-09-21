/**
 * Multichain portfolio — 32-chain display + other-path ETH L1.
 *
 * Operator snapshot (DeBank-style, not live P&L):
 *   Base $7 (73%, 2 holdings) — hitch / SwapRouter02 RISK path
 *   Ethereum $3 (27%, 1 holding) — untouched by Base path; available for
 *     OTHER paths (ETH-mainnet reader, $0.05 log-seed SIM). Never mixed
 *     into Base exactInputSingle. Vault never spends.
 *   Remaining 30 chains = empty seats (0%) so new tokens can land.
 *
 * Live Base quotes overlay the snapshot when the bot has a real USD mark.
 * Missing live = keep the labeled snapshot, never invent $0 P&L.
 * Buttons never auto-spend. Mother brain untouched.
 */

import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import { TOKEN_LOG_SEED_USD } from "../piggy-bank.js";
import { RISK_WALLET, VAULT_NEVER_ADDRESS } from "../operator-rotate.js";

export const MULTICHAIN_ID = "vita-multichain-portfolio-v1";
export const MULTICHAIN_MAGIC = "§VITACHAINS§";
export const MULTICHAIN_LABEL = "MULTICHAIN";

/** Operator-reported 32-chain display — labeled snapshot, not a fill receipt. */
export const OPERATOR_PORTFOLIO_SNAPSHOT = Object.freeze({
  kind: "operator-snapshot",
  notLivePnl: true,
  source: "32-chain multichain display",
  totalUsd: 10,
  note: "Base RISK hitch path vs Ethereum other-path. Empty chains are seats, not $0 P&L.",
  holdings: Object.freeze({
    base: Object.freeze({ usd: 7, pct: 73, tokens: 2 }),
    ethereum: Object.freeze({ usd: 3, pct: 27, tokens: 1 }),
  }),
});

/**
 * Public chain ids only. Unknown / unlaunched seats keep chainId null —
 * never invent a network.
 */
export const MULTICHAIN_SEATS = Object.freeze([
  { id: "base", name: "Base", chainId: 8453, explorer: "https://basescan.org", dexHost: "base", role: "hitch-trade" },
  { id: "ethereum", name: "Ethereum", chainId: 1, explorer: "https://etherscan.io", dexHost: "ethereum", role: "other-path" },
  { id: "bnb", name: "BNB Chain", chainId: 56, explorer: "https://bscscan.com", dexHost: "bsc", role: "empty-seat" },
  { id: "polygon", name: "Polygon", chainId: 137, explorer: "https://polygonscan.com", dexHost: "polygon", role: "empty-seat" },
  { id: "arbitrum", name: "Arbitrum One", chainId: 42161, explorer: "https://arbiscan.io", dexHost: "arbitrum", role: "empty-seat" },
  { id: "optimism", name: "Optimism", chainId: 10, explorer: "https://optimistic.etherscan.io", dexHost: "optimism", role: "empty-seat" },
  { id: "bttc", name: "BTTC", chainId: 199, explorer: "https://bttcscan.com", dexHost: "bittorrent", role: "empty-seat" },
  { id: "celo", name: "Celo", chainId: 42220, explorer: "https://celoscan.io", dexHost: "celo", role: "empty-seat" },
  { id: "linea", name: "Linea", chainId: 59144, explorer: "https://lineascan.build", dexHost: "linea", role: "empty-seat" },
  { id: "avax", name: "Avax C-Chain", chainId: 43114, explorer: "https://snowscan.xyz", dexHost: "avalanche", role: "empty-seat" },
  { id: "opbnb", name: "opBNB", chainId: 204, explorer: "https://opbnbscan.com", dexHost: "opbnb", role: "empty-seat" },
  { id: "fraxtal", name: "Fraxtal", chainId: 252, explorer: "https://fraxscan.com", dexHost: "fraxtal", role: "empty-seat" },
  { id: "blast", name: "Blast", chainId: 81457, explorer: "https://blastscan.io", dexHost: "blast", role: "empty-seat" },
  { id: "mantle", name: "Mantle", chainId: 5000, explorer: "https://mantlescan.xyz", dexHost: "mantle", role: "empty-seat" },
  { id: "taiko", name: "Taiko", chainId: 167000, explorer: "https://taikoscan.io", dexHost: "taiko", role: "empty-seat" },
  { id: "world", name: "World", chainId: 480, explorer: "https://worldscan.org", dexHost: "worldchain", role: "empty-seat" },
  { id: "xdc", name: "XDC", chainId: 50, explorer: "https://xdcscan.com", dexHost: null, role: "empty-seat" },
  { id: "ape", name: "Ape", chainId: 33139, explorer: "https://apescan.io", dexHost: "apechain", role: "empty-seat" },
  { id: "unichain", name: "Unichain", chainId: 130, explorer: "https://uniscan.xyz", dexHost: "unichain", role: "empty-seat" },
  { id: "berachain", name: "Berachain", chainId: 80094, explorer: "https://berascan.com", dexHost: "berachain", role: "empty-seat" },
  { id: "memecore", name: "MemeCore", chainId: null, explorer: null, dexHost: null, role: "empty-seat" },
  { id: "sonic", name: "Sonic", chainId: 146, explorer: "https://sonicscan.org", dexHost: "sonic", role: "empty-seat" },
  { id: "abstract", name: "Abstract", chainId: 2741, explorer: "https://abscan.org", dexHost: "abstract", role: "empty-seat" },
  { id: "hyperevm", name: "HyperEVM", chainId: 999, explorer: "https://hyperevmscan.io", dexHost: "hyperevm", role: "empty-seat" },
  { id: "katana", name: "Katana", chainId: null, explorer: null, dexHost: null, role: "empty-seat" },
  { id: "sei", name: "Sei", chainId: 1329, explorer: "https://seitrace.com", dexHost: "sei", role: "empty-seat" },
  { id: "monad", name: "Monad", chainId: null, explorer: null, dexHost: null, role: "empty-seat" },
  { id: "plasma", name: "Plasma", chainId: null, explorer: null, dexHost: null, role: "empty-seat" },
  { id: "stable", name: "Stable", chainId: null, explorer: null, dexHost: null, role: "empty-seat" },
  { id: "megaeth", name: "MegaEth", chainId: null, explorer: null, dexHost: null, role: "empty-seat" },
  { id: "robinhood", name: "RobinHood", chainId: null, explorer: null, dexHost: null, role: "empty-seat" },
  { id: "arc", name: "Arc", chainId: null, explorer: null, dexHost: null, role: "empty-seat" },
]);

export const ETH_L1_OTHER_PATH = Object.freeze({
  id: "ethereum",
  chainId: 1,
  symbol: "ETH",
  role: "other-path",
  mixIntoBaseRisk: false,
  mixIntoBaseSwapRouter: false,
  vaultNeverSpends: true,
  availableFor: Object.freeze([
    "eth-mainnet-dex-reader",
    "log-seed-sim",
    "other-path-confirm-override",
  ]),
  native: true,
  address: "0x0000000000000000000000000000000000000000",
  weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
});

function seatHolding(id, snapshot = OPERATOR_PORTFOLIO_SNAPSHOT) {
  return snapshot.holdings?.[id] || { usd: 0, pct: 0, tokens: 0 };
}

export function listMultichainPortfolio({
  snapshot = OPERATOR_PORTFOLIO_SNAPSHOT,
  liveBaseUsd = null,
} = {}) {
  const live = Number(liveBaseUsd);
  const rows = MULTICHAIN_SEATS.map((seat) => {
    const hold = seatHolding(seat.id, snapshot);
    const isBase = seat.id === "base";
    const isEth = seat.id === "ethereum";
    const usd = isBase && Number.isFinite(live) && live > 0 ? live : hold.usd;
    return {
      ...seat,
      usd,
      pct: hold.pct,
      tokens: hold.tokens,
      empty: !(usd > 0),
      mixIntoBaseRisk: false,
      otherPathAvailable: isEth && usd > 0,
      hitchTrade: isBase,
      snapshotUsd: hold.usd,
      liveOverlay: isBase && Number.isFinite(live) && live > 0,
      explorerWallet: seat.explorer
        ? seat.explorer.replace(/\/$/, "") + "/address/" + RISK_WALLET
        : null,
    };
  });
  const eth = rows.find((r) => r.id === "ethereum");
  const base = rows.find((r) => r.id === "base");
  return {
    ok: true,
    id: MULTICHAIN_ID,
    magic: MULTICHAIN_MAGIC,
    formula: FORMULA_ID,
    neverInventHashes: true,
    notLivePnl: snapshot.notLivePnl !== false,
    kind: snapshot.kind,
    source: snapshot.source,
    wallet: RISK_WALLET,
    vaultNever: VAULT_NEVER_ADDRESS,
    logSeedUsd: TOKEN_LOG_SEED_USD,
    chainCount: rows.length,
    base,
    ethereum: eth,
    otherPath: {
      ...ETH_L1_OTHER_PATH,
      usd: eth?.usd || 0,
      pct: eth?.pct || 0,
      note: "Ethereum $3 is untouched by Base SwapRouter02. Other paths may SIM/confirm-use it. Never mix into Base RISK. Vault never.",
    },
    emptySeats: rows.filter((r) => r.empty).map((r) => r.id),
    chains: rows,
    anchors: {
      base: MAINFRAME_ANCHORS.chainId,
      wallet: MAINFRAME_ANCHORS.wallet,
      swapRouter02: MAINFRAME_ANCHORS.swapRouter02,
    },
  };
}

export function formatMultichainCard(port = null) {
  const p = port || listMultichainPortfolio();
  const lines = [
    MULTICHAIN_MAGIC + "v1|32chains§",
    "🗺 MULTICHAIN — " + p.chainCount + " chains",
    "━━━━━━━━━━━━━━━━━━━━",
    "Base hitch: ~$" + Number(p.base?.usd || 0).toFixed(2) + " (" + (p.base?.pct || 0) + "%) · " + (p.base?.tokens || 0) + " toks",
    "ETH L1 other: ~$" + Number(p.ethereum?.usd || 0).toFixed(2) + " (" + (p.ethereum?.pct || 0) + "%) — NOT in Base RISK",
    "Other-path: available for ETH reader / $0.05 seed SIM / confirm|override",
    "Empty seats: " + p.emptySeats.length + " chains @ 0% (ready, not invented P&L)",
    "Log seed $0.05 never remove · vault never · buttons never auto-spend",
  ];
  for (const c of p.chains) {
    const mark = c.hitchTrade ? "★" : c.otherPathAvailable ? "◇" : "·";
    lines.push(
      mark + " " + c.name +
      (c.chainId != null ? " " + c.chainId : "") +
      "  $" + Number(c.usd || 0).toFixed(2) +
      " (" + (c.pct || 0) + "%)",
    );
  }
  return lines.join("\n");
}

export function parseChainsCommand(raw) {
  const low = String(raw || "").trim().toLowerCase();
  if (low === "/chains" || low === "/chain" || low === "/portfolio" || low === "/multichain") {
    return { ok: true, action: "chains" };
  }
  if (low === "/chains eth" || low === "/chains ethereum" || low === "/otherpath") {
    return { ok: true, action: "other-path" };
  }
  return { ok: false, action: null };
}
