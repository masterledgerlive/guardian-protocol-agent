package proxy

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func moduleRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
}

func fixtureServer(t *testing.T) (*Server, *Registry) {
	t.Helper()
	root := moduleRoot(t)
	reg := NewRegistry()
	if err := LoadFixtures(reg, root); err != nil {
		t.Fatal(err)
	}
	return NewServer(reg, NewTelemetry(256, nil), root), reg
}

func TestApollo11_Roundtrip(t *testing.T) {
	root := moduleRoot(t)
	srv, reg := fixtureServer(t)
	file, err := os.ReadFile(filepath.Join(root, "testdata", "apollo11-sstv.webm"))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(file)
	wantSHA := hex.EncodeToString(sum[:])
	catalog, err := os.ReadFile(filepath.Join(root, "testdata", "CATALOG.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(catalog, []byte(wantSHA)) {
		t.Fatalf("catalog missing sha256 %s", wantSHA)
	}
	if !bytes.Contains(catalog, []byte("76211")) {
		t.Fatal("catalog missing byte size")
	}
	src, err := os.ReadFile(filepath.Join(root, "testdata", "src", "Apollo_11_Landing_-_first_steps_on_the_moon.ogv"))
	if err != nil {
		t.Fatal(err)
	}
	srcSum := sha256.Sum256(src)
	if !bytes.Contains(catalog, []byte(hex.EncodeToString(srcSum[:]))) {
		t.Fatal("catalog missing source sha256")
	}

	// (a) no proof → 404 and no video bytes
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/container/apollo11-sstv", nil)
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("bare status %d body %s", rr.Code, rr.Body.Bytes())
	}
	assertNoPayload(t, rr.Body.Bytes(), file)
	var hidden statusBody
	if err := json.Unmarshal(rr.Body.Bytes(), &hidden); err != nil {
		t.Fatal(err)
	}
	if hidden.OK || hidden.State != StateHidden || hidden.Reason != ReasonSealed {
		t.Fatalf("%+v", hidden)
	}
	if rr.Header().Get("X-X402-Injection") != "" {
		t.Fatal("x402 header on a 404")
	}

	// (b) mint the real key from the file
	c, ok := ContainerByID(reg, IDApollo)
	if !ok {
		t.Fatal("apollo missing")
	}
	proof := hex.EncodeToString(c.SealCopy())
	if len(c.Seal) != 448 {
		t.Fatalf("seal %d", len(c.Seal))
	}
	if ok, reason := Verify_ZK_Consent(c.SealCopy()); !ok || reason != "ok" {
		t.Fatalf("consent %v %s", ok, reason)
	}

	// consent POST, then retrieve
	consentBody := `{"id":"apollo11-sstv","proofHex":"` + proof + `"}`
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/consent", strings.NewReader(consentBody))
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("consent %d %s", rr.Code, rr.Body.Bytes())
	}
	var consented statusBody
	if err := json.Unmarshal(rr.Body.Bytes(), &consented); err != nil {
		t.Fatal(err)
	}
	if !consented.OK || consented.State != StateHashOK {
		t.Fatalf("%+v", consented)
	}
	assertNoPayload(t, rr.Body.Bytes(), file)

	// (c) GET with proof → 200 and the catalog sha256
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/container/apollo11-sstv", nil)
	req.Header.Set("X-Sentinel-Proof", proof)
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("solve %d %s", rr.Code, rr.Body.Bytes())
	}
	if rr.Header().Get("Content-Type") != "video/webm" {
		t.Fatal(rr.Header().Get("Content-Type"))
	}
	if rr.Header().Get("X-X402-Injection") != "stream" {
		t.Fatal("injection header")
	}
	got := sha256.Sum256(rr.Body.Bytes())
	if hex.EncodeToString(got[:]) != wantSHA || !bytes.Equal(rr.Body.Bytes(), file) {
		t.Fatalf("body mismatch got %x", got)
	}

	// query-string proof also unlocks
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/container/apollo11-sstv?proof="+proof, nil)
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || !bytes.Equal(rr.Body.Bytes(), file) {
		t.Fatalf("query proof %d", rr.Code)
	}

	// (d) wrong key stays 404 and leaks no video bytes
	wrong := []byte(proof)
	if wrong[len(wrong)-1] == '0' {
		wrong[len(wrong)-1] = '1'
	} else {
		wrong[len(wrong)-1] = '0'
	}
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/container/apollo11-sstv", nil)
	req.Header.Set("X-Sentinel-Proof", string(wrong))
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("wrong key %d", rr.Code)
	}
	assertNoPayload(t, rr.Body.Bytes(), file)
	var failed statusBody
	if err := json.Unmarshal(rr.Body.Bytes(), &failed); err != nil {
		t.Fatal(err)
	}
	if failed.OK || (failed.State != StateConsentFail && failed.State != StateHashFail) {
		t.Fatalf("%+v", failed)
	}

	// success telemetry walks the machine and never contains the seal
	ev := srv.tele.Snapshot()
	states := map[string]bool{}
	blob, _ := json.Marshal(ev)
	if bytes.Contains(blob, []byte(proof)) {
		t.Fatal("telemetry contained the seal")
	}
	for _, e := range ev {
		states[e.State] = true
	}
	for _, need := range []string{StateIntercepted, StateHidden, StateConsentPending, StateConsentOK, StateRegistryHit, StateHashOK, StateX402Inject, StateStreaming, StateConsentFail} {
		// The last request is the wrong key, so CONSENT_FAIL or HASH_FAIL
		// is present. CONSENT_FAIL is the flipped-envelope case.
		if need == StateConsentFail {
			if !states[StateConsentFail] && !states[StateHashFail] {
				t.Fatal("missing failure state")
			}
			continue
		}
		if !states[need] {
			t.Fatalf("missing state %s", need)
		}
	}
}

func TestRegistryEndpoint_OmitsBytes(t *testing.T) {
	root := moduleRoot(t)
	srv, _ := fixtureServer(t)
	file, err := os.ReadFile(filepath.Join(root, "testdata", "apollo11-sstv.webm"))
	if err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/registry/apollo11-sstv", nil)
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("%d %s", rr.Code, rr.Body.Bytes())
	}
	assertNoPayload(t, rr.Body.Bytes(), file)
	var meta Metadata
	if err := json.Unmarshal(rr.Body.Bytes(), &meta); err != nil {
		t.Fatal(err)
	}
	if meta.PHI || meta.ID != IDApollo || meta.MIME != "video/webm" || meta.Size != len(file) || meta.CellCount < 2 {
		t.Fatalf("%+v", meta)
	}
	sum := sha256.Sum256(file)
	if meta.SHA256 != hex.EncodeToString(sum[:]) {
		t.Fatalf("sha %s", meta.SHA256)
	}
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/registry/"+meta.SHA256, nil)
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatal(rr.Code)
	}
	assertNoPayload(t, rr.Body.Bytes(), file)
}

func TestShim_SyntheticNotPHI(t *testing.T) {
	root := moduleRoot(t)
	srv, reg := fixtureServer(t)
	file, err := os.ReadFile(filepath.Join(root, "testdata", "mri-shim.bin"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(file, []byte("NOT-PHI")) {
		t.Fatal("shim missing NOT-PHI label")
	}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/container/mri-shim", nil)
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatal(rr.Code)
	}
	assertNoPayload(t, rr.Body.Bytes(), file)
	c, ok := ContainerByID(reg, IDShim)
	if !ok || !c.Synthetic {
		t.Fatal("shim")
	}
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/container/mri-shim", nil)
	req.Header.Set("X-Sentinel-Proof", hex.EncodeToString(c.SealCopy()))
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || !bytes.Equal(rr.Body.Bytes(), file) {
		t.Fatalf("shim solve %d", rr.Code)
	}
	meta, ok := reg.Query_x404_Registry(IDShim)
	if !ok || meta.PHI || meta.Classification != "NOT-PHI" || !meta.Synthetic {
		t.Fatalf("%+v", meta)
	}
}

func TestRoutes_HealthUIMediaTelemetry(t *testing.T) {
	root := moduleRoot(t)
	srv, reg := fixtureServer(t)
	if err := VerifyFilings(reg, root); err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rr.Code != http.StatusOK || !bytes.Contains(rr.Body.Bytes(), []byte(`"phi":false`)) || !bytes.Contains(rr.Body.Bytes(), []byte(`"chain":"none"`)) {
		t.Fatalf("health %d %s", rr.Code, rr.Body.Bytes())
	}
	for _, path := range []string{"/", "/ui"} {
		rr = httptest.NewRecorder()
		srv.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, path, nil))
		if rr.Code != http.StatusOK {
			t.Fatalf("%s %d", path, rr.Code)
		}
		html := rr.Body.String()
		if !strings.Contains(html, "apollo11-sstv") || !strings.Contains(html, `preload="none"`) {
			t.Fatal("ui missing container or preload")
		}
		if strings.Contains(html, `src="/container`) || strings.Contains(html, `src='/container`) {
			t.Fatal("ui auto-points the video at the container")
		}
		for _, hook := range []string{"agent-intercept", "agent-verify", "agent-registry", "agent-unlock", "agent-inject"} {
			if !strings.Contains(html, hook) {
				t.Fatalf("ui missing %s", hook)
			}
		}
	}
	rr = httptest.NewRecorder()
	srv.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/media/apollo11-sstv.proof.hex", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("proof media %d %s", rr.Code, rr.Body.Bytes())
	}
	c, _ := ContainerByID(reg, IDApollo)
	if strings.TrimSpace(rr.Body.String()) != hex.EncodeToString(c.Seal) {
		t.Fatal("demo proof mismatch")
	}
	rr = httptest.NewRecorder()
	srv.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/telemetry", nil))
	if rr.Code != http.StatusOK || !bytes.Contains(rr.Body.Bytes(), []byte(`"events"`)) {
		t.Fatalf("telemetry %s", rr.Body.Bytes())
	}
	rr = httptest.NewRecorder()
	srv.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/health", nil))
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("method %d", rr.Code)
	}
	rr = httptest.NewRecorder()
	srv.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/consent", strings.NewReader(`{"id":"apollo11-sstv","proofHex":"aa","extra":1}`)))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("bad consent %d %s", rr.Code, rr.Body.Bytes())
	}
	rr = httptest.NewRecorder()
	srv.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/nope", nil))
	if rr.Code != http.StatusNotFound {
		t.Fatal(rr.Code)
	}
}

func TestUI_DoesNotPrefetchContainer(t *testing.T) {
	root := moduleRoot(t)
	html, err := os.ReadFile(filepath.Join(root, "public", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	// The container URL may appear only inside the click handler. It must
	// not be a video src, a preload, or a module that runs on parse without
	// a click. This scan rejects the attributes that would fetch on load.
	s := string(html)
	for _, banned := range []string{`src="/container`, `src='/container`, `preload="/container`, `href="/container`} {
		if strings.Contains(s, banned) {
			t.Fatalf("found %s", banned)
		}
	}
	if !strings.Contains(s, "addEventListener") || !strings.Contains(s, "/consent") {
		t.Fatal("solve handler missing")
	}
}

func assertNoPayload(t *testing.T, body, payload []byte) {
	t.Helper()
	if bytes.Contains(body, []byte{0x1a, 0x45, 0xdf, 0xa3}) && bytes.HasPrefix(payload, []byte{0x1a, 0x45, 0xdf, 0xa3}) {
		// JSON could theoretically include the magic only if we leaked
		// the file. A 404/metadata body must not contain the EBML magic.
		t.Fatal("response contained WebM EBML magic")
	}
	if len(payload) >= 64 && bytes.Contains(body, payload[:64]) {
		t.Fatal("response contained payload prefix")
	}
	if len(body) > 0 && bytes.Equal(body, payload) {
		t.Fatal("response was the payload")
	}
}
