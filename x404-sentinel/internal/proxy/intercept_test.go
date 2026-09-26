package proxy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/masterledgerlive/x404-sentinel/internal/zk"
)

func TestIntercept_NoProofStaysHidden(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/container/apollo11-sstv", nil)
	ic := Intercept_404(req)
	if ic.HasProof || len(ic.Proof) != 0 || ic.ProofErr != "" {
		t.Fatalf("%+v", ic)
	}
	if !ic.IDValid || ic.ContainerID != IDApollo {
		t.Fatalf("id %+v", ic)
	}
}

func TestIntercept_HeaderAndQuery(t *testing.T) {
	good := strings.Repeat("ab", zk.KeySize)
	req := httptest.NewRequest(http.MethodGet, "/container/apollo11-sstv?proof=ff", nil)
	req.Header.Set("X-Sentinel-Proof", good)
	ic := Intercept_404(req)
	if !ic.HasProof || ic.ProofErr != "" || len(ic.Proof) != zk.KeySize {
		t.Fatalf("%+v len %d", ic, len(ic.Proof))
	}
	// Header wins: the query value ff is one byte and would have failed length.
	if ic.Proof[0] != 0xab {
		t.Fatalf("header did not win: %x", ic.Proof[0])
	}
}

func TestIntercept_QueryProof(t *testing.T) {
	raw := strings.Repeat("cd", zk.KeySize)
	req := httptest.NewRequest(http.MethodGet, "/container/apollo11-sstv?proof="+raw, nil)
	ic := Intercept_404(req)
	if !ic.HasProof || len(ic.Proof) != zk.KeySize || ic.Proof[0] != 0xcd {
		t.Fatalf("%+v", ic)
	}
}

func TestIntercept_BadHexIsFailClosed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/container/apollo11-sstv", nil)
	req.Header.Set("X-Sentinel-Proof", "zzzz")
	ic := Intercept_404(req)
	if !ic.HasProof || ic.ProofErr != "hex" || ic.Proof != nil {
		t.Fatalf("%+v", ic)
	}
	req = httptest.NewRequest(http.MethodGet, "/container/apollo11-sstv", nil)
	req.Header.Set("X-Sentinel-Proof", "abcd") // 2 bytes, wrong width
	ic = Intercept_404(req)
	if ic.ProofErr != "length" {
		t.Fatalf("%+v", ic)
	}
}

func TestIntercept_RejectsTraversalID(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/container/../testdata/apollo11-sstv.webm", nil)
	// The raw path is not cleaned by httptest. The parser must not treat
	// a slash-bearing tail as an id.
	ic := Intercept_404(req)
	if ic.IDValid || ic.ContainerID != "" {
		t.Fatalf("traversal id accepted: %+v", ic)
	}
}

func TestDecodeProofHex_PrefixAndWhitespace(t *testing.T) {
	raw := "0x" + strings.Repeat("aa", zk.KeySize)
	raw = raw[:8] + "\n" + raw[8:]
	buf, errReason := DecodeProofHex(raw)
	if errReason != "" || len(buf) != zk.KeySize {
		t.Fatalf("%s %d", errReason, len(buf))
	}
}
