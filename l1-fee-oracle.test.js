import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GAS_PRICE_ORACLE,
  GAS_PRICE_ORACLE_ABI,
  EXACT_INPUT_SINGLE_CALLDATA_BYTES,
  UNSIGNED_TX_OVERHEAD_BYTES,
  weiToEth,
  hexByteLength,
  estimateUnsignedTxSize,
  dummySwapCalldata,
  serializeUnsignedSwapTx,
  readL1FeeWei,
  estimateHitchL1FeeEth,
  formatHitchFeeSplit,
} from "./l1-fee-oracle.js";

function mockOracle({ getL1FeeWei, upperBoundWei, failGetL1Fee = false, failAll = false } = {}) {
  return async ({ functionName, args }) => {
    if (failAll) throw new Error("oracle down");
    if (functionName === "getL1Fee") {
      if (failGetL1Fee) throw new Error("getL1Fee failed");
      if (typeof getL1FeeWei === "function") return getL1FeeWei(args[0]);
      return getL1FeeWei;
    }
    if (functionName === "getL1FeeUpperBound") {
      if (typeof upperBoundWei === "function") return upperBoundWei(args[0]);
      return upperBoundWei;
    }
    throw new Error(`unknown fn ${functionName}`);
  };
}

describe("GasPriceOracle helper", () => {
  it("uses the Base predeploy and both fee selectors", () => {
    assert.equal(GAS_PRICE_ORACLE, "0x420000000000000000000000000000000000000F");
    const names = GAS_PRICE_ORACLE_ABI.map((x) => x.name);
    assert.ok(names.includes("getL1Fee"));
    assert.ok(names.includes("getL1FeeUpperBound"));
  });

  it("estimates unsigned tx size from swap calldata + hitch", () => {
    const base = estimateUnsignedTxSize({ hitchBytes: 0 });
    const withHitch = estimateUnsignedTxSize({ hitchBytes: 10 });
    assert.equal(base, UNSIGNED_TX_OVERHEAD_BYTES + EXACT_INPUT_SINGLE_CALLDATA_BYTES);
    assert.equal(withHitch, base + 10);
  });

  it("serializes unsigned EIP-1559 swap bytes; hitch adds exactly N bytes", () => {
    const base = serializeUnsignedSwapTx({ hitchBytes: 0 });
    const hitch = serializeUnsignedSwapTx({ hitchBytes: 10 });
    assert.match(base, /^0x02/);
    assert.equal(hexByteLength(hitch) - hexByteLength(base), 10);
    assert.ok(dummySwapCalldata(10).endsWith("4c".repeat(10)));
  });

  it("weiToEth converts oracle uint256", () => {
    assert.equal(weiToEth(0n), 0);
    assert.equal(weiToEth(10n ** 15n), 0.001);
  });

  it("prefers getL1Fee when unsigned RLP is available", async () => {
    const tx = serializeUnsignedSwapTx({ hitchBytes: 10 });
    const seen = [];
    const wei = await readL1FeeWei(mockOracle({
      getL1FeeWei: (data) => {
        seen.push(data);
        return 5_000_000_000_000n; // 5e12 wei = 0.000005 ETH
      },
      upperBoundWei: 99n,
    }), { unsignedTx: tx });
    assert.equal(wei.source, "getL1Fee");
    assert.equal(wei.wei, 5_000_000_000_000n);
    assert.equal(seen[0], tx);
  });

  it("uses getL1FeeUpperBound(txSize) when full RLP is not available", async () => {
    const wei = await readL1FeeWei(mockOracle({
      getL1FeeWei: 1n,
      upperBoundWei: (size) => {
        assert.equal(size, 300n);
        return 7_000_000_000_000n;
      },
    }), { txSize: 300 });
    assert.equal(wei.source, "getL1FeeUpperBound");
    assert.equal(wei.wei, 7_000_000_000_000n);
    assert.equal(wei.txSize, 300);
  });

  it("falls through to getL1FeeUpperBound when getL1Fee throws", async () => {
    const tx = serializeUnsignedSwapTx({ hitchBytes: 10 });
    const wei = await readL1FeeWei(mockOracle({
      failGetL1Fee: true,
      upperBoundWei: 3_000_000_000_000n,
    }), { unsignedTx: tx });
    assert.equal(wei.source, "getL1FeeUpperBound");
    assert.equal(wei.wei, 3_000_000_000_000n);
  });

  it("estimateHitchL1FeeEth returns incremental L1 of hitch bytes", async () => {
    const quote = await estimateHitchL1FeeEth({
      hitchBytes: 10,
      storeBytes: 10,
      readContract: mockOracle({
        getL1FeeWei: (data) => {
          const n = hexByteLength(data);
          return BigInt(n) * 1_000_000_000n; // 1 gwei * byte
        },
      }),
    });
    assert.equal(quote.ok, true);
    assert.equal(quote.source, "getL1Fee");
    assert.equal(quote.incremental, true);
    assert.ok(quote.l1FeeEth > 0);
    // 10 extra bytes * 1e9 wei
    assert.ok(Math.abs(quote.l1FeeEth - 10e-9) < 1e-15);
    assert.equal(quote.reservedL1FeeEth, quote.l1FeeEth);
  });

  it("scales reserved STORE L1 when wanted hitch is larger", async () => {
    const quote = await estimateHitchL1FeeEth({
      hitchBytes: 100,
      storeBytes: 10,
      readContract: mockOracle({
        getL1FeeWei: (data) => BigInt(hexByteLength(data)) * 1_000_000_000n,
      }),
    });
    assert.equal(quote.ok, true);
    assert.ok(quote.l1FeeEth > 0);
    // RLP length prefix can add extra bytes beyond the hitch payload.
    assert.ok(Math.abs(quote.reservedL1FeeEth - quote.l1FeeEth * 10 / 100) < 1e-18);
    assert.ok(Math.abs(quote.l1FeePerByteEth - quote.l1FeeEth / 100) < 1e-18);
  });

  it("includes BTP L1 from getL1FeeUpperBound(txSize)", async () => {
    const quote = await estimateHitchL1FeeEth({
      hitchBytes: 10,
      btpInscribe: true,
      readContract: mockOracle({
        getL1FeeWei: 2_000_000_000_000n,
        upperBoundWei: 4_000_000_000_000n,
      }),
    });
    assert.equal(quote.ok, true);
    assert.equal(quote.btpL1FeeEth, 0.000004);
  });

  it("safe fallback when oracle throws", async () => {
    const quote = await estimateHitchL1FeeEth({
      hitchBytes: 10,
      readContract: mockOracle({ failAll: true }),
    });
    assert.equal(quote.ok, false);
    assert.equal(quote.source, "fallback");
    assert.equal(quote.l1FeeEth, 0);
    assert.equal(quote.btpL1FeeEth, 0);
  });

  it("safe fallback when readContract is missing", async () => {
    const quote = await estimateHitchL1FeeEth({ hitchBytes: 10 });
    assert.equal(quote.ok, false);
    assert.equal(quote.source, "fallback");
  });

  it("formats L1 vs L2 split", () => {
    const line = formatHitchFeeSplit({
      l1FeeEth: 0.000012,
      l2FeeEth: 8e-9,
      source: "getL1Fee",
    });
    assert.match(line, /HITCH FEE — L1 /);
    assert.match(line, /getL1Fee/);
    assert.match(line, /L2 /);
  });
});
