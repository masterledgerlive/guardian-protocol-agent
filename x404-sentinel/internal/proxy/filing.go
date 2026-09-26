package proxy

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// manifest is the on-disk index of grouped cells. It stores hashes of
// keys, not the keys themselves. The 448-byte keys live in *.key files.
type manifest struct {
	ID         string         `json:"id"`
	SHA256     string         `json:"sha256"`
	Size       int            `json:"size"`
	CellBytes  int            `json:"cell_bytes"`
	Origin     string         `json:"origin"`
	PHI        bool           `json:"phi"`
	Synthetic  bool           `json:"synthetic"`
	Class      string         `json:"classification"`
	Cells      []manifestCell `json:"cells"`
	SealSHA256 string         `json:"seal_sha256"`
}

type manifestCell struct {
	Index     int    `json:"index"`
	Offset    int    `json:"offset"`
	Length    int    `json:"length"`
	SHA256    string `json:"sha256"`
	Prev      string `json:"prev"`
	Stacked   string `json:"stacked"`
	KeySHA256 string `json:"key_sha256"`
}

// WriteFilings writes grouped cells, 448-byte keys, and the Apollo demo
// proof hex under root. The demo proof is public because the footage is
// NASA public-domain television. The MRI-SHIM seal is filed only under
// testdata/cells and is not copied into public/.
func WriteFilings(reg *Registry, root string) error {
	for _, id := range []string{IDApollo, IDShim} {
		c, ok := reg.container(id)
		if !ok {
			return fmt.Errorf("filing: missing %s", id)
		}
		if err := writeContainer(c, filepath.Join(root, "testdata", "cells", id)); err != nil {
			return err
		}
	}
	apollo, ok := reg.container(IDApollo)
	if !ok {
		return errors.New("filing: apollo missing")
	}
	proofPath := filepath.Join(root, "public", "apollo11-sstv.proof.hex")
	if err := os.MkdirAll(filepath.Dir(proofPath), 0o755); err != nil {
		return err
	}
	text := hex.EncodeToString(apollo.Seal) + "\n"
	return os.WriteFile(proofPath, []byte(text), 0o644)
}

// VerifyFilings checks cell bytes, cell keys, the seal, and the demo
// proof hex against a fresh build of the registered containers.
func VerifyFilings(reg *Registry, root string) error {
	for _, id := range []string{IDApollo, IDShim} {
		c, ok := reg.container(id)
		if !ok {
			return fmt.Errorf("filing: missing %s", id)
		}
		if err := verifyContainer(c, filepath.Join(root, "testdata", "cells", id)); err != nil {
			return fmt.Errorf("%s: %w", id, err)
		}
	}
	apollo, _ := reg.container(IDApollo)
	proofPath := filepath.Join(root, "public", "apollo11-sstv.proof.hex")
	raw, err := os.ReadFile(proofPath)
	if err != nil {
		return err
	}
	got, decErr := hex.DecodeString(strings.TrimSpace(string(raw)))
	if decErr != nil {
		return fmt.Errorf("demo proof: %w", decErr)
	}
	if !bytes.Equal(got, apollo.Seal) {
		return errors.New("demo proof hex does not match the apollo seal")
	}
	return nil
}

func sealSHA(key []byte) string {
	sum := sha256.Sum256(key)
	return hex.EncodeToString(sum[:])
}

func writeContainer(c *Container, dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	man := manifest{
		ID:         c.ID,
		SHA256:     hex.EncodeToString(c.SHA256),
		Size:       len(c.Body),
		CellBytes:  c.CellWidth,
		Origin:     c.Origin,
		PHI:        false,
		Synthetic:  c.Synthetic,
		Class:      "NOT-PHI",
		SealSHA256: sealSHA(c.Seal),
	}
	var concat []byte
	for _, cell := range c.Cells {
		bin := c.Body[cell.Offset : cell.Offset+cell.Length]
		name := fmt.Sprintf("cell-%04d", cell.Index)
		if err := os.WriteFile(filepath.Join(dir, name+".bin"), bin, 0o644); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, name+".key"), cell.Key, 0o644); err != nil {
			return err
		}
		if len(cell.Key) != 448 {
			return fmt.Errorf("cell %d key width %d", cell.Index, len(cell.Key))
		}
		sum := sha256.Sum256(cell.Key)
		man.Cells = append(man.Cells, manifestCell{
			Index:     cell.Index,
			Offset:    cell.Offset,
			Length:    cell.Length,
			SHA256:    hex.EncodeToString(cell.SHA256),
			Prev:      hex.EncodeToString(cell.Prev),
			Stacked:   hex.EncodeToString(cell.Stacked),
			KeySHA256: hex.EncodeToString(sum[:]),
		})
		concat = append(concat, bin...)
	}
	if !bytes.Equal(concat, c.Body) {
		return errors.New("cell concatenation does not rebuild the container")
	}
	if err := os.WriteFile(filepath.Join(dir, "seal.key"), c.Seal, 0o644); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(man, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(filepath.Join(dir, "MANIFEST.json"), raw, 0o644)
}

func verifyContainer(c *Container, dir string) error {
	var concat []byte
	for _, cell := range c.Cells {
		name := fmt.Sprintf("cell-%04d", cell.Index)
		bin, err := os.ReadFile(filepath.Join(dir, name+".bin"))
		if err != nil {
			return err
		}
		key, err := os.ReadFile(filepath.Join(dir, name+".key"))
		if err != nil {
			return err
		}
		want := c.Body[cell.Offset : cell.Offset+cell.Length]
		if !bytes.Equal(bin, want) {
			return fmt.Errorf("cell %d bytes drifted", cell.Index)
		}
		if !bytes.Equal(key, cell.Key) {
			return fmt.Errorf("cell %d key drifted", cell.Index)
		}
		concat = append(concat, bin...)
	}
	if !bytes.Equal(concat, c.Body) {
		return errors.New("filed cells do not rebuild the container")
	}
	seal, err := os.ReadFile(filepath.Join(dir, "seal.key"))
	if err != nil {
		return err
	}
	if !bytes.Equal(seal, c.Seal) {
		return errors.New("seal.key drifted")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "MANIFEST.json"))
	if err != nil {
		return err
	}
	var man manifest
	if err := json.Unmarshal(raw, &man); err != nil {
		return err
	}
	if man.ID != c.ID || man.PHI || man.SHA256 != hex.EncodeToString(c.SHA256) || man.Size != len(c.Body) {
		return errors.New("manifest does not match the container")
	}
	if len(man.Cells) != len(c.Cells) {
		return errors.New("manifest cell count")
	}
	return nil
}
