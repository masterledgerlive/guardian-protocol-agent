//! Proven Player access gate for a libVLC build.
//!
//! This is the native twin of `vita/proven-player-verify.js`. It does not
//! link feed, kids, or token players. The host configures libVLC with dav2d
//! (`--codec dav2d,any`) and calls `unlock_for_dav2d`.
//!
//! dav2d is VideoLAN's AV2 decoder. As of this seal it is still tracking the
//! AV2 v1.0.0 spec, so the bytes this gate releases were conformance-decoded
//! with avmdec from AVM v1.0.0, not with dav2d.
//!
//! The function below is the interception point:
//!   1. Read the AV2 IVF chunk and the 448-byte envelope from the registry.
//!   2. Refuse the buffer when the chunk binding fails.
//!   3. Return the same bytes so the demuxer can hand them to dav2d.
//!
//! SHA-256 lives in the JS verifier that the browser and the tests run.

const ENVELOPE_BYTES: usize = 448;
const GROTH16_SLOT: usize = 176;
const GROTH16_BYTES: usize = 256;

#[derive(Debug, PartialEq, Eq)]
pub enum Unlock {
    /// AV2 bytes may be passed to dav2d.
    Ready,
    /// Keep the buffer. Do not decode.
    Hold(&'static str),
}

/// Custom access/demux hook. `envelope` is the registry receipt.
/// `binding_matches` is the result of SHA-256(envelope) == registry binding,
/// computed by the same verifier as the browser.
pub fn unlock_for_dav2d(envelope: &[u8], binding_matches: bool, bitstream_matches: bool) -> Unlock {
    if envelope.len() != ENVELOPE_BYTES {
        return Unlock::Hold("envelope-length");
    }
    if &envelope[0..4] != b"ZKAV" {
        return Unlock::Hold("magic");
    }
    if envelope[4] != 1 {
        return Unlock::Hold("version");
    }
    // Bit 0 set means someone claimed a Groth16. We have no verifier.
    if envelope[5] & 0x01 == 0x01 {
        return Unlock::Hold("groth16-unwired");
    }
    if envelope[GROTH16_SLOT..GROTH16_SLOT + GROTH16_BYTES]
        .iter()
        .any(|b| *b != 0)
    {
        return Unlock::Hold("groth16-unwired");
    }
    if !binding_matches {
        return Unlock::Hold("binding-mismatch");
    }
    if !bitstream_matches {
        return Unlock::Hold("bitstream-digest");
    }
    Unlock::Ready
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_when_the_slot_is_stuffed() {
        let mut env = vec![0u8; ENVELOPE_BYTES];
        env[0..4].copy_from_slice(b"ZKAV");
        env[4] = 1;
        env[GROTH16_SLOT] = 1;
        assert_eq!(
            unlock_for_dav2d(&env, true, true),
            Unlock::Hold("groth16-unwired")
        );
    }

    #[test]
    fn ready_only_after_both_digests_match() {
        let mut env = vec![0u8; ENVELOPE_BYTES];
        env[0..4].copy_from_slice(b"ZKAV");
        env[4] = 1;
        assert_eq!(
            unlock_for_dav2d(&env, true, true),
            Unlock::Ready
        );
        assert_eq!(
            unlock_for_dav2d(&env, false, true),
            Unlock::Hold("binding-mismatch")
        );
    }
}
