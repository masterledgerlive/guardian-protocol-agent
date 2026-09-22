# PHOSPHOR

Green CRT writer/reader. The **injector wire store** is the content-addressed system (the new IPFS that runs from the chain format). A local IPFS daemon is an **outlet**, not the source of truth.

The other draft used a Go binary, an ephemeral ECDSA “proof”, and a file:// fallback. This module uses the same packet cap as the hitch field (720 UTF-8 bytes) and the same honesty rules: no invented transaction hashes, Groth16 unwired, Winterfell unwired.

## What a write does

1. Squash with deflate-raw or brotli, whichever is smaller (or keep the raw bytes).
2. Open mode embeds `PHOSOPEN` from the file name + payload hash. Anyone can unwrap.
3. Lock mode wraps the squash in AES-256-GCM. The passphrase is not stored.
4. Seal a per-file snark short (`§PHOSSNARK§` + commit).
5. If `127.0.0.1:5001` answers, store the payload there and keep `ipfs://CID`. If it does not, the outlet is **STANDBY** and no CID is invented.
6. Split header + payload into `§PHOSPHOR§` wires. `chain.location` stays null until a real Base seal.
7. File the stored bytes as machine `§PHOSBLOCK§` records. Each header `next=` is the following `stark://` loc, or `END`. The system recalls the bytes with the key and only then logs `SYSTEM_INJECTED`. The compressed filing location is `stark://` + 16 hex of that block merkle. Click `/phosphor/receipt?c=` and `/phosphor/block?c=&i=` to read the exact data field.
8. The CRT slices a large upload (about 200KB a part) so a proxy does not answer 502. Payloads over 512KB are `stored.bin` plus an ndjson block chain. READER recomputes `joined = payloadHash`, `recall = rawHash`, and `snark.commit = sha256(sha256(headerCore) || payloadHash)`. PULL streams the file when the open key or the lock passphrase matches. The filing seat is internal HOME `0x4BfAa776991E85e5f8b1255461cbbd216cFc714f`. That is not a swap. `baseLocation` stays null.

The library of this folder folds into one stark-class merkle root (`phosphor-stark-fold-v1`).

## Run the self-test

```bash
node modules/phosphor/boot.js --test
```

That injects this module into a temp wire store, reconstructs it from those wires, and executes the reconstructed `selfrun.js`. The child reads a note and a beep WAV back from the wires and writes a session file.

## CRT

```bash
PHOSPHOR_SERVE=1 node modules/phosphor/boot.js
```

Open `http://127.0.0.1:8081/phosphor?popup=1`. Drop a file or a song. SELF-TEST replays the boot. SEND AS CODE downloads one `.mjs` that unwraps with node and no other package.

## Container

```bash
docker build -t phosphor -f modules/phosphor/Dockerfile modules/phosphor
docker run --rm -p 8081:8081 phosphor
```

The image runs the wire boot before it listens. A failed self-test exits the container.

## Your files

```bash
node modules/phosphor/boot.js write path/to/song.mp3
node modules/phosphor/boot.js read <commit-prefix> -o song-out.mp3
node modules/phosphor/boot.js write secret.txt --lock "your passphrase"
node modules/phosphor/boot.js read <commit-prefix> --lock "your passphrase" -o secret-out.txt
```

CLI state lives in `modules/phosphor/state/` (gitignored). The boot self-test uses a temp directory and does not touch that store.

## Telegram

`/phosphor` sends the card and a Mini App button. `/phosphor test` runs the boot in chat. The CRT is `/phosphor?popup=1`.

## Anchor

`contract/SnapshotRegistry.sol` is a mirror. This repo has no deployed address. Do not fill `location` with a hardhat hash.
