// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice QoreChain's post-quantum precompiles, as documented by the chain.
/// Active on testnet (qorechain-diana). Not active on mainnet at the time of
/// writing: a call to an inactive precompile succeeds with empty return data.
interface IQorePQC {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}

/// @notice Fail-closed access to the precompiles. Every helper reverts unless
/// the precompile answered with well-formed data, so an inactive precompile
/// can never be read as "verified".
library QorePQC {
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_KEY_STATUS = 0x0000000000000000000000000000000000000a02;
    uint8 internal constant ALGORITHM_ML_DSA_87 = 1;
    uint256 internal constant ML_DSA_87_PUBLIC_KEY_LENGTH = 2592;
    uint256 internal constant ML_DSA_87_SIGNATURE_LENGTH = 4627;

    error PrecompileUnavailable(address precompile);
    error NoPostQuantumKey(address account);
    error UnsupportedAlgorithm(uint8 algorithmId);
    error BadSignatureLength(uint256 length);

    /// @return pubkey The account's registered ML-DSA-87 public key.
    /// @return possessionProven Whether the chain holds a proof of possession for it.
    function registeredKey(address account) internal view returns (bytes memory pubkey, bool possessionProven) {
        (bool ok, bytes memory ret) =
            PQC_KEY_STATUS.staticcall(abi.encodeCall(IQorePQC.pqcKeyStatus, (account)));
        // Four head words plus the bytes length word is the least a real answer can be.
        if (!ok || ret.length < 160) revert PrecompileUnavailable(PQC_KEY_STATUS);
        bool registered;
        uint8 algorithmId;
        (registered, algorithmId, pubkey, possessionProven) = abi.decode(ret, (bool, uint8, bytes, bool));
        if (!registered || pubkey.length == 0) revert NoPostQuantumKey(account);
        if (algorithmId != ALGORITHM_ML_DSA_87 || pubkey.length != ML_DSA_87_PUBLIC_KEY_LENGTH) {
            revert UnsupportedAlgorithm(algorithmId);
        }
    }

    /// @return valid True only when the precompile answered and said the signature verifies.
    function verify(bytes memory pubkey, bytes calldata signature, bytes memory message)
        internal
        view
        returns (bool valid)
    {
        if (signature.length != ML_DSA_87_SIGNATURE_LENGTH) revert BadSignatureLength(signature.length);
        (bool ok, bytes memory ret) =
            PQC_VERIFY.staticcall(abi.encodeCall(IQorePQC.pqcVerify, (pubkey, signature, message)));
        if (!ok || ret.length != 32) revert PrecompileUnavailable(PQC_VERIFY);
        valid = abi.decode(ret, (bool));
    }
}
