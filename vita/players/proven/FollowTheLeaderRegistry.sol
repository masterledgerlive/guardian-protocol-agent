// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Follow-the-Leader streaming manifest
/// @notice Chronological registry of zk-SNARK keys (≈448 bytes) for Proven Player cells.
///         Heavy video stays off-chain. The chain only stores the lock sequence.
///         Never invent a loc — commit only after a real proof is in hand.
contract FollowTheLeaderRegistry {
    struct ProofRecord {
        uint256 chunkId;
        bytes32 cellHash;
        bytes32 prevHash;
        bytes proof; // constant-size key (~448 bytes)
        address prover;
        uint64 committedAt;
    }

    /// @dev chunkId => record. latestChunkId is the follow-the-leader head.
    mapping(uint256 => ProofRecord) public chunks;
    uint256 public latestChunkId;
    bytes32 public latestCellHash;
    address public owner;

    event ProofCommitted(uint256 indexed chunkId, bytes32 indexed cellHash, address prover);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// @notice Accept a key for the next cell. Sequence must follow the leader.
    function commitProof(
        uint256 chunkId,
        bytes32 cellHash,
        bytes32 prevHash,
        bytes calldata proof
    ) external {
        require(cellHash != bytes32(0), "empty cell");
        require(proof.length >= 96 && proof.length <= 512, "key size");
        require(chunks[chunkId].committedAt == 0, "already committed");
        if (latestChunkId == 0) {
            require(chunkId == 1, "first chunk must be 1");
        } else {
            require(chunkId == latestChunkId + 1, "must follow the leader");
            require(prevHash == latestCellHash, "prev hash mismatch");
        }
        chunks[chunkId] = ProofRecord({
            chunkId: chunkId,
            cellHash: cellHash,
            prevHash: prevHash,
            proof: proof,
            prover: msg.sender,
            committedAt: uint64(block.timestamp)
        });
        latestChunkId = chunkId;
        latestCellHash = cellHash;
        emit ProofCommitted(chunkId, cellHash, msg.sender);
    }

    function latest() external view returns (ProofRecord memory) {
        return chunks[latestChunkId];
    }

    function proofOf(uint256 chunkId) external view returns (ProofRecord memory) {
        return chunks[chunkId];
    }
}
