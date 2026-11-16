// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentReports
/// @notice A mailbox on chain. An agent posts a report to an owner as a sealed
/// envelope (QoreSeal, ML-KEM-1024 to the owner's registered encryption key);
/// the report inside carries the agent's hybrid ML-DSA-87 signature. The
/// contract only emits it: it holds nothing, stores nothing, has no owner, and
/// cannot read what it carries. Only the owner can open a report, and anyone
/// who can open it can check who wrote it against the chain.
contract AgentReports {
    /// @dev Bounds the gas of one post; a sealed and signed report is well under it.
    uint256 public constant MAX_ENVELOPE = 24_000;

    event Report(address indexed owner, address indexed sender, bytes32 indexed ref, bytes envelope);

    error EmptyEnvelope();
    error EnvelopeTooLarge(uint256 length);
    error ZeroOwner();

    /// @param owner The account the report is for.
    /// @param ref   What it is about (e.g. the payment's transaction hash), for lookups.
    /// @param envelope The sealed report.
    function post(address owner, bytes32 ref, bytes calldata envelope) external {
        if (owner == address(0)) revert ZeroOwner();
        if (envelope.length == 0) revert EmptyEnvelope();
        if (envelope.length > MAX_ENVELOPE) revert EnvelopeTooLarge(envelope.length);
        emit Report(owner, msg.sender, ref, envelope);
    }
}
