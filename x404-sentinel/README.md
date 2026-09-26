# x404 Sentinel

Local middleware between an HTTP client and a content-addressed registry. A container answers **HTTP 404** until the client presents a 448-byte seal key. A matching key turns that 404 into an x402 byte stream: the grouped cells of the file.

[SENTINEL.md](SENTINEL.md) is the rule engine. Routes, JSON fields, the state machine, the key layout, and the stacked hash are specified there. The Go code follows that file.

This directory is a separate module (`github.com/masterledgerlive/x404-sentinel`). It does not import the rest of the repository. Commits are sha256 digests of files in this directory. The health document reports `"chain":"none"`.

## Run

From this directory:

```bash
go run ./cmd/sentinel
```

Listens on `:18080`. Then open `http://127.0.0.1:18080/`.

```bash
go run ./cmd/sentinel -addr 127.0.0.1:18080 -root .
go run ./cmd/sentinel -mint apollo11-sstv
go run ./cmd/sentinel -file
```

`-mint` prints the seal hex for a registry id and exits. `-file` rewrites `testdata/cells/` and `public/apollo11-sstv.proof.hex` from the fixture bytes.

## Moon-landing proof

The live object is `apollo11-sstv`: a 160×120, 10 fps, 4 second VP9 clip cut from NASA public-domain Apollo 11 television (Wikimedia OGV, PD-USGov-NASA). It is an SSTV-style derivative of that television file. It is not the lost raw slow-scan tapes. Hashes and the ffmpeg command are in [testdata/CATALOG.md](testdata/CATALOG.md).

The file is split into 4096-byte cells. Each cell has a 448-byte key. The container seal is a 448-byte key over `sha256(payload)`, the previous stacked commit, and the origin `nasa-pd-usgov`. The registry stores the local sha256. Nothing is written to a chain.

`scripts/prove.sh` builds the server and checks the machine:

1. `GET /container/apollo11-sstv` with no proof returns **404**, and the body is not the video.
2. The seal is minted from the file on disk.
3. `POST /consent` then `GET` with `X-Sentinel-Proof` returns **200**, and the body sha256 matches the catalog.
4. A wrong key stays **404**.

```bash
bash scripts/prove.sh
```

`go test ./...` is the same checks in-process, plus the stacked-hash, consent, registry, and injection tests.

On the page, the video element starts empty on a 404 plate. It does not request `/container/apollo11-sstv` until you click **Solve**. Solve posts the consent key, then loads the stream. Telemetry events drive the agent animations (`agent-intercept`, `agent-verify`, `agent-registry`, `agent-unlock`, `agent-inject`).

## Medical blueprint

[docs/medical-blueprint.md](docs/medical-blueprint.md) is an architecture sketch of a hospital dashboard requesting a synthetic `mri-shim` container. The shim is ASCII labeled `NOT-PHI`. This repository has no patient names, record numbers, or medical images. The proved retrieval is the Apollo clip.

## Layout

```
cmd/sentinel/main.go          HTTP server, -mint, -file
internal/proxy/intercept.go   Intercept_404
internal/proxy/consent.go     Verify_ZK_Consent
internal/proxy/registry.go    Query_x404_Registry
internal/proxy/inject.go      Execute_x402_Injection
internal/proxy/telemetry.go   Emit_Agentic_Telemetry
internal/zk/cellkey.go        448-byte lock
internal/drg/stacked.go       stacked hash analog
public/index.html             agentic skin
testdata/apollo11-sstv.webm   retrieval proof
testdata/cells/               grouped cells and keys
```

Rebuild the clip with `bash scripts/compress-apollo.sh`, then `go run ./cmd/sentinel -file`, and update the hashes in `testdata/CATALOG.md` so the tests still match the bytes.
