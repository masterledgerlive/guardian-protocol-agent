package proxy

import (
	"encoding/json"
	"io"
	"sync"
	"time"
)

// Meta is the context attached to one telemetry event. Detail must not
// contain a proof, a payload, or a transaction hash.
type Meta struct {
	ContainerID string
	Detail      string
	OK          bool
}

// Event is one JSON line of routing or verification. visual_hook is the
// name the UI animates. See SENTINEL.md for the map.
type Event struct {
	Seq         int64  `json:"seq"`
	TS          string `json:"ts"`
	State       string `json:"state"`
	VisualHook  string `json:"visual_hook"`
	ContainerID string `json:"container_id"`
	OK          bool   `json:"ok"`
	Detail      string `json:"detail"`
}

// Telemetry is an in-process ring of recent events plus an optional
// JSON-lines writer. The writer is how a running server emits continuous
// logs for an agentic skin. Tests pass a nil writer.
type Telemetry struct {
	mu    sync.Mutex
	cap   int
	buf   []Event
	start int
	n     int
	next  int64
	logw  io.Writer
}

// NewTelemetry keeps at most capacity events. capacity < 1 becomes 256.
func NewTelemetry(capacity int, logw io.Writer) *Telemetry {
	if capacity < 1 {
		capacity = 256
	}
	return &Telemetry{cap: capacity, logw: logw}
}

// Emit_Agentic_Telemetry appends one event.
//
// state is the machine state. visualHook is accepted for call-site
// clarity and then replaced by the canonical VisualHook(state) so a
// mismatched name cannot drive the wrong animation. meta is optional;
// only the first value is read.
func (t *Telemetry) Emit_Agentic_Telemetry(state, visualHook string, meta ...Meta) Event {
	if t == nil {
		return Event{}
	}
	hook := VisualHook(state)
	_ = visualHook // canonical map wins; argument documents the call site
	ev := Event{
		State:      state,
		VisualHook: hook,
		TS:         time.Now().UTC().Format(time.RFC3339Nano),
	}
	if len(meta) > 0 {
		ev.ContainerID = meta[0].ContainerID
		ev.Detail = meta[0].Detail
		ev.OK = meta[0].OK
	}
	t.mu.Lock()
	t.next++
	ev.Seq = t.next
	t.push(ev)
	w := t.logw
	t.mu.Unlock()
	if w != nil {
		enc := json.NewEncoder(w)
		_ = enc.Encode(ev)
	}
	return ev
}

func (t *Telemetry) push(ev Event) {
	if t.n < t.cap {
		t.buf = append(t.buf, ev)
		t.n++
		return
	}
	t.buf[t.start] = ev
	t.start = (t.start + 1) % t.cap
}

// Snapshot returns events oldest-first.
func (t *Telemetry) Snapshot() []Event {
	if t == nil {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]Event, t.n)
	if t.n == 0 {
		return out
	}
	if t.n < t.cap {
		copy(out, t.buf)
		return out
	}
	n := copy(out, t.buf[t.start:])
	copy(out[n:], t.buf[:t.start])
	return out
}
