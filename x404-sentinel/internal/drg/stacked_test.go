package drg

import (
	"bytes"
	"encoding/hex"
	"testing"
)

func TestStack_DeterministicAndDomainSeparated(t *testing.T) {
	prev := bytes.Repeat([]byte{0}, 32)
	a, err := Stack([]byte("abc"), prev, 0)
	if err != nil {
		t.Fatal(err)
	}
	b, err := Stack([]byte("abc"), prev, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Fatal("same input produced different commits")
	}
	if len(a) != 32 {
		t.Fatalf("len %d", len(a))
	}

	c, err := Stack([]byte("abd"), prev, 0)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(a, c) {
		t.Fatal("tampered chunk matched the original commit")
	}

	d, err := Stack([]byte("abc"), prev, 1)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(a, d) {
		t.Fatal("index was ignored")
	}

	prev2 := bytes.Repeat([]byte{1}, 32)
	e, err := Stack([]byte("abc"), prev2, 0)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(a, e) {
		t.Fatal("prev commit was ignored")
	}
}

func TestStack_FailClosed(t *testing.T) {
	if _, err := Stack([]byte("abc"), nil, 0); err == nil {
		t.Fatal("expected error on short prev")
	}
	if _, err := Stack([]byte("abc"), bytes.Repeat([]byte{0}, 31), 0); err == nil {
		t.Fatal("expected error on 31-byte prev")
	}
	empty, err := Stack(nil, bytes.Repeat([]byte{0}, 32), 0)
	if err != nil {
		t.Fatal(err)
	}
	again, err := Stack([]byte{}, bytes.Repeat([]byte{0}, 32), 0)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(empty, again) {
		t.Fatal("empty chunk was not stable")
	}
}

func TestStack_GoldenABC(t *testing.T) {
	got, err := Stack([]byte("abc"), bytes.Repeat([]byte{0}, 32), 0)
	if err != nil {
		t.Fatal(err)
	}
	// Contract vector. SENTINEL.md repeats this hex. If the stack
	// changes, both this test and SENTINEL.md must change together.
	const want = "efbcb6db5e68078ab430d872b70e94d8b3f2971c49ec17fb60e074ab16de9f4f"
	if hex.EncodeToString(got) != want {
		t.Fatalf("got %s", hex.EncodeToString(got))
	}
}
