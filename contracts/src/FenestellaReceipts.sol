// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QorePQC} from "./QorePQC.sol";

/// @title FenestellaReceipts
/// @notice A public record of what an account's post-quantum key agreed to:
/// the hash of an EVM window it opened, of a mandate it gave an agent, or of
/// any other commitment. A receipt is accepted only with an ML-DSA-87
/// signature by the key the chain has registered for that account.
///
/// `msg.sender` is never used for authorisation. On QoreChain an EVM
/// transaction is signed by the classical key, which is exactly the key this
/// record must not depend on. Anyone may relay a receipt; only the account's
/// post-quantum key can make one.
///
/// The contract holds no funds and has no owner, no upgrade path and no
/// privileged function.
contract FenestellaReceipts {
    /// @dev Domain tag of the signed message. Bump on any change to the layout.
    bytes public constant DOMAIN = "fenestella/receipt/v1";

    struct Receipt {
        bytes32 digest;
        bytes32 kind;
        uint64 blockNumber;
        uint64 timestamp;
        bool possessionProven;
    }

    /// @notice Number of receipts an account has made; also the nonce its next receipt must sign.
    mapping(address account => uint256) public nonces;
    mapping(address account => mapping(uint256 index => Receipt)) private _receipts;
    /// @notice The index (plus one) of a digest in an account's receipts; zero when absent.
    mapping(address account => mapping(bytes32 digest => uint256)) public indexPlusOne;

    event Attested(
        address indexed account,
        uint256 indexed index,
        bytes32 indexed digest,
        bytes32 kind,
        bool possessionProven,
        address relayer
    );

    error InvalidSignature();
    error AlreadyAttested(bytes32 digest);
    error EmptyDigest();

    /// @notice The exact bytes `account`'s ML-DSA-87 key must sign for its next receipt.
    /// Bound to this chain, this contract, the account and its nonce, so a
    /// signature cannot be replayed anywhere else or twice.
    function messageFor(address account, bytes32 kind, bytes32 digest) public view returns (bytes memory) {
        return abi.encodePacked(DOMAIN, block.chainid, address(this), account, nonces[account], kind, digest);
    }

    /// @notice Record `digest` for `account`, proven by `signature`.
    /// @param kind A caller-chosen label, e.g. keccak256("window") or keccak256("mandate").
    /// @param signature ML-DSA-87 signature (4,627 bytes) over `messageFor(account, kind, digest)`.
    function attest(address account, bytes32 kind, bytes32 digest, bytes calldata signature)
        external
        returns (uint256 index)
    {
        if (digest == bytes32(0)) revert EmptyDigest();
        if (indexPlusOne[account][digest] != 0) revert AlreadyAttested(digest);

        (bytes memory pubkey, bool possessionProven) = QorePQC.registeredKey(account);
        if (!QorePQC.verify(pubkey, signature, messageFor(account, kind, digest))) revert InvalidSignature();

        index = nonces[account]++;
        _receipts[account][index] = Receipt({
            digest: digest,
            kind: kind,
            blockNumber: uint64(block.number),
            timestamp: uint64(block.timestamp),
            possessionProven: possessionProven
        });
        indexPlusOne[account][digest] = index + 1;
        emit Attested(account, index, digest, kind, possessionProven, msg.sender);
    }

    function receiptOf(address account, uint256 index) external view returns (Receipt memory) {
        return _receipts[account][index];
    }

    /// @notice Whether `account`'s post-quantum key attested `digest`.
    function isAttested(address account, bytes32 digest) external view returns (bool) {
        return indexPlusOne[account][digest] != 0;
    }
}
