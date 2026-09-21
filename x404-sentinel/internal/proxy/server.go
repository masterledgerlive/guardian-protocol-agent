// Package proxy is the x404 sentinel HTTP machine.
//
// A container is hidden (HTTP 404) until the client presents a 448-byte
// consent key that matches the key recomputed from the local file. Failed
// states write a small JSON document and never the payload. The successful
// state streams the grouped cells through Execute_x402_Injection.
//
// SENTINEL.md is the interface contract. This package does not import any
// sibling project and does not talk to a chain.
package proxy

import (
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Server is the proxy handler. It is safe for concurrent requests.
type Server struct {
	reg  *Registry
	tele *Telemetry
	root string
}

// NewServer binds a registry, a telemetry log, and the project root that
// holds public/ and testdata/.
func NewServer(reg *Registry, tele *Telemetry, root string) *Server {
	if tele == nil {
		tele = NewTelemetry(256, nil)
	}
	return &Server{reg: reg, tele: tele, root: root}
}

// ServeHTTP dispatches the routes in SENTINEL.md. Unknown paths are a
// JSON 404 with no payload. Wrong methods are a JSON 405 with no payload.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	path := r.URL.Path
	switch {
	case path == "/health":
		if r.Method != http.MethodGet {
			s.methodNotAllowed(w)
			return
		}
		s.serveHealth(w, r)
	case path == "/telemetry":
		if r.Method != http.MethodGet {
			s.methodNotAllowed(w)
			return
		}
		s.serveTelemetry(w, r)
	case path == "/consent":
		if r.Method != http.MethodPost {
			s.methodNotAllowed(w)
			return
		}
		s.serveConsent(w, r)
	case path == "/" || path == "/ui" || path == "/ui/":
		if r.Method != http.MethodGet {
			s.methodNotAllowed(w)
			return
		}
		s.serveIndex(w, r)
	case strings.HasPrefix(path, "/container/"):
		if r.Method != http.MethodGet {
			s.methodNotAllowed(w)
			return
		}
		s.serveContainer(w, r)
	case strings.HasPrefix(path, "/registry/"):
		if r.Method != http.MethodGet {
			s.methodNotAllowed(w)
			return
		}
		s.serveRegistry(w, r)
	case strings.HasPrefix(path, "/media/"):
		if r.Method != http.MethodGet {
			s.methodNotAllowed(w)
			return
		}
		s.serveMedia(w, r)
	default:
		s.notFound(w)
	}
}

func (s *Server) serveHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"service": "x404-sentinel",
		"version": Version,
		"phi":     false,
		"chain":   "none",
		"commits": "local-sha256",
	})
}

func (s *Server) serveTelemetry(w http.ResponseWriter, r *http.Request) {
	// Reading telemetry must not append an event, or the UI poll would
	// feed itself.
	ev := s.tele.Snapshot()
	if ev == nil {
		ev = []Event{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": ev})
}

func (s *Server) serveIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, filepath.Join(s.root, "public", "index.html"))
}

func (s *Server) serveMedia(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/media/")
	if name == "" || strings.Contains(name, "/") || !idPattern.MatchString(name) {
		s.notFound(w)
		return
	}
	// idPattern allows dots, so a file such as apollo11-sstv.proof.hex
	// matches. ".." does not, because the pattern cannot start with a dot
	// and cannot contain a slash. Still confine the open to public/.
	pub := filepath.Join(s.root, "public")
	full := filepath.Join(pub, name)
	rel, err := filepath.Rel(pub, full)
	if err != nil || strings.HasPrefix(rel, "..") || rel == "." {
		s.notFound(w)
		return
	}
	f, err := os.Open(full)
	if err != nil {
		s.notFound(w)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		s.notFound(w)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, name, st.ModTime(), f)
}

func (s *Server) serveRegistry(w http.ResponseWriter, r *http.Request) {
	ic := Intercept_404(r)
	id := ic.PublicID()
	if !ic.IDValid {
		s.tele.Emit_Agentic_Telemetry(StateRegistryMiss, VisualHook(StateRegistryMiss), Meta{
			Detail: DetailRegistryMiss,
		})
		writeStatus(w, http.StatusNotFound, statusBody{
			OK: false, Reason: ReasonRegistryMiss, State: StateRegistryMiss, Detail: DetailRegistryMiss,
		})
		return
	}
	meta, ok := s.reg.Query_x404_Registry(ic.ContainerID)
	if !ok {
		s.tele.Emit_Agentic_Telemetry(StateRegistryMiss, VisualHook(StateRegistryMiss), Meta{
			ContainerID: id, Detail: DetailRegistryMiss,
		})
		writeStatus(w, http.StatusNotFound, statusBody{
			OK: false, Reason: ReasonRegistryMiss, State: StateRegistryMiss, ID: id, Detail: DetailRegistryMiss,
		})
		return
	}
	s.tele.Emit_Agentic_Telemetry(StateRegistryHit, VisualHook(StateRegistryHit), Meta{
		ContainerID: meta.ID, Detail: DetailRegistryHit, OK: true,
	})
	writeJSON(w, http.StatusOK, meta)
}

func (s *Server) serveContainer(w http.ResponseWriter, r *http.Request) {
	ic := Intercept_404(r)
	st, c := s.solve(ic)
	if c == nil {
		writeStatus(w, http.StatusNotFound, st)
		return
	}
	cells := c.CellSlices()
	if len(cells) == 0 {
		s.tele.Emit_Agentic_Telemetry(StateHashFail, VisualHook(StateHashFail), Meta{
			ContainerID: c.ID, Detail: DetailHashFail,
		})
		writeStatus(w, http.StatusNotFound, statusBody{
			OK: false, Reason: ReasonHashFail, State: StateHashFail, ID: c.ID, Detail: DetailHashFail,
		})
		return
	}
	s.tele.Emit_Agentic_Telemetry(StateX402Inject, VisualHook(StateX402Inject), Meta{
		ContainerID: c.ID, Detail: DetailInject, OK: true,
	})
	err := Execute_x402_Injection(w, DataChunk{
		MIME:        c.MIME,
		ContainerID: c.ID,
		SHA256Hex:   hex.EncodeToString(c.SHA256),
		Cells:       cells,
	})
	if err != nil {
		// Status is already 200 if the writer flushed. There is no safe
		// way to turn the response into a 404 after payload bytes. Callers
		// only reach here after HashCheck, so this is a transport error.
		return
	}
	s.tele.Emit_Agentic_Telemetry(StateStreaming, VisualHook(StateStreaming), Meta{
		ContainerID: c.ID, Detail: DetailStreaming, OK: true,
	})
}

func (s *Server) serveConsent(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<16)
	var req struct {
		ID       string `json:"id"`
		ProofHex string `json:"proofHex"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeStatus(w, http.StatusBadRequest, statusBody{
			OK: false, Reason: ReasonBadRequest, State: StateConsentFail, Detail: DetailBadRequest,
		})
		return
	}
	var extra struct{}
	if err := dec.Decode(&extra); err != io.EOF {
		writeStatus(w, http.StatusBadRequest, statusBody{
			OK: false, Reason: ReasonBadRequest, State: StateConsentFail, Detail: DetailBadRequest,
		})
		return
	}
	ic := interceptFromParts(req.ID, req.ProofHex)
	st, c := s.solve(ic)
	if c == nil {
		code := http.StatusNotFound
		writeStatus(w, code, st)
		return
	}
	// Consent does not inject. HASH_OK means the key matches; the bytes
	// stay on the container route.
	writeStatus(w, http.StatusOK, st)
}

// solve runs the machine from INTERCEPTED through HASH_OK or a terminal
// failure. A non-nil container means HASH_OK and the caller may inject.
// Every failure returns a status body and a nil container.
func (s *Server) solve(ic Intercept) (statusBody, *Container) {
	id := ic.PublicID()
	s.tele.Emit_Agentic_Telemetry(StateIntercepted, VisualHook(StateIntercepted), Meta{
		ContainerID: id, Detail: DetailIntercepted,
	})
	if !ic.HasProof {
		s.tele.Emit_Agentic_Telemetry(StateHidden, VisualHook(StateHidden), Meta{
			ContainerID: id, Detail: DetailSealed,
		})
		return statusBody{
			OK: false, Reason: ReasonSealed, State: StateHidden, ID: id, Detail: DetailSealed,
		}, nil
	}
	s.tele.Emit_Agentic_Telemetry(StateConsentPending, VisualHook(StateConsentPending), Meta{
		ContainerID: id, Detail: DetailConsentPending,
	})
	if ic.ProofErr != "" {
		s.tele.Emit_Agentic_Telemetry(StateConsentFail, VisualHook(StateConsentFail), Meta{
			ContainerID: id, Detail: DetailConsentFail,
		})
		return statusBody{
			OK: false, Reason: ReasonProofMalformed, State: StateConsentFail, ID: id, Detail: DetailConsentFail,
		}, nil
	}
	ok, _ := Verify_ZK_Consent(ic.Proof)
	if !ok {
		s.tele.Emit_Agentic_Telemetry(StateConsentFail, VisualHook(StateConsentFail), Meta{
			ContainerID: id, Detail: DetailConsentFail,
		})
		return statusBody{
			OK: false, Reason: ReasonProofMalformed, State: StateConsentFail, ID: id, Detail: DetailConsentFail,
		}, nil
	}
	s.tele.Emit_Agentic_Telemetry(StateConsentOK, VisualHook(StateConsentOK), Meta{
		ContainerID: id, Detail: DetailConsentOK, OK: true,
	})
	if !ic.IDValid {
		s.tele.Emit_Agentic_Telemetry(StateRegistryMiss, VisualHook(StateRegistryMiss), Meta{
			Detail: DetailRegistryMiss,
		})
		return statusBody{
			OK: false, Reason: ReasonRegistryMiss, State: StateRegistryMiss, Detail: DetailRegistryMiss,
		}, nil
	}
	c, found := s.reg.container(ic.ContainerID)
	if !found {
		s.tele.Emit_Agentic_Telemetry(StateRegistryMiss, VisualHook(StateRegistryMiss), Meta{
			ContainerID: id, Detail: DetailRegistryMiss,
		})
		return statusBody{
			OK: false, Reason: ReasonRegistryMiss, State: StateRegistryMiss, ID: id, Detail: DetailRegistryMiss,
		}, nil
	}
	// Echo the canonical id when the client looked up by sha256.
	id = c.ID
	s.tele.Emit_Agentic_Telemetry(StateRegistryHit, VisualHook(StateRegistryHit), Meta{
		ContainerID: id, Detail: DetailRegistryHit, OK: true,
	})
	if err := c.HashCheck(ic.Proof); err != nil {
		s.tele.Emit_Agentic_Telemetry(StateHashFail, VisualHook(StateHashFail), Meta{
			ContainerID: id, Detail: DetailHashFail,
		})
		return statusBody{
			OK: false, Reason: ReasonHashFail, State: StateHashFail, ID: id, Detail: DetailHashFail,
		}, nil
	}
	s.tele.Emit_Agentic_Telemetry(StateHashOK, VisualHook(StateHashOK), Meta{
		ContainerID: id, Detail: DetailHashOK, OK: true,
	})
	return statusBody{
		OK: true, Reason: ReasonHashOK, State: StateHashOK, ID: id, Detail: DetailHashOK,
	}, c
}

func interceptFromParts(id, proofHex string) Intercept {
	ic := Intercept{ContainerID: id, IDValid: idPattern.MatchString(id)}
	if strings.TrimSpace(proofHex) == "" {
		return ic
	}
	ic.HasProof = true
	proof, errReason := DecodeProofHex(proofHex)
	if errReason != "" {
		ic.ProofErr = errReason
		return ic
	}
	ic.Proof = proof
	return ic
}

type statusBody struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason"`
	State  string `json:"state"`
	ID     string `json:"id"`
	Detail string `json:"detail"`
}

func (s *Server) methodNotAllowed(w http.ResponseWriter) {
	writeStatus(w, http.StatusMethodNotAllowed, statusBody{
		OK: false, Reason: ReasonMethodNotAllowed, State: StateHidden, Detail: DetailMethod,
	})
}

func (s *Server) notFound(w http.ResponseWriter) {
	writeStatus(w, http.StatusNotFound, statusBody{
		OK: false, Reason: ReasonNotFound, State: StateHidden, Detail: DetailRoute,
	})
}

func writeStatus(w http.ResponseWriter, code int, st statusBody) {
	w.Header().Set("X-Sentinel-State", st.State)
	writeJSON(w, code, st)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	_ = enc.Encode(v)
}
