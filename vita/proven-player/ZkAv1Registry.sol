// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ZkAv1Registry
/// @notice Follow-the-leader manifest for Proven Player chunk receipts.
/// @dev The 448-byte envelope is a SHA-256 chunk binding, not a Groth16 of
///      SVT-AV1. Byte 5 bit 0 (groth16Wired) must stay clear and bytes
///      [176, 432) must stay zero until a verifier is deployed beside this
///      contract. This file has no deployed address in the repo.
contract ZkAv1Registry {
    uint256 public constant ENVELOPE_BYTES = 448;
    uint256 public constant GROTH16_SLOT = 176;
    uint256 public constant GROTH16_BYTES = 256;

    struct Chunk {
        bytes32 binding;
        bytes32 av1Digest;
        bytes32 sliceRoot;
        bytes envelope;
        uint64 chunkIndex;
        uint64 committedAt;
    }

    struct Stream {
        uint64 head;
        bool started;
        mapping(uint64 => Chunk) chunks;
    }

    mapping(bytes32 => Stream) private _streams;

    event ChunkCommitted(bytes32 indexed streamId, uint64 chunkIndex, bytes32 binding);

    error BadEnvelope();
    error Groth16Unwired();
    error NotLeader();
    error BindingMismatch();

    /// @param streamId SHA-256 of the stream key. Not a transaction hash.
    /// @param envelope Fixed 448-byte receipt. CID is intentionally absent —
    ///        storage location is off this contract until a real pin exists.
    function commitChunk(bytes32 streamId, bytes calldata envelope) external {
        if (envelope.length != ENVELOPE_BYTES) revert BadEnvelope();
        if ((uint8(envelope[5]) & 0x01) == 0x01) revert Groth16Unwired();
        for (uint256 i = 0; i < GROTH16_BYTES; i++) {
            if (envelope[GROTH16_SLOT + i] != 0) revert Groth16Unwired();
        }

        bytes32 binding = sha256(envelope);
        uint64 chunkIndex = _u16(envelope, 6);
        Stream storage stream = _streams[streamId];
        if (!stream.started) {
            if (chunkIndex != 0) revert NotLeader();
            stream.started = true;
            stream.head = 0;
        } else {
            if (chunkIndex != stream.head + 1) revert NotLeader();
            stream.head = chunkIndex;
        }

        Chunk storage row = stream.chunks[chunkIndex];
        row.binding = binding;
        row.av1Digest = _b32(envelope, 80);
        row.sliceRoot = _b32(envelope, 112);
        row.envelope = envelope;
        row.chunkIndex = chunkIndex;
        row.committedAt = uint64(block.timestamp);

        emit ChunkCommitted(streamId, chunkIndex, binding);
    }

    function latest(bytes32 streamId) external view returns (bool ok, uint64 head, bytes32 binding) {
        Stream storage stream = _streams[streamId];
        if (!stream.started) return (false, 0, bytes32(0));
        return (true, stream.head, stream.chunks[stream.head].binding);
    }

    function chunkAt(bytes32 streamId, uint64 chunkIndex)
        external
        view
        returns (bytes32 binding, bytes memory envelope)
    {
        Chunk storage row = _streams[streamId].chunks[chunkIndex];
        return (row.binding, row.envelope);
    }

    function _u16(bytes calldata envelope, uint256 off) private pure returns (uint64) {
        return (uint64(uint8(envelope[off])) << 8) | uint64(uint8(envelope[off + 1]));
    }

    function _b32(bytes calldata buf, uint256 off) private pure returns (bytes32 v) {
        assembly {
            v := calldataload(add(buf.offset, off))
        }
    }
}
