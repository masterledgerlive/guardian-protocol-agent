package proxy

// Retrieval states. SENTINEL.md is the contract. The resting state of every
// container is HIDDEN: the HTTP response is 404 and no payload bytes are
// written. A request emits INTERCEPTED first. HIDDEN is emitted again only
// when the attempt ends without a proof.
const (
	StateHidden         = "HIDDEN"
	StateIntercepted    = "INTERCEPTED"
	StateConsentPending = "CONSENT_PENDING"
	StateConsentOK      = "CONSENT_OK"
	StateConsentFail    = "CONSENT_FAIL"
	StateRegistryHit    = "REGISTRY_HIT"
	StateRegistryMiss   = "REGISTRY_MISS"
	StateHashOK         = "HASH_OK"
	StateHashFail       = "HASH_FAIL"
	StateX402Inject     = "X402_INJECT"
	StateStreaming      = "STREAMING"
)

// Reason codes returned in JSON. They are stable; UI and tests match them.
const (
	ReasonSealed           = "sealed"
	ReasonProofMalformed   = "proof_malformed"
	ReasonRegistryMiss     = "registry_miss"
	ReasonHashFail         = "hash_fail"
	ReasonHashOK           = "hash_ok"
	ReasonBadRequest       = "bad_request"
	ReasonMethodNotAllowed = "method_not_allowed"
	ReasonNotFound         = "not_found"
)

// Detail strings are operator-facing and contain no proof bytes and no
// payload bytes.
const (
	DetailIntercepted    = "404 intercepted"
	DetailSealed         = "container is hidden until a consent key is presented"
	DetailConsentPending = "consent key presented; verifying envelope"
	DetailConsentOK      = "consent envelope accepted"
	DetailConsentFail    = "consent key rejected"
	DetailRegistryHit    = "local content commit found"
	DetailRegistryMiss   = "no local content commit"
	DetailHashOK         = "stacked commitment matched"
	DetailHashFail       = "stacked commitment rejected"
	DetailInject         = "x402 injection started"
	DetailStreaming      = "bytes streaming"
	DetailBadRequest     = "consent body must be a JSON object with id and proofHex"
	DetailMethod         = "method not allowed"
	DetailRoute          = "no such route"
)

// VisualHook is the canonical animation name for a state. The map is
// authoritative: telemetry overwrites a mismatched hook with this value.
func VisualHook(state string) string {
	switch state {
	case StateHidden, StateIntercepted:
		return "agent-intercept"
	case StateConsentPending, StateConsentOK, StateConsentFail:
		return "agent-verify"
	case StateRegistryHit, StateRegistryMiss:
		return "agent-registry"
	case StateHashOK, StateHashFail:
		return "agent-unlock"
	case StateX402Inject, StateStreaming:
		return "agent-inject"
	default:
		return "agent-intercept"
	}
}

// Version is the proxy build reported by GET /health.
const Version = "1.0.0"
