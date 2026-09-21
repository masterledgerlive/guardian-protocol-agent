package zk

import (
	"bytes"
	"encoding/hex"
	"testing"

	"github.com/masterledgerlive/x404-sentinel/internal/drg"
)

// TestVector_CellKey pins one full 448-byte transcript. SENTINEL.md
// publishes the same hex so another implementation can check itself.
func TestVector_CellKey(t *testing.T) {
	payload := []byte("sentinel-vector")
	prev := make([]byte, 32)
	stacked, err := drg.Stack(payload, prev, 0)
	if err != nil {
		t.Fatal(err)
	}
	key, err := Mint(Material{
		ContainerID: "vector",
		Origin:      "nasa-pd-usgov",
		Payload:     payload,
		Kind:        KindCell,
		CellIndex:   0,
		CellCount:   1,
		Chunk:       payload,
		Prev:        prev,
		Stacked:     stacked,
	})
	if err != nil {
		t.Fatal(err)
	}
	const wantStacked = "f932b11aa70d799311e4313bcd717f1d979525de176c4bd2f0b3df79a02d6ae1"
	const wantKey = "583430344b4559310001000100000000000000010000000f25cee4a003c295ee844a801085cacde5c1a746c59e57870363fed3df5d9d150d0000000000000000000000000000000000000000000000000000000000000000c77d7ebf7b5191e5d519fb9a9e1cc37fc85f05cde610087764d656b4aef82b6625cee4a003c295ee844a801085cacde5c1a746c59e57870363fed3df5d9d150df932b11aa70d799311e4313bcd717f1d979525de176c4bd2f0b3df79a02d6ae1261272c5c3c85f11f1153dcc42c7438f72c344673966152608da25b614424dcf3e14dd9b24db5cf5fc90b8e55c3d6f9b2395a10179cb08f0f7c1b7e5b2cfb8a4cd14b07c64df6604583e8e0673152e5b4cc3992f9e5a1b15c087db0d576f9d2e48ec57262d819bf841718b6076a502eee14f3927ef66b12c1a54b90afb5520a0d11aa5d68eda2b7e3c1fd66c7976503d88426efc36c31917000f08d3a33bc681e052128eec713bd019763c48e0312030036670c6ac2902ab5b00317b3dc5754bd81bd365dd3b00e7d558926b48393af95ae9f1eb03fded064e6dc30dbeb0bf001c861f1e6ee63b095e405689b7f5f25de9817451d9c93e131a1534ed6d18faba3f2833d95c982ec6"
	gotS := hex.EncodeToString(stacked)
	gotK := hex.EncodeToString(key)
	if bytes.Contains(key, payload) {
		t.Fatal("payload leaked")
	}
	if gotS != wantStacked || gotK != wantKey {
		t.Fatalf("stacked %s key %s", gotS, gotK)
	}
}
