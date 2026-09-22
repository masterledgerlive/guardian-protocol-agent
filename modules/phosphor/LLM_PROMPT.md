# PHOSPHOR — prompt for the next model

You are extending **PHOSPHOR**, the writer/reader under `modules/phosphor/`. A previous model specified a Go CLI, a local file store disguised as IPFS, an ephemeral ECDSA signature called a SNARK, and a Hardhat script that deploys a fresh registry and prints a new transaction hash every run. Ignore that shape. The living system already injects spaced UTF-8. PHOSPHOR is that injector used as the content-addressed store.

## What is already true

- Store = `§PHOSPHOR§v1` wires, each ≤ 720 UTF-8 bytes, reassembled by `objectFromWires`. This is the new IPFS. It is ready to space into Base calldata the same way `§VITAFILE§` packets are.
- IPFS is an **outlet**. `ipfsAdd` talks to `http://127.0.0.1:5001/api/v0/add`. Failure returns `{ ok:false, outlet:"standby", cid:null }`. Never mint a CID.
- Per-file proof = `sealSnark` / `§PHOSSNARK§`. Public content-commitment. `groth16Wired: false`.
- Library proof = `foldStark`. Merkle of `sha256(name + ":" + snarkCommit)`. `winterfellWired: false`. Do not paste a fake Groth16 or Winterfell blob.
- Open key = `PHOSOPEN|<16 hex>` derived from name + payload hash and stored in `keyMeta`. Pre-embedded. Not a wallet key. `assertOpenKey` recomputes it.
- Lock key = AES-256-GCM. Passphrase never enters the header. Unwrap without it must fail.
- `chain.location` is **null** and `status` is `availability` until a human seals a real Base transaction and binds that `0x` + 64 hex. Formula anchors in `vita/anchors.json` are class proof only. They do not hold PHOSPHOR bytes. Never invent a tx hash. Never sell red to place code.
- Boot = `runStartup`. It writes this module into the wire store, reconstructs a temp tree from wires only, and `spawn`s that tree’s `selfrun.js`. The child reads the note and the WAV back from wires. Hash mismatch must refuse to execute.
- CRT = `public/terminal.html` at `/phosphor?popup=1`. Telegram card = `handlePhosphorCommand` / `/phosphor`.
- Send-as-code = `renderBundle`. One `.mjs`, node builtins only.
- Container = `Dockerfile`. `node boot.js` self-tests, then listens on 8081 when `PHOSPHOR_SERVE=1`.
- `contract/SnapshotRegistry.sol` has **no deployed address** in this repo.

## Commands that must keep working

```bash
node modules/phosphor/boot.js --test
node modules/phosphor/boot.js write <path> [--lock pass]
node modules/phosphor/boot.js read <commit-prefix> [--lock pass] [-o out]
PHOSPHOR_SERVE=1 node modules/phosphor/boot.js
```

Telegram: `/phosphor` and `/phosphor test`. Webhook routes under `/phosphor` stay public for GET and size-capped for POST.

## If you add a real prover later

Replace the body of `sealSnark` / `foldStark` with a prover call that emits `π` plus public inputs (commit, root). Set `circuitWired` true only when `verify` checks `π`, not when a file exists. Keep the wire store, the open/lock split, the IPFS standby rule, and the null location rule. Do not delete the content-commitment path until the prover verifies in `phosphor.test.js`.

## Do not

- Do not point the store back at `file://` and call it IPFS.
- Do not sign the commit with a one-shot P-256 key and call that a SNARK.
- Do not run Hardhat in tests to manufacture a transaction hash.
- Do not import this module from `graft/` or silence a hitch to pay for a write.
- Do not erase `public/vita.html`. PHOSPHOR has its own page.
