package proxy

import (
	"bytes"
	"encoding/json"
	"sync"
	"testing"
)

func TestTelemetry_CanonicalHookAndRing(t *testing.T) {
	var log bytes.Buffer
	tel := NewTelemetry(4, &log)
	for i := 0; i < 6; i++ {
		tel.Emit_Agentic_Telemetry(StateIntercepted, "wrong-hook", Meta{ContainerID: IDApollo, Detail: DetailIntercepted})
	}
	ev := tel.Snapshot()
	if len(ev) != 4 {
		t.Fatalf("len %d", len(ev))
	}
	if ev[0].Seq != 3 || ev[len(ev)-1].Seq != 6 {
		t.Fatalf("seq window %+v %+v", ev[0], ev[len(ev)-1])
	}
	for _, e := range ev {
		if e.VisualHook != "agent-intercept" {
			t.Fatalf("hook %s", e.VisualHook)
		}
		if e.ContainerID != IDApollo || e.State != StateIntercepted {
			t.Fatalf("%+v", e)
		}
	}
	lines := bytes.Split(bytes.TrimSpace(log.Bytes()), []byte("\n"))
	if len(lines) != 6 {
		t.Fatalf("log lines %d", len(lines))
	}
	var parsed Event
	if err := json.Unmarshal(lines[0], &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.VisualHook != "agent-intercept" {
		t.Fatal(parsed.VisualHook)
	}
}

func TestTelemetry_Concurrent(t *testing.T) {
	tel := NewTelemetry(128, nil)
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			tel.Emit_Agentic_Telemetry(StateHashOK, "agent-unlock", Meta{ContainerID: IDApollo, OK: true, Detail: DetailHashOK})
		}()
	}
	wg.Wait()
	ev := tel.Snapshot()
	if len(ev) != 40 {
		t.Fatalf("len %d", len(ev))
	}
	seen := map[int64]bool{}
	for _, e := range ev {
		if seen[e.Seq] {
			t.Fatal("duplicate seq")
		}
		seen[e.Seq] = true
		if e.VisualHook != "agent-unlock" {
			t.Fatal(e.VisualHook)
		}
	}
}

func TestVisualHookTable(t *testing.T) {
	pairs := map[string]string{
		StateHidden:         "agent-intercept",
		StateIntercepted:    "agent-intercept",
		StateConsentPending: "agent-verify",
		StateConsentOK:      "agent-verify",
		StateConsentFail:    "agent-verify",
		StateRegistryHit:    "agent-registry",
		StateRegistryMiss:   "agent-registry",
		StateHashOK:         "agent-unlock",
		StateHashFail:       "agent-unlock",
		StateX402Inject:     "agent-inject",
		StateStreaming:      "agent-inject",
	}
	for state, hook := range pairs {
		if VisualHook(state) != hook {
			t.Fatalf("%s -> %s", state, VisualHook(state))
		}
	}
}
