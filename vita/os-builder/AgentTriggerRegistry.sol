// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentTriggerRegistry
/// @notice Follow-the-leader chronological registry for VITA OS Builder brains.
/// @dev Mirrors the JS sandbox in vita/os-builder.js. Stores IFTTT recipe digests
///      and sequential build cells. No deployed address in this repo.
///      Never invent a location — commit only after a real proof / seal is in hand.
contract AgentTriggerRegistry {
    struct TriggerRecipe {
        bytes32 recipeId;
        bytes32 ifDigest;
        bytes32 thenDigest;
        uint64 registeredAt;
    }

    struct BuildCell {
        uint64 chunkId;
        bytes32 cellHash;
        bytes32 prevHash;
        bytes32 agentId;
        uint64 committedAt;
    }

    struct Brain {
        bool started;
        uint64 head;
        mapping(uint64 => BuildCell) cells;
        mapping(bytes32 => TriggerRecipe) recipes;
        bytes32[] recipeIds;
    }

    mapping(bytes32 => Brain) private _brains;

    event TriggerRegistered(bytes32 indexed brainId, bytes32 indexed recipeId);
    event CellCommitted(bytes32 indexed brainId, uint64 chunkId, bytes32 cellHash);

    error NotLeader();
    error EmptyHash();
    error AlreadyRegistered();

    /// @notice Register an IFTTT recipe digest for a brain. Not a tx location.
    function registerTrigger(
        bytes32 brainId,
        bytes32 recipeId,
        bytes32 ifDigest,
        bytes32 thenDigest
    ) external {
        if (recipeId == bytes32(0) || ifDigest == bytes32(0)) revert EmptyHash();
        Brain storage b = _brains[brainId];
        if (b.recipes[recipeId].registeredAt != 0) revert AlreadyRegistered();
        b.recipes[recipeId] = TriggerRecipe({
            recipeId: recipeId,
            ifDigest: ifDigest,
            thenDigest: thenDigest,
            registeredAt: uint64(block.timestamp)
        });
        b.recipeIds.push(recipeId);
        emit TriggerRegistered(brainId, recipeId);
    }

    /// @notice Commit the next follow-the-leader build cell.
    function commitCell(
        bytes32 brainId,
        bytes32 agentId,
        bytes32 cellHash,
        bytes32 prevHash
    ) external {
        if (cellHash == bytes32(0)) revert EmptyHash();
        Brain storage b = _brains[brainId];
        uint64 nextId;
        if (!b.started) {
            nextId = 1;
            if (prevHash != bytes32(0)) revert NotLeader();
            b.started = true;
            b.head = 1;
        } else {
            nextId = b.head + 1;
            if (prevHash != b.cells[b.head].cellHash) revert NotLeader();
            b.head = nextId;
        }
        b.cells[nextId] = BuildCell({
            chunkId: nextId,
            cellHash: cellHash,
            prevHash: prevHash,
            agentId: agentId,
            committedAt: uint64(block.timestamp)
        });
        emit CellCommitted(brainId, nextId, cellHash);
    }

    function latest(bytes32 brainId) external view returns (bool ok, uint64 head, bytes32 cellHash) {
        Brain storage b = _brains[brainId];
        if (!b.started) return (false, 0, bytes32(0));
        return (true, b.head, b.cells[b.head].cellHash);
    }

    function cellAt(bytes32 brainId, uint64 chunkId)
        external
        view
        returns (BuildCell memory)
    {
        return _brains[brainId].cells[chunkId];
    }

    function recipeCount(bytes32 brainId) external view returns (uint256) {
        return _brains[brainId].recipeIds.length;
    }
}
