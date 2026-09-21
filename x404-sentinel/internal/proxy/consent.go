package proxy

import "github.com/masterledgerlive/x404-sentinel/internal/zk"

// Verify_ZK_Consent checks the 448-byte envelope and nothing else.
//
// ok is true only when the transcript is self-consistent (magic, version,
// kind, binding, expansion). That is not authorization. Authorization is
// the later stacked compare against the local file (HASH_OK / HASH_FAIL).
//
// reason is "ok" or a closed failure name: empty, length, magic, version,
// kind, binding, transcript. The HTTP layer collapses every failure to
// proof_malformed and does not echo the proof.
func Verify_ZK_Consent(proofPayload []byte) (ok bool, reason string) {
	if len(proofPayload) == 0 {
		return false, "empty"
	}
	if err := zk.Structural(proofPayload); err != nil {
		return false, err.Error()
	}
	return true, "ok"
}
