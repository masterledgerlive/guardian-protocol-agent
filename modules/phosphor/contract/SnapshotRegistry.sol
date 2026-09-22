// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// PHOSPHOR anchor mirror.
/// No address in this repo is deployed. Do not treat a local hardhat hash as a Base loc.
/// `startLocation` is an injector commit or a real ipfs:// CID returned by a daemon.
contract SnapshotRegistry {
    struct Anchor {
        bytes32 merkleRoot;
        uint256 timestamp;
        string startLocation;
        address signer;
    }

    mapping(bytes32 => Anchor) public anchors;

    event Anchored(
        bytes32 indexed commit,
        bytes32 merkleRoot,
        uint256 timestamp,
        string startLocation,
        address signer
    );

    function anchor(bytes32 commit, bytes32 merkleRoot, string calldata startLocation) external {
        require(anchors[commit].timestamp == 0, "already anchored");
        anchors[commit] = Anchor(merkleRoot, block.timestamp, startLocation, msg.sender);
        emit Anchored(commit, merkleRoot, block.timestamp, startLocation, msg.sender);
    }

    function getAnchor(bytes32 commit) external view returns (bytes32, uint256, string memory, address) {
        Anchor memory row = anchors[commit];
        return (row.merkleRoot, row.timestamp, row.startLocation, row.signer);
    }
}
