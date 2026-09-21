pragma circom 2.1.6;

/*
  Chunk binding — conceptual statement for the Proven Player.

  This is the circuit we would compile the day a prover host exists.
  It is not an AV2 encoder. AVM's prediction, transform, and entropy
  coder are not in this template. Constraining the encoder itself does not
  fit a succinct proof of a 5-second chunk.

  The live check is vita/proven-player-verify.js (SHA-256). It already
  enforces the public statement below. Do not treat an unwired Groth16 slot
  as a witness.

  Public inputs
    binding      SHA-256(envelope)
    av1Digest    SHA-256(container bytes)
    sliceRoot    Merkle root of 4096-byte slices
    sourceDigest SHA-256 of the raw ingest recorded at encode time
    chunkIndex   follow-the-leader index

  Private inputs
    envelope[448]
    av1Bytes[]

  Constraints (when circomlib SHA-256 is linked)
    binding === Sha256(envelope)
    av1Digest === Sha256(av1Bytes)
    sliceRoot === Merkle(Sha256 of each slice)
    envelope.av1Digest === av1Digest
    envelope.sliceRoot === sliceRoot
    envelope.sourceDigest === sourceDigest
    envelope.groth16 flag === 0 and slot === 0
*/

template ChunkBinding() {
    // Field elements stand in for the 32-byte digests. A production compile
    // replaces each equality with a Sha256 template from circomlib.
    signal input binding;
    signal input av1Digest;
    signal input sliceRoot;
    signal input sourceDigest;
    signal input chunkIndex;

    signal output commit;

    // The four digests and the index are bound into one public commit.
    // Multiplication by distinct constants keeps each input in the witness
    // without pretending this line is a hash.
    commit <== binding
        + av1Digest * 2
        + sliceRoot * 3
        + sourceDigest * 4
        + chunkIndex * 5;
}

component main {public [binding, av1Digest, sliceRoot, sourceDigest, chunkIndex]} = ChunkBinding();
