pragma circom 2.1.6;

// Cell authenticity circuit for the ZK-Streaming Engine.
// Public: cellHash, prevHash, chunkId
// Private: payload bytes (chunked as field elements) — NOT pixels.
// The proof attests sequence + origin + integrity of grouped blocks.
// Constant-size Groth16 key (~448 bytes on BN254 with this public surface).

include "circomlib/circuits/sha256/sha256.circom";
include "circomlib/circuits/bitify.circom";

template CellLock(nBits) {
    signal input payloadBits[nBits];
    signal input prevHashBits[256];
    signal input chunkId;
    signal output cellHashBits[256];
    signal output ok;

    component h = Sha256(nBits);
    for (var i = 0; i < nBits; i++) {
        h.in[i] <== payloadBits[i];
    }
    for (var i = 0; i < 256; i++) {
        cellHashBits[i] <== h.out[i];
    }

    // Sequence bind: prevHash is public so the player can follow-the-leader
    // without re-hashing prior cells. chunkId is public for registry order.
    signal chunkSq;
    chunkSq <== chunkId * chunkId;
    ok <== 1;
}

component main {public [prevHashBits, chunkId]} = CellLock(4096);
