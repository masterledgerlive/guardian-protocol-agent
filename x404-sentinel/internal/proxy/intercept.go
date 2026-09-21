package proxy

import (
	"encoding/hex"
	"net/http"
	"regexp"
	"strings"

	"github.com/masterledgerlive/x404-sentinel/internal/zk"
)

// idPattern is the only container id shape the proxy will look up.
// 1 to 64 characters, ASCII letters, digits, dot, underscore, hyphen.
// A 64-character sha256 hex string matches and is the content-address
// alternate key. Slashes and traversal segments do not match.
var idPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)

// Intercept is the result of Intercept_404. Proof bytes are present only
// when the client actually sent a decodable 448-byte key. ProofErr is a
// closed reason (empty, length, hex) when a proof field was sent but could
// not be decoded. The intercept step never reads the registry and never
// writes a response.
type Intercept struct {
	ContainerID string
	IDValid     bool
	HasProof    bool
	Proof       []byte
	ProofErr    string
}

// Intercept_404 reads a retrieval attempt. The container stays hidden
// until a later step accepts the key. This function does not return
// payload bytes and does not log the proof.
//
// Proof source, in order: header X-Sentinel-Proof, else query proof.
// If the header is present it wins even when it is empty or invalid;
// the query is then ignored.
func Intercept_404(r *http.Request) Intercept {
	if r == nil {
		return Intercept{}
	}
	id := r.PathValue("id")
	if id == "" {
		id = idFromPath(r.URL.Path)
	}
	out := Intercept{
		ContainerID: id,
		IDValid:     idPattern.MatchString(id),
	}
	present, raw := proofRaw(r)
	if !present {
		return out
	}
	out.HasProof = true
	proof, errReason := DecodeProofHex(raw)
	if errReason != "" {
		out.ProofErr = errReason
		return out
	}
	out.Proof = proof
	return out
}

// DecodeProofHex parses a client key. Whitespace is ignored. A single
// leading 0x is ignored. The decoded length must be exactly 448 bytes.
// Fail closed on anything else. The returned reason is empty on success.
func DecodeProofHex(raw string) ([]byte, string) {
	s := strings.TrimSpace(raw)
	if len(s) > 4096 {
		return nil, "length"
	}
	if strings.HasPrefix(s, "0x") || strings.HasPrefix(s, "0X") {
		s = s[2:]
	}
	s = strings.Map(func(r rune) rune {
		switch r {
		case ' ', '\n', '\r', '\t':
			return -1
		default:
			return r
		}
	}, s)
	if s == "" {
		return nil, "empty"
	}
	if len(s) > 2048 || len(s)%2 != 0 {
		return nil, "length"
	}
	buf, err := hex.DecodeString(s)
	if err != nil {
		return nil, "hex"
	}
	if len(buf) != zk.KeySize {
		return nil, "length"
	}
	return buf, ""
}

func proofRaw(r *http.Request) (bool, string) {
	if vals, ok := r.Header["X-Sentinel-Proof"]; ok {
		if len(vals) == 0 {
			return true, ""
		}
		return true, vals[0]
	}
	if vals, ok := r.URL.Query()["proof"]; ok {
		if len(vals) == 0 {
			return true, ""
		}
		return true, vals[0]
	}
	return false, ""
}

func idFromPath(path string) string {
	for _, prefix := range []string{"/container/", "/registry/"} {
		if !strings.HasPrefix(path, prefix) {
			continue
		}
		rest := strings.TrimPrefix(path, prefix)
		if rest == "" || strings.Contains(rest, "/") {
			return ""
		}
		return rest
	}
	return ""
}

// PublicID is the id safe to echo in JSON. Invalid ids are blank so a
// crafted path cannot be reflected.
func (ic Intercept) PublicID() string {
	if ic.IDValid {
		return ic.ContainerID
	}
	return ""
}
