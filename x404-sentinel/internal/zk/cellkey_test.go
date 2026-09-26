package zk

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"testing"
)

func sampleMaterial() Material {
	payload := []byte("NOT-PHI synthetic payload for the cell key test")
	return Material{
		ContainerID: "apollo11-sstv",
		Origin:      "nasa-pd-usgov",
		Payload:     payload,
		Kind:        KindSeal,
		CellIndex:   SealIndex,
		CellCount:   3,
		Chunk:       payload,
		Prev:        bytes.Repeat([]byte{0x11}, 32),
		Stacked:     bytes.Repeat([]byte{0x22}, 32),
	}
}

func TestMint_WidthAndStructural(t *testing.T) {
	key, err := Mint(sampleMaterial())
	if err != nil {
		t.Fatal(err)
	}
	if len(key) != KeySize || KeySize != 448 {
		t.Fatalf("key size %d", len(key))
	}
	if err := Structural(key); err != nil {
		t.Fatal(err)
	}
	if binary.BigEndian.Uint16(key[OffKind:OffIndex]) != KindSeal {
		t.Fatal("kind")
	}
	if binary.BigEndian.Uint32(key[OffIndex:OffCount]) != SealIndex {
		t.Fatal("seal index")
	}
	payload := sha256.Sum256(sampleMaterial().Payload)
	if !bytes.Equal(key[OffPayload:OffPrev], payload[:]) {
		t.Fatal("payload hash not embedded")
	}
}

func TestMint_DoesNotEmbedPayloadBytes(t *testing.T) {
	marker := []byte("UNIQUE_PAYLOAD_MARKER_NOT_IN_KEY")
	m := sampleMaterial()
	m.Payload = append(append([]byte(nil), marker...), bytes.Repeat([]byte{0xAB}, 64)...)
	m.Chunk = m.Payload
	key, err := Mint(m)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(key, marker) {
		t.Fatal("raw payload marker leaked into the 448-byte key")
	}
}

func TestStructural_FailClosed(t *testing.T) {
	key, err := Mint(sampleMaterial())
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		mut  func([]byte)
		want string
	}{
		{"short", func(b []byte) {}, "length"},
		{"magic", func(b []byte) { b[0] ^= 0xff }, "magic"},
		{"version", func(b []byte) { b[OffVersion] ^= 0xff }, "version"},
		{"binding", func(b []byte) { b[OffBind] ^= 0xff }, "binding"},
		{"transcript", func(b []byte) { b[KeySize-1] ^= 0xff }, "transcript"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var err error
			if tc.name == "short" {
				err = Structural(key[:100])
			} else {
				cp := append([]byte(nil), key...)
				tc.mut(cp)
				err = Structural(cp)
			}
			if err == nil || err.Error() != tc.want {
				t.Fatalf("got %v want %s", err, tc.want)
			}
		})
	}
	if err := Structural(nil); err == nil || err.Error() != "empty" {
		t.Fatalf("nil: %v", err)
	}
	junk := bytes.Repeat([]byte{0x11}, KeySize)
	if err := Structural(junk); err == nil {
		t.Fatal("random 448 bytes were accepted")
	}
}

func TestMint_ChangesWithPrevOriginPayload(t *testing.T) {
	base, err := Mint(sampleMaterial())
	if err != nil {
		t.Fatal(err)
	}
	m := sampleMaterial()
	m.Prev = bytes.Repeat([]byte{0x33}, 32)
	other, err := Mint(m)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(base, other) {
		t.Fatal("prev did not change the key")
	}
	m = sampleMaterial()
	m.Origin = "synthetic-not-phi"
	other, err = Mint(m)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(base, other) {
		t.Fatal("origin did not change the key")
	}
	m = sampleMaterial()
	m.Payload = []byte("different payload")
	m.Chunk = m.Payload
	other, err = Mint(m)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(base, other) {
		t.Fatal("payload did not change the key")
	}
}

func TestLayout_AddsTo448(t *testing.T) {
	if OffTail+8 != KeySize {
		t.Fatalf("tail end %d", OffTail+8)
	}
	if OffTranscript+(6*32) != OffTail {
		t.Fatal("transcript width")
	}
}
