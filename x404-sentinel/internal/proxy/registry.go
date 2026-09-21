package proxy

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"sync"

	"github.com/masterledgerlive/x404-sentinel/internal/drg"
	"github.com/masterledgerlive/x404-sentinel/internal/zk"
)

// CellBytes is the grouped-cell width. The last cell may be shorter.
// The seal key commits to the ordered list of per-cell stacked digests.
const CellBytes = 4096

// Fixture ids. These are registry keys, not ledger transaction hashes.
const (
	IDApollo   = "apollo11-sstv"
	IDShim     = "mri-shim"
	OriginNASA = "nasa-pd-usgov"
	OriginShim = "synthetic-not-phi"
)

// Container is a local, content-addressed object. Body and Seal are
// json:"-" so a mistaken Marshal cannot write payload or key bytes.
// HTTP handlers must still send Metadata(), never the Container struct.
type Container struct {
	ID          string `json:"id"`
	Origin      string `json:"origin"`
	MIME        string `json:"mime"`
	Label       string `json:"label"`
	Synthetic   bool   `json:"synthetic"`
	Body        []byte `json:"-"`
	SHA256      []byte `json:"-"`
	Cells       []Cell `json:"-"`
	Seal        []byte `json:"-"`
	StackedRoot []byte `json:"-"`
	CellWidth   int    `json:"-"`
}

// Cell is one grouped slice of a container. Key is the 448-byte cell
// transcript and is never part of the registry HTTP response.
type Cell struct {
	Index   int    `json:"index"`
	Offset  int    `json:"offset"`
	Length  int    `json:"length"`
	SHA256  []byte `json:"-"`
	Prev    []byte `json:"-"`
	Stacked []byte `json:"-"`
	Key     []byte `json:"-"`
}

// CellInfo is the metadata view of a cell: hashes only.
type CellInfo struct {
	Index   int    `json:"index"`
	Offset  int    `json:"offset"`
	Length  int    `json:"length"`
	SHA256  string `json:"sha256"`
	Prev    string `json:"prev"`
	Stacked string `json:"stacked"`
}

// Metadata is the only registry document the HTTP API may return.
// Classification is always NOT-PHI. There is no byte field.
type Metadata struct {
	ID             string     `json:"id"`
	SHA256         string     `json:"sha256"`
	Size           int        `json:"size"`
	MIME           string     `json:"mime"`
	Origin         string     `json:"origin"`
	Label          string     `json:"label"`
	PHI            bool       `json:"phi"`
	Synthetic      bool       `json:"synthetic"`
	Classification string     `json:"classification"`
	CellBytes      int        `json:"cell_bytes"`
	CellCount      int        `json:"cell_count"`
	StackedRoot    string     `json:"stacked_root"`
	SealIndex      uint32     `json:"seal_index"`
	Cells          []CellInfo `json:"cells"`
}

// Registry is the local x404 storage-token index. Keys are the container
// id and the lowercase sha256 of the payload. Nothing here is a chain
// transaction hash. The registry does not anchor to Base or any other chain.
type Registry struct {
	mu     sync.RWMutex
	byID   map[string]*Container
	byHash map[string]*Container
}

// NewRegistry returns an empty local registry.
func NewRegistry() *Registry {
	return &Registry{
		byID:   map[string]*Container{},
		byHash: map[string]*Container{},
	}
}

// Add indexes a container by id and by payload sha256.
func (reg *Registry) Add(c *Container) {
	if reg == nil || c == nil {
		return
	}
	reg.mu.Lock()
	defer reg.mu.Unlock()
	reg.byID[c.ID] = c
	reg.byHash[hex.EncodeToString(c.SHA256)] = c
}

// Query_x404_Registry resolves hash, which is either a registry id or the
// lowercase (or mixed-case) sha256 hex of a payload. The metadata has no
// payload bytes and no 448-byte key. Misses return false.
func (reg *Registry) Query_x404_Registry(hash string) (Metadata, bool) {
	c, ok := reg.container(hash)
	if !ok {
		return Metadata{}, false
	}
	return c.Metadata(), true
}

func (reg *Registry) container(key string) (*Container, bool) {
	if reg == nil {
		return nil, false
	}
	reg.mu.RLock()
	defer reg.mu.RUnlock()
	if c, ok := reg.byID[key]; ok {
		return c, true
	}
	if isSHA256Hex(key) {
		if c, ok := reg.byHash[hexLower(key)]; ok {
			return c, true
		}
	}
	return nil, false
}

// Metadata builds the public registry document. phi is hardcoded false.
func (c *Container) Metadata() Metadata {
	cells := make([]CellInfo, len(c.Cells))
	for i, cell := range c.Cells {
		cells[i] = CellInfo{
			Index:   cell.Index,
			Offset:  cell.Offset,
			Length:  cell.Length,
			SHA256:  hex.EncodeToString(cell.SHA256),
			Prev:    hex.EncodeToString(cell.Prev),
			Stacked: hex.EncodeToString(cell.Stacked),
		}
	}
	return Metadata{
		ID:             c.ID,
		SHA256:         hex.EncodeToString(c.SHA256),
		Size:           len(c.Body),
		MIME:           c.MIME,
		Origin:         c.Origin,
		Label:          c.Label,
		PHI:            false,
		Synthetic:      c.Synthetic,
		Classification: "NOT-PHI",
		CellBytes:      c.CellWidth,
		CellCount:      len(c.Cells),
		StackedRoot:    hex.EncodeToString(c.StackedRoot),
		SealIndex:      zk.SealIndex,
		Cells:          cells,
	}
}

// SealCopy returns a copy of the 448-byte container seal.
func (c *Container) SealCopy() []byte {
	return append([]byte(nil), c.Seal...)
}

// HashCheck recomputes the stacked cell commits and the seal from the
// stored bytes and compares the seal to proof in constant time. Any
// mismatch, including a structurally valid key minted for other bytes,
// returns an error. The error text is internal; HTTP maps it to
// hash_fail and does not include it in the response.
func (c *Container) HashCheck(proof []byte) error {
	if c == nil {
		return errors.New("nil container")
	}
	fresh, err := Build(c.ID, c.Origin, c.MIME, c.Label, c.Synthetic, c.Body)
	if err != nil {
		return err
	}
	if len(fresh.Cells) != len(c.Cells) || len(fresh.Seal) != len(c.Seal) {
		return errors.New("recompute diverged")
	}
	for i := range fresh.Cells {
		if subtle.ConstantTimeCompare(fresh.Cells[i].Stacked, c.Cells[i].Stacked) != 1 {
			return errors.New("cell stacked mismatch")
		}
	}
	if subtle.ConstantTimeCompare(fresh.Seal, c.Seal) != 1 {
		return errors.New("stored seal mismatch")
	}
	if len(proof) != len(fresh.Seal) || subtle.ConstantTimeCompare(proof, fresh.Seal) != 1 {
		return errors.New("proof mismatch")
	}
	return nil
}

// CellSlices returns copies of the grouped cells in order. Injection
// writes these only after HashCheck succeeds.
func (c *Container) CellSlices() [][]byte {
	out := make([][]byte, len(c.Cells))
	for i, cell := range c.Cells {
		out[i] = append([]byte(nil), c.Body[cell.Offset:cell.Offset+cell.Length]...)
	}
	return out
}

// Build groups body into cells, stacks each cell, and mints the seal.
// It refuses an empty body and any buffer that looks like a DICOM file.
// This proxy does not store medical images.
func Build(id, origin, mime, label string, synthetic bool, body []byte) (*Container, error) {
	if id == "" || origin == "" || mime == "" {
		return nil, errors.New("registry: incomplete container spec")
	}
	if !idPattern.MatchString(id) {
		return nil, errors.New("registry: invalid id")
	}
	if len(body) == 0 {
		return nil, errors.New("registry: empty payload")
	}
	if err := rejectMedical(body); err != nil {
		return nil, err
	}
	copied := append([]byte(nil), body...)
	chunks, offsets := splitChunks(copied, CellBytes)
	cells := make([]Cell, len(chunks))
	prev := make([]byte, 32)
	for i, chunk := range chunks {
		stacked, err := drg.Stack(chunk, prev, uint32(i))
		if err != nil {
			return nil, err
		}
		key, err := zk.Mint(zk.Material{
			ContainerID: id,
			Origin:      origin,
			Payload:     copied,
			Kind:        zk.KindCell,
			CellIndex:   uint32(i),
			CellCount:   uint32(len(chunks)),
			Chunk:       chunk,
			Prev:        prev,
			Stacked:     stacked,
		})
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(chunk)
		cells[i] = Cell{
			Index:   i,
			Offset:  offsets[i],
			Length:  len(chunk),
			SHA256:  append([]byte(nil), sum[:]...),
			Prev:    append([]byte(nil), prev...),
			Stacked: stacked,
			Key:     key,
		}
		prev = stacked
	}
	group := make([]byte, 0, len(cells)*32)
	for _, cell := range cells {
		group = append(group, cell.Stacked...)
	}
	// prev is the last cell's stacked commit (the chain head).
	sealStacked, err := drg.Stack(group, prev, zk.SealIndex)
	if err != nil {
		return nil, err
	}
	seal, err := zk.Mint(zk.Material{
		ContainerID: id,
		Origin:      origin,
		Payload:     copied,
		Kind:        zk.KindSeal,
		CellIndex:   zk.SealIndex,
		CellCount:   uint32(len(chunks)),
		Chunk:       copied,
		Prev:        prev,
		Stacked:     sealStacked,
	})
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(copied)
	return &Container{
		ID:          id,
		Origin:      origin,
		MIME:        mime,
		Label:       label,
		Synthetic:   synthetic,
		Body:        copied,
		SHA256:      append([]byte(nil), sum[:]...),
		Cells:       cells,
		Seal:        seal,
		StackedRoot: sealStacked,
		CellWidth:   CellBytes,
	}, nil
}

// LoadFile reads path and builds a container. The bytes on disk are the
// source of truth; the registry commit is their sha256.
func LoadFile(id, origin, mime, label string, synthetic bool, path string) (*Container, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Build(id, origin, mime, label, synthetic, body)
}

// LoadFixtures loads the Apollo television derivative and the synthetic
// MRI-SHIM placeholder from root. Both are classified NOT-PHI. Apollo is
// the live retrieval proof. The shim is a dummy byte string for the blueprint.
func LoadFixtures(reg *Registry, root string) error {
	apollo, err := LoadFile(
		IDApollo,
		OriginNASA,
		"video/webm",
		"NASA PD-USGov Apollo 11 television, SSTV-style 160x120 10fps derivative",
		false,
		filepath.Join(root, "testdata", "apollo11-sstv.webm"),
	)
	if err != nil {
		return err
	}
	shim, err := LoadFile(
		IDShim,
		OriginShim,
		"application/octet-stream",
		"synthetic MRI-SHIM placeholder — NOT-PHI",
		true,
		filepath.Join(root, "testdata", "mri-shim.bin"),
	)
	if err != nil {
		return err
	}
	reg.Add(apollo)
	reg.Add(shim)
	return nil
}

// ContainerByID returns the indexed container for a registry id or a
// payload sha256 hex. Callers must not mutate the object. HTTP responses
// use Metadata, HashCheck, and CellSlices rather than exposing Body.
func ContainerByID(reg *Registry, id string) (*Container, bool) {
	return reg.container(id)
}

func splitChunks(body []byte, width int) ([][]byte, []int) {
	var chunks [][]byte
	var offsets []int
	for off := 0; off < len(body); off += width {
		end := off + width
		if end > len(body) {
			end = len(body)
		}
		chunk := append([]byte(nil), body[off:end]...)
		chunks = append(chunks, chunk)
		offsets = append(offsets, off)
	}
	return chunks, offsets
}

// rejectMedical blocks the one medical-file signature this proxy knows
// how to recognize. Real patient media must never be registered.
func rejectMedical(body []byte) error {
	if len(body) >= 132 && bytes.Equal(body[128:132], []byte("DICM")) {
		return errors.New("refusing DICOM-like payload; sentinel does not store medical images")
	}
	return nil
}

func isSHA256Hex(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
		case r >= 'a' && r <= 'f':
		case r >= 'A' && r <= 'F':
		default:
			return false
		}
	}
	return true
}

func hexLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'F' {
			b[i] = c + ('a' - 'A')
		}
	}
	return string(b)
}
