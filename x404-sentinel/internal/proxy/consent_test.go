package proxy

import (
	"bytes"
	"testing"

	"github.com/masterledgerlive/x404-sentinel/internal/zk"
)

func TestConsent_FailClosed(t *testing.T) {
	ok, reason := Verify_ZK_Consent(nil)
	if ok || reason != "empty" {
		t.Fatalf("nil ok=%v reason=%s", ok, reason)
	}
	ok, reason = Verify_ZK_Consent([]byte{1, 2, 3})
	if ok || reason != "length" {
		t.Fatalf("short ok=%v reason=%s", ok, reason)
	}
	junk := bytes.Repeat([]byte{0x7f}, zk.KeySize)
	ok, reason = Verify_ZK_Consent(junk)
	if ok || reason == "ok" {
		t.Fatalf("junk accepted: %v %s", ok, reason)
	}
}

func TestConsent_StructuralOKIsNotAuthorization(t *testing.T) {
	key, err := zk.Mint(zk.Material{
		ContainerID: "apollo11-sstv",
		Origin:      "nasa-pd-usgov",
		Payload:     []byte("not the real file"),
		Kind:        zk.KindSeal,
		CellIndex:   zk.SealIndex,
		CellCount:   1,
		Chunk:       []byte("not the real file"),
		Prev:        bytes.Repeat([]byte{0}, 32),
		Stacked:     bytes.Repeat([]byte{2}, 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	ok, reason := Verify_ZK_Consent(key)
	if !ok || reason != "ok" {
		t.Fatalf("envelope should be ok, got %v %s", ok, reason)
	}
	// A bit flip in the transcript must fail closed.
	key[len(key)-1] ^= 0xff
	ok, reason = Verify_ZK_Consent(key)
	if ok || reason != "transcript" {
		t.Fatalf("flipped key ok=%v reason=%s", ok, reason)
	}
}
