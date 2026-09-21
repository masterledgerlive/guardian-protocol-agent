package proxy

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
)

// DataChunk is the verified object handed to x402 injection.
//
// Cells are ordered grouped slices whose concatenation is the container.
// The handler must run HashCheck before calling Execute_x402_Injection.
// This function does not re-check the proof; it is the byte-release step
// only, so callers must not reach it on a failed state.
type DataChunk struct {
	MIME        string
	ContainerID string
	SHA256Hex   string
	Cells       [][]byte
}

// Execute_x402_Injection writes an authorized container as an HTTP 200
// body. "x402" here is the name of the authenticated retrieval step: the
// 404 becomes a byte stream. This is not the Coinbase HTTP 402 payment
// protocol, and this function does not emit a payment invoice or a
// transaction hash.
//
// Headers are set before the first payload byte. On an empty chunk the
// function returns an error and writes nothing.
func Execute_x402_Injection(w http.ResponseWriter, dataChunk DataChunk) error {
	if w == nil {
		return errors.New("x402: nil writer")
	}
	if dataChunk.MIME == "" || dataChunk.ContainerID == "" || dataChunk.SHA256Hex == "" {
		return errors.New("x402: incomplete chunk")
	}
	total := 0
	for _, c := range dataChunk.Cells {
		if len(c) == 0 {
			return errors.New("x402: empty cell")
		}
		total += len(c)
	}
	if total == 0 {
		return errors.New("x402: empty chunk")
	}
	h := w.Header()
	h.Set("Content-Type", dataChunk.MIME)
	h.Set("Content-Length", strconv.Itoa(total))
	h.Set("X-X402-Injection", "stream")
	h.Set("X-Sentinel-State", StateStreaming)
	h.Set("X-Sentinel-Container", dataChunk.ContainerID)
	h.Set("X-Content-SHA256", dataChunk.SHA256Hex)
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", dataChunk.ContainerID))
	w.WriteHeader(http.StatusOK)
	for _, c := range dataChunk.Cells {
		if _, err := w.Write(c); err != nil {
			return err
		}
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
	return nil
}
