/**
 * Live sanity check: corrected catalogs must quote; dead addresses must not.
 * Run: node verify-quotes.js
 */
import { fetchTokenUsdQuote, prefetchMarketPrices, isValidUsdPrice } from "./price-oracle.js";

const MUST_QUOTE = {
  MORPHO: "0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842",
  LUNA:   "0x55cD6469F597452B5A7536e2CD98fDE4c1247ee4",
  GAME:   "0x1C4CcA7C5DB003824208aDDA61Bd749e55F463a3",
  HIGHER: "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe",
  MIGGLES:"0xb1a03edA10342529bBf8EB700a06C60441feF25d",
};

const MUST_SKIP = {
  "MORPHO typo": "0xBAa5CC21fd487B8Fcc2F632f8F4e4b1E7a67bA9f",
  "LUNA typo":   "0x55cD6469F597452B5A7536e2CD98fB4297d4a3F7",
  "GAME typo":   "0x1C4CcA7C5CB003824208aDDA61Bd749e55F463a3",
  "KITE stale":  "0x45a8B3bE0D9e3CAFf4325B0bddD786B9B56B3Ca8",
};

let failed = 0;

const batch = await prefetchMarketPrices(Object.values(MUST_QUOTE));
for (const [sym, addr] of Object.entries(MUST_QUOTE)) {
  const batched = batch.prices[addr.toLowerCase()];
  const single = isValidUsdPrice(batched) ? { priceUsd: batched, source: "batch" } : await fetchTokenUsdQuote(addr);
  if (!single || !isValidUsdPrice(single.priceUsd)) {
    console.error(`FAIL ${sym}: expected a live USD quote`);
    failed++;
  } else {
    console.log(`OK   ${sym}: $${single.priceUsd} via ${single.source || "batch"}`);
  }
}

for (const [label, addr] of Object.entries(MUST_SKIP)) {
  const q = await fetchTokenUsdQuote(addr);
  if (q && isValidUsdPrice(q.priceUsd)) {
    console.error(`FAIL ${label}: stale/typo address unexpectedly quoted $${q.priceUsd}`);
    failed++;
  } else {
    console.log(`OK   ${label}: no quote (honest skip)`);
  }
}

if (failed) {
  console.error(`\n${failed} quote check(s) failed`);
  process.exit(1);
}
console.log("\nAll quote checks passed");
