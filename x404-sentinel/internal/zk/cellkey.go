// Package zk mints and checks the 448-byte sentinel cell key.
//
// The key is a constant-size authorization transcript. Its width is in the
// same class as a zk-SNARK proof (a few hundred bytes, independent of the
// payload). It is not a Groth16, PLONK, or other knowledge-sound proof: there
// is no circuit, no trusted setup, and no hiding property. A party who holds
// the payload can recompute the key. The payload hash is embedded in the
// transcript, so the key also does not hide the content commitment.
//
// What it does guarantee, fail closed:
//
//   - fixed width (448 bytes) or the key is rejected
//   - magic, version, kind, binding, and transcript must recompute
//   - raw payload bytes are not stored in the key
//   - no identity, name, or patient field is an input
//   - authorization is a constant-time compare against a key recomputed
//     from the local file, the previous commit, and the origin label
//
// Do not use this for real protected health information. See
// docs/medical-blueprint.md.
package zk

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"errors"
)

const (
	// KeySize is the fixed transcript width.
	KeySize = 448
	// Version is the only accepted transcript version.
	Version uint16 = 1
	// KindCell is a grouped data cell.
	KindCell uint16 = 1
	// KindSeal is the container seal. Retrieval of the full object
	// requires a seal, not a single cell key.
	KindSeal uint16 = 2
	// SealIndex is the cell index written into a seal transcript.
	SealIndex uint32 = 0xFFFFFFFF
)

const magic = "X404KEY1"

var (
	domBind       = []byte("x404-sentinel/v1/bind\x00")
	domOrigin     = []byte("x404-sentinel/v1/origin\x00")
	domID         = []byte("x404-sentinel/v1/id\x00")
	domTranscript = []byte("x404-sentinel/v1/transcript\x00")
	domTail       = []byte("x404-sentinel/v1/tail\x00")
)

// Layout offsets inside the 448-byte key. SENTINEL.md is the same map.
const (
	OffMagic      = 0
	OffVersion    = 8
	OffKind       = 10
	OffIndex      = 12
	OffCount      = 16
	OffChunkLen   = 20
	OffPayload    = 24
	OffPrev       = 56
	OffOrigin     = 88
	OffChunk      = 120
	OffStacked    = 152
	OffID         = 184
	OffBind       = 216
	OffTranscript = 248
	OffTail       = 440
)

// Material is the public input to a cell or seal transcript.
//
// Payload is the full container (used only to hash). Chunk is the cell
// bytes, or the full payload when minting a seal. Prev and Stacked are
// 32-byte commits from package drg. None of these fields may carry a
// person's identity.
type Material struct {
	ContainerID string
	Origin      string
	Payload     []byte
	Kind        uint16
	CellIndex   uint32
	CellCount   uint32
	Chunk       []byte
	Prev        []byte
	Stacked     []byte
}

// Mint builds a 448-byte key. It returns an error instead of a partial key.
func Mint(m Material) ([]byte, error) {
	if m.ContainerID == "" || m.Origin == "" {
		return nil, errors.New("zk: id and origin are required")
	}
	if m.Kind != KindCell && m.Kind != KindSeal {
		return nil, errors.New("zk: kind")
	}
	if m.CellCount == 0 {
		return nil, errors.New("zk: cell count")
	}
	if len(m.Prev) != 32 || len(m.Stacked) != 32 {
		return nil, errors.New("zk: prev and stacked must be 32 bytes")
	}
	if uint64(len(m.Chunk)) > uint64(^uint32(0)) {
		return nil, errors.New("zk: chunk too large")
	}

	buf := make([]byte, KeySize)
	copy(buf[OffMagic:OffVersion], magic)
	binary.BigEndian.PutUint16(buf[OffVersion:OffKind], Version)
	binary.BigEndian.PutUint16(buf[OffKind:OffIndex], m.Kind)
	binary.BigEndian.PutUint32(buf[OffIndex:OffCount], m.CellIndex)
	binary.BigEndian.PutUint32(buf[OffCount:OffChunkLen], m.CellCount)
	binary.BigEndian.PutUint32(buf[OffChunkLen:OffPayload], uint32(len(m.Chunk)))

	payload := sha256.Sum256(m.Payload)
	copy(buf[OffPayload:OffPrev], payload[:])
	copy(buf[OffPrev:OffOrigin], m.Prev)
	origin := originCommit(m.Origin)
	copy(buf[OffOrigin:OffChunk], origin[:])
	chunk := sha256.Sum256(m.Chunk)
	copy(buf[OffChunk:OffStacked], chunk[:])
	copy(buf[OffStacked:OffID], m.Stacked)
	idSum := idCommit(m.ContainerID)
	copy(buf[OffID:OffBind], idSum[:])

	binding := bind(buf[:OffBind])
	copy(buf[OffBind:OffTranscript], binding[:])
	writeTranscript(buf)
	return buf, nil
}

// Structural checks the envelope only: width, magic, version, kind, and
// the self-binding transcript. It does not decide authorization. A key
// minted over the wrong file is structurally valid and must still fail
// the later stacked compare.
func Structural(proof []byte) error {
	if len(proof) == 0 {
		return errors.New("empty")
	}
	if len(proof) != KeySize {
		return errors.New("length")
	}
	if subtle.ConstantTimeCompare(proof[OffMagic:OffVersion], []byte(magic)) != 1 {
		return errors.New("magic")
	}
	if binary.BigEndian.Uint16(proof[OffVersion:OffKind]) != Version {
		return errors.New("version")
	}
	kind := binary.BigEndian.Uint16(proof[OffKind:OffIndex])
	if kind != KindCell && kind != KindSeal {
		return errors.New("kind")
	}
	wantBind := bind(proof[:OffBind])
	if subtle.ConstantTimeCompare(wantBind[:], proof[OffBind:OffTranscript]) != 1 {
		return errors.New("binding")
	}
	tmp := make([]byte, KeySize)
	copy(tmp[:OffTranscript], proof[:OffTranscript])
	writeTranscript(tmp)
	if subtle.ConstantTimeCompare(tmp[OffTranscript:], proof[OffTranscript:]) != 1 {
		return errors.New("transcript")
	}
	return nil
}

func originCommit(origin string) [32]byte {
	h := sha256.New()
	h.Write(domOrigin)
	h.Write([]byte(origin))
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

func idCommit(id string) [32]byte {
	h := sha256.New()
	h.Write(domID)
	h.Write([]byte(id))
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

func bind(prefix []byte) [32]byte {
	h := sha256.New()
	h.Write(domBind)
	h.Write(prefix)
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// writeTranscript fills bytes [248:448] from the binding and the embedded
// commits. Six SHA-256 blocks and an 8-byte tail. It does not read the
// chunk itself, so the expansion cannot smuggle payload bytes.
func writeTranscript(buf []byte) {
	var blocks [6][32]byte
	off := OffTranscript
	for i := 0; i < 6; i++ {
		h := sha256.New()
		h.Write(domTranscript)
		h.Write([]byte{byte(i)})
		h.Write(buf[OffBind:OffTranscript])
		h.Write(buf[OffPayload:OffPrev])
		h.Write(buf[OffPrev:OffOrigin])
		h.Write(buf[OffOrigin:OffChunk])
		h.Write(buf[OffStacked:OffID])
		sum := h.Sum(nil)
		copy(blocks[i][:], sum)
		copy(buf[off:off+32], sum)
		off += 32
	}
	h := sha256.New()
	h.Write(domTail)
	for i := 0; i < 6; i++ {
		h.Write(blocks[i][:])
	}
	sum := h.Sum(nil)
	copy(buf[OffTail:KeySize], sum[:8])
}
