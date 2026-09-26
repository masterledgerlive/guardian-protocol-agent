package proxy

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestRegistry_MetadataOmitsBytes(t *testing.T) {
	body := []byte("NOT-PHI registry metadata test payload bytes")
	c, err := Build("sample-obj", OriginNASA, "application/octet-stream", "unit", false, body)
	if err != nil {
		t.Fatal(err)
	}
	reg := NewRegistry()
	reg.Add(c)
	meta, ok := reg.Query_x404_Registry("sample-obj")
	if !ok {
		t.Fatal("miss")
	}
	if meta.PHI || meta.Classification != "NOT-PHI" || meta.SHA256 == "" || meta.Size != len(body) {
		t.Fatalf("%+v", meta)
	}
	if meta.CellCount < 1 || len(meta.Cells) != meta.CellCount {
		t.Fatalf("cells %+v", meta)
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, body) {
		t.Fatal("metadata JSON contained payload bytes")
	}
	if strings.Contains(string(raw), "proof") {
		t.Fatal("metadata JSON mentioned a proof")
	}
	// Hash lookup is the content-addressed alternate key.
	byHash, ok := reg.Query_x404_Registry(meta.SHA256)
	if !ok || byHash.ID != "sample-obj" {
		t.Fatalf("hash lookup %+v %v", byHash, ok)
	}
	if _, ok := reg.Query_x404_Registry("missing-id"); ok {
		t.Fatal("missing id hit")
	}
}

func TestRegistry_RefusesDICOM(t *testing.T) {
	body := make([]byte, 200)
	copy(body[128:132], []byte("DICM"))
	if _, err := Build("dicom-obj", OriginShim, "application/octet-stream", "no", true, body); err == nil {
		t.Fatal("DICOM-like bytes were registered")
	}
}

func TestRegistry_HashCheckFailClosed(t *testing.T) {
	body := bytes.Repeat([]byte("moon"), 3000)
	c, err := Build(IDApollo, OriginNASA, "video/webm", "unit", false, body)
	if err != nil {
		t.Fatal(err)
	}
	if err := c.HashCheck(c.SealCopy()); err != nil {
		t.Fatal(err)
	}
	wrong := c.SealCopy()
	wrong[len(wrong)-1] ^= 0xff
	if err := c.HashCheck(wrong); err == nil {
		t.Fatal("mutated seal was accepted")
	}
	other, err := Build(IDApollo, OriginNASA, "video/webm", "unit", false, append(body, 0x01))
	if err != nil {
		t.Fatal(err)
	}
	if err := c.HashCheck(other.SealCopy()); err == nil {
		t.Fatal("seal from other bytes was accepted")
	}
	// A cell key is a real 448-byte transcript and still must not unlock
	// the container. Authorization compares the seal.
	if err := c.HashCheck(c.Cells[0].Key); err == nil {
		t.Fatal("cell key unlocked the container")
	}
}

func TestBuild_GroupsCells(t *testing.T) {
	body := bytes.Repeat([]byte{0x5a}, CellBytes+10)
	c, err := Build("grouped", OriginNASA, "application/octet-stream", "unit", false, body)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Cells) != 2 {
		t.Fatalf("cells %d", len(c.Cells))
	}
	if c.Cells[0].Length != CellBytes || c.Cells[1].Length != 10 {
		t.Fatalf("lengths %d %d", c.Cells[0].Length, c.Cells[1].Length)
	}
	if len(c.Seal) != 448 || len(c.Cells[0].Key) != 448 {
		t.Fatal("key width")
	}
	var concat []byte
	for _, part := range c.CellSlices() {
		concat = append(concat, part...)
	}
	if !bytes.Equal(concat, body) {
		t.Fatal("cells did not rebuild the payload")
	}
}
