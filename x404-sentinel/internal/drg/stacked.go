// Package drg is a stacked depth-robust-graph *analog*.
//
// It commits a byte chunk to a 32-byte digest by splitting the chunk into
// 32-byte nodes and mixing each node with graph neighbors for a fixed number
// of rounds. The shape is inspired by layered graph commitments. It is not
// Filecoin SDR, NSE, or Proof-of-Replication sealing, it does not use
// Filecoin's DRG parameters, and it must not be described as sealing.
//
// The algorithm is normative in SENTINEL.md. Implementations that mint keys
// have to match it byte for byte.
package drg

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
)

const (
	// Rounds is the fixed stack depth. It is an iterated-hash parameter,
	// not a Filecoin sealing round count.
	Rounds = 4
	// Block is the node width in bytes.
	Block = 32
)

var (
	domL0   = []byte("x404-sentinel/v1/drg/L0\x00")
	domLr   = []byte("x404-sentinel/v1/drg/Lr\x00")
	domRoot = []byte("x404-sentinel/v1/drg/ROOT\x00")
)

// Stack returns the 32-byte stacked commitment of chunk.
//
// prev must be exactly 32 bytes (use 32 zero bytes for the first cell).
// index is the cell index, or 0xFFFFFFFF for the container seal group.
//
// Fail closed: a bad prev length or a chunk longer than 4 GiB returns an
// error and no digest. Callers must not treat an error as a commit.
func Stack(chunk []byte, prev []byte, index uint32) ([]byte, error) {
	if len(prev) != Block {
		return nil, errors.New("drg: prev commit must be 32 bytes")
	}
	if uint64(len(chunk)) > uint64(^uint32(0)) {
		return nil, errors.New("drg: chunk exceeds uint32 length")
	}

	blocks := splitBlocks(chunk)
	n := len(blocks)
	labels := make([][Block]byte, n)

	var idx [4]byte
	binary.BigEndian.PutUint32(idx[:], index)
	for i := 0; i < n; i++ {
		var ib [4]byte
		binary.BigEndian.PutUint32(ib[:], uint32(i))
		h := sha256.New()
		h.Write(domL0)
		h.Write(idx[:])
		h.Write(ib[:])
		h.Write(prev)
		h.Write(blocks[i][:])
		copy(labels[i][:], h.Sum(nil))
	}

	for r := 0; r < Rounds; r++ {
		next := make([][Block]byte, n)
		// Expander-like stride. Integer division is intentional and
		// deterministic. For n==1 every neighbor collapses to node 0.
		stride := 1 + (r+1)*(n/3+1)
		for i := 0; i < n; i++ {
			left := (i + n - 1) % n
			jump := (i + stride) % n
			var ib [4]byte
			binary.BigEndian.PutUint32(ib[:], uint32(i))
			h := sha256.New()
			h.Write(domLr)
			h.Write([]byte{byte(r)})
			h.Write(ib[:])
			h.Write(labels[i][:])
			h.Write(labels[left][:])
			h.Write(labels[jump][:])
			copy(next[i][:], h.Sum(nil))
		}
		labels = next
	}

	h := sha256.New()
	h.Write(domRoot)
	var meta [12]byte
	binary.BigEndian.PutUint32(meta[0:4], uint32(len(chunk)))
	binary.BigEndian.PutUint32(meta[4:8], index)
	binary.BigEndian.PutUint32(meta[8:12], uint32(n))
	h.Write(meta[:])
	h.Write(prev)
	for i := 0; i < n; i++ {
		h.Write(labels[i][:])
	}
	out := make([]byte, Block)
	copy(out, h.Sum(nil))
	return out, nil
}

// splitBlocks partitions chunk into 32-byte nodes. The final node is
// zero-padded. An empty chunk is one all-zero node so the stack still
// has a defined root. Padding is local to the hash; it is not appended
// to the stored chunk.
func splitBlocks(chunk []byte) [][Block]byte {
	if len(chunk) == 0 {
		return [][Block]byte{{}}
	}
	n := (len(chunk) + Block - 1) / Block
	out := make([][Block]byte, n)
	for i := 0; i < n; i++ {
		start := i * Block
		end := start + Block
		if end > len(chunk) {
			end = len(chunk)
		}
		copy(out[i][:], chunk[start:end])
	}
	return out
}
