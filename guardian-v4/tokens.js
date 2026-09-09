/**
 * Guardian V4 avenue catalog — Base Uniswap V4 only.
 * Pool IDs must be 32-byte (V4). V3-looking 20-byte addresses are excluded.
 *
 * DOT / POLKADOT_BASE are first-class inject targets for the Eureka letter path.
 * XPL (Plasma) has no usable Base V4 ETH book yet → deferred (separate lane later).
 */

import { feePctToUint24, defaultTickSpacing } from "./swap-v4.js";
import { HOOKS_NONE, MIN_LIQ_USD, NATIVE_ETH, WETH } from "./config.js";

function isV4PoolId(id) {
  const h = String(id || "").replace(/^0x/i, "");
  return /^[0-9a-fA-F]{64}$/.test(h);
}

function avenue({
  symbol,
  address,
  quote = "ETH",
  quoteAddress = NATIVE_ETH,
  feePct,
  fee,
  tickSpacing,
  poolId,
  liqUsd = 0,
  volUsd24h = 0,
  injectMain = false,
  status = "active",
  notes = "",
  hooks = HOOKS_NONE,
} = {}) {
  const feeUint = fee != null ? Number(fee) : feePctToUint24(feePct);
  return {
    symbol,
    address: String(address).toLowerCase(),
    quote,
    quoteAddress: String(quoteAddress).toLowerCase(),
    fee: feeUint,
    feePct: feePct ?? (feeUint != null ? feeUint / 10000 : null),
    tickSpacing: tickSpacing ?? defaultTickSpacing(feeUint ?? 3000),
    hooks: String(hooks).toLowerCase(),
    poolId: poolId ? String(poolId).toLowerCase() : null,
    liqUsd: Number(liqUsd) || 0,
    volUsd24h: Number(volUsd24h) || 0,
    injectMain: !!injectMain,
    status,
    notes,
  };
}

/** Static seed catalog — refreshed by agent refresh when online. */
export const V4_AVENUES = [
  // ── Priority: Polkadot pathways + deep V4 books ──────────────────────────
  avenue({
    symbol: "DOT",
    address: "0x23a2847d772803f9efc64b4277b782b06296fe51",
    feePct: 1,
    poolId: "0x5f547579519beaa158cddd3543604029165f66e86a00c373d0ee90c38784921b",
    liqUsd: 664624,
    volUsd24h: 1034041,
    injectMain: true,
    notes:
      "Base Uni V4 DOT/ETH 1% — deepest DOT-named V4 inject surface for Eureka hitch. Verify token identity before sizing up.",
  }),
  avenue({
    symbol: "POLKADOT_BASE",
    address: "0x260f683e13bebb7cd07521b1450a95a62296da33",
    feePct: 0.3,
    poolId: "0x82efe06673eadef95cd9ca661457326c2787a9d735414469cfbb7bf91613714c",
    liqUsd: 147326,
    volUsd24h: 0,
    injectMain: true,
    notes: "Gecko 'polkadot base / ETH 0.3%' V4 pool — Polkadot-branded Base avenue.",
  }),
  avenue({
    symbol: "UDOT",
    address: "0x0F813f4785b2360009F9aC9BF6121a85f109efc6",
    feePct: 0.3,
    poolId: null,
    liqUsd: 19544,
    volUsd24h: 4825,
    status: "watch",
    notes:
      "Polkadot (Universal) uDOT — liquid on Uni V3 WETH today; watch for V4 ETH book before live inject.",
  }),

  // ── Majors / Base blue chips with real V4 ETH|WETH pool IDs ───────────────
  avenue({
    symbol: "CBBTC",
    address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
    feePct: 0.05,
    poolId: "0x2fbe93bf7177596c5d04675bdcef7bacaf98bd954dc26829fcda39f122239459",
    liqUsd: 2709299,
    volUsd24h: 1299933,
    injectMain: true,
    notes: "cbBTC/ETH V4 — deep major. Prefer thin-book caution (unit price).",
  }),
  avenue({
    symbol: "AERO",
    address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
    feePct: 0.3,
    poolId: "0x5dd190c0949646fe9702d439ccf32936134e7da9947af46f418ae285c1032719",
    liqUsd: 43004,
    volUsd24h: 15206,
    injectMain: true,
    notes: "AERO/ETH 0.3% V4 — Base DEX backbone avenue.",
  }),
  avenue({
    symbol: "TOSHI",
    address: "0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4",
    feePct: 1,
    poolId: "0x060eea2f3f474c5a9a53e8b806e180b7f770b305e332f008aefae77030fe8955",
    liqUsd: 96321,
    volUsd24h: 7829,
    injectMain: true,
    notes: "TOSHI/ETH V4 — popular Base meme with usable V4 book.",
  }),
  avenue({
    symbol: "VIRTUAL",
    address: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
    feePct: 0.3,
    poolId: "0x11eca6cb59e4f4cbff4f0c280c447fc1e207cf62f300ce4bc63a33cae605b482",
    liqUsd: 31877,
    volUsd24h: 149738,
    injectMain: true,
    notes: "VIRTUAL/ETH V4 — AI agent meta avenue.",
  }),
  avenue({
    symbol: "UNI",
    address: "0xc3de830ea07524a0761646a6a4e4be0e114a3c83",
    feePct: 0.3,
    poolId: "0x2ca2a300a102b7881ba9a36402fbcb996a52ec25bd94cdf9c36237116dccd3cb",
    liqUsd: 15490,
    volUsd24h: 1802,
    injectMain: true,
    notes: "UNI/ETH V4 — Uniswap token on V4 inject path.",
  }),
  avenue({
    symbol: "DEGEN",
    address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
    feePct: 1,
    poolId: "0xee381526b93d418077a9d1b9c9b495a3d135410af9a58bc2a5f512fb7b61cbf7",
    liqUsd: 6156,
    volUsd24h: 311,
    status: "scout",
    notes: "DEGEN/ETH V4 — thin; scout until liq clears floor.",
  }),
  avenue({
    symbol: "BRETT",
    address: "0x532f27101965dd16442e59d40670faf5ebb142e4",
    feePct: 1,
    poolId: "0x27402edf3c6a6d6b5a279dfc7a2c8cbacebbfdfc3559f7c03d6971b09126a9f3",
    liqUsd: 5500,
    volUsd24h: 200,
    status: "scout",
    notes: "BRETT/ETH V4 — thin vs V3; scout.",
  }),
  avenue({
    symbol: "VVV",
    address: "0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf",
    feePct: 1,
    poolId: "0x4a9e36dee2b8151a2b87e79b0214be596ba7d2d9bdfd7650f2cbce403297678e",
    liqUsd: 193200,
    volUsd24h: 6882,
    injectMain: true,
    notes: "VVV/ETH V4 — Venice Token inject surface.",
  }),

  // ── Popular V4-native / high-volume Base avenues ─────────────────────────
  avenue({
    symbol: "BASECAT",
    address: "0xb2000000000000000000004c27f6523082f41d01",
    feePct: 0.2,
    poolId: "0x18816b0a9ffba7fae928ed0315c756ffe9fba1eb6eaf18236ce82c700ddd20d7",
    liqUsd: 80971,
    volUsd24h: 650560,
    injectMain: true,
    notes: "Basecat/ETH 0.2% — high V4 volume hitch avenue.",
  }),
  avenue({
    symbol: "HABIBI",
    address: "0xeea53c2f26b9af15bc990e9858cc790baedec956",
    quote: "WETH",
    quoteAddress: WETH,
    feePct: 0.01,
    poolId: "0x454a715c3db7855f02b3ec83abd64811b84bff7c49da0da969d738aa358e1645",
    liqUsd: 148118,
    volUsd24h: 2520133,
    injectMain: true,
    notes: "HABIBI/WETH 0.01% — very high V4 volume.",
  }),
  avenue({
    symbol: "LAPTOP",
    address: "0x7026814f938a51ded85a08bc04461daf49f43973",
    quote: "WETH",
    quoteAddress: WETH,
    feePct: 0.01,
    poolId: "0xcc7addd2bad40c8471557140d7513d85e31977d51f77092974bdf6922043bf00",
    liqUsd: 35667,
    volUsd24h: 1212736,
    injectMain: true,
    notes: "LAPTOP/WETH — popular V4 meme avenue.",
  }),
  avenue({
    symbol: "APPLE",
    address: "0xe006d33d7302d3cb3d35d9446f4e9bf854af98b9",
    quote: "WETH",
    quoteAddress: WETH,
    feePct: 0.01,
    poolId: "0x9dcbb2642302c354c1fb8569213acf338597d3f43d75ea837949497ed7e95a7d",
    liqUsd: 65316,
    volUsd24h: 2596228,
    status: "scout",
    notes: "🍎/WETH — huge volume / thinner reserve; scout + tight size.",
  }),
  avenue({
    symbol: "ANSEM",
    address: "0x6b8d803d55ec5cb74f8bb121e01ff2c49668d620",
    feePct: 0.01,
    poolId: "0x88e015e95c98ce8a73f69e584066d24704dd8ba8739b28430ab9abe19e4d96dd",
    liqUsd: 485760,
    volUsd24h: 299,
    injectMain: true,
    notes: "ANSEM/ETH 0.01% — deep reserve V4 book.",
  }),
  avenue({
    symbol: "CLAWBANK",
    address: "0x16332535e2c27da578bc2e82beb09ce9d3c8eb07",
    quote: "WETH",
    quoteAddress: WETH,
    feePct: 0.3,
    poolId: "0xb04b187062efbf94cf9b4b6f42bf688258d3c88b7c9283bbc74dbbfb1af40d54",
    liqUsd: 1337514,
    volUsd24h: 20160,
    injectMain: true,
    notes: "ClawBank/WETH — deep V4 liquidity.",
  }),
  avenue({
    symbol: "CYB3RWR3N",
    address: "0x26e6e2e7a9289b6485c53cd498de510d3a8c8ba3",
    quote: "WETH",
    quoteAddress: WETH,
    feePct: 0.3,
    poolId: "0xadb241a45a0b04acd80b20defdedf945a2bb1c2e2ee4c8331cadc1e95788c84c",
    liqUsd: 636015,
    volUsd24h: 551781,
    injectMain: true,
    notes: "cyb3rwr3n/WETH — deep + active V4.",
  }),
  avenue({
    symbol: "BODEN",
    address: "0xaf46d9d552b3b05b6eabb3342c0a070ed850ce47",
    quote: "WETH",
    quoteAddress: WETH,
    feePct: 0.01,
    poolId: "0xcdd64afa264951381c574713ebe655e41d907efbeb75bdf804587e791f9a7bfa",
    liqUsd: 44930,
    volUsd24h: 675392,
    status: "scout",
    notes: "BODEN/WETH — high vol scout.",
  }),
  avenue({
    symbol: "FLASH",
    address: "0xb20000000000000000000075383736e7a73c55ab",
    quote: "WETH",
    quoteAddress: WETH,
    feePct: 0.6,
    poolId: "0x659de26257bd739664cd7dd40f0e6a6c8c0e8b6546a4baaa577a97077518001e",
    liqUsd: 67928,
    volUsd24h: 233186,
    status: "scout",
    notes: "FLASH/WETH 0.6%.",
  }),
  avenue({
    symbol: "VVVEITY",
    address: "0x85635006d808030e97f3174c8ea1b4aa1f1feba3",
    quote: "WETH",
    quoteAddress: WETH,
    feePct: 0.3,
    poolId: "0x123e50d024df1e6fe41347850a5695918242927b4e2623d2b97625248ccd2c20",
    liqUsd: 191607,
    volUsd24h: 563228,
    injectMain: true,
    notes: "VVVeity/WETH — active V4 avenue.",
  }),

  // ── Deferred / other ecosystems ──────────────────────────────────────────
  avenue({
    symbol: "XPL",
    address: "0x0000000000000000000000000000000000000000",
    feePct: 0.3,
    poolId: null,
    status: "deferred",
    notes:
      "Plasma (XPL) — no usable Base Uni V4 ETH book. Planned: separate Plasma/BSC lane offshoot (not this process).",
  }),
].map((t) => {
  if (t.poolId && !isV4PoolId(t.poolId)) {
    return { ...t, status: "frozen", notes: `${t.notes} | invalid V4 pool id filtered` };
  }
  if (t.status === "active" && t.liqUsd > 0 && t.liqUsd < MIN_LIQ_USD && !t.injectMain) {
    return { ...t, status: "scout" };
  }
  return t;
});

export function listAvenues({ includeDeferred = true, includeWatch = true } = {}) {
  return V4_AVENUES.filter((t) => {
    if (!includeDeferred && t.status === "deferred") return false;
    if (!includeWatch && (t.status === "watch" || t.status === "scout")) return false;
    return true;
  });
}

export function injectableAvenues(minLiq = MIN_LIQ_USD) {
  return V4_AVENUES.filter(
    (t) =>
      t.status === "active" &&
      t.poolId &&
      isV4PoolId(t.poolId) &&
      t.address &&
      t.address !== NATIVE_ETH &&
      Number(t.liqUsd) >= minLiq,
  );
}

export function avenueSummary() {
  const groups = { active: [], scout: [], watch: [], deferred: [], frozen: [] };
  for (const t of V4_AVENUES) {
    (groups[t.status] || (groups[t.status] = [])).push(t.symbol);
  }
  return {
    total: V4_AVENUES.length,
    injectable: injectableAvenues().map((t) => t.symbol),
    groups,
  };
}

export { isV4PoolId };
