package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestX402Injection_StreamsVerifiedCells(t *testing.T) {
	rr := httptest.NewRecorder()
	err := Execute_x402_Injection(rr, DataChunk{
		MIME:        "video/webm",
		ContainerID: IDApollo,
		SHA256Hex:   "abc",
		Cells:       [][]byte{[]byte("one"), []byte("two")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	if rr.Body.String() != "onetwo" {
		t.Fatalf("body %q", rr.Body.String())
	}
	if rr.Header().Get("X-X402-Injection") != "stream" {
		t.Fatal("missing x402 header")
	}
	if rr.Header().Get("X-Sentinel-State") != StateStreaming {
		t.Fatal("state header")
	}
	if rr.Header().Get("Content-Type") != "video/webm" {
		t.Fatal("content type")
	}
	if rr.Header().Get("X-Content-SHA256") != "abc" {
		t.Fatal("sha header")
	}
}

func TestX402Injection_RefusesEmpty(t *testing.T) {
	rr := httptest.NewRecorder()
	err := Execute_x402_Injection(rr, DataChunk{
		MIME:        "video/webm",
		ContainerID: IDApollo,
		SHA256Hex:   "abc",
	})
	if err == nil {
		t.Fatal("empty injection was accepted")
	}
	if rr.Code != http.StatusOK && rr.Body.Len() != 0 {
		t.Fatal("empty injection wrote a body")
	}
	// No WriteHeader on the refusal path, so the recorder stays at 200
	// with an empty buffer. The handler must not call inject in that case.
	if rr.Body.Len() != 0 {
		t.Fatal("bytes written")
	}
}
