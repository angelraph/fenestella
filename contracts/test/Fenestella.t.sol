// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Bills} from "../src/Bills.sol";
import {FenestellaReceipts} from "../src/FenestellaReceipts.sol";
import {IQorePQC, QorePQC} from "../src/QorePQC.sol";

/// @dev Stand-in for the pqcKeyStatus precompile. `forge` cannot run the real
/// one, so tests etch this code at its address.
contract MockKeyStatus {
    mapping(address => bytes) public keys;
    mapping(address => bool) public proven;
    mapping(address => uint8) public algo;

    function set(address account, bytes calldata pubkey, uint8 algorithmId, bool possessionProven) external {
        keys[account] = pubkey;
        algo[account] = algorithmId;
        proven[account] = possessionProven;
    }

    function pqcKeyStatus(address account) external view returns (bool, uint8, bytes memory, bool) {
        bytes memory k = keys[account];
        return (k.length != 0, algo[account], k, proven[account]);
    }
}

/// @dev Stand-in for pqcVerify: a signature "verifies" when its first 32 bytes
/// equal keccak256(pubkey, message). Enough to test binding, replay and tamper.
contract MockVerify {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        pure
        returns (bool)
    {
        return bytes32(signature[:32]) == keccak256(abi.encodePacked(pubkey, message));
    }
}

/// @dev What an inactive precompile looks like: success, empty return data.
contract Empty {
    fallback() external payable {}
}

contract ReceiptsTest is Test {
    FenestellaReceipts receipts;
    MockKeyStatus status;
    address constant ACCOUNT = address(0xA11CE);
    bytes32 constant KIND = keccak256("window");
    bytes pubkey;

    function setUp() public {
        vm.etch(QorePQC.PQC_KEY_STATUS, address(new MockKeyStatus()).code);
        vm.etch(QorePQC.PQC_VERIFY, address(new MockVerify()).code);
        status = MockKeyStatus(QorePQC.PQC_KEY_STATUS);
        receipts = new FenestellaReceipts();
        pubkey = new bytes(QorePQC.ML_DSA_87_PUBLIC_KEY_LENGTH);
        pubkey[0] = 0x42;
        status.set(ACCOUNT, pubkey, 1, true);
    }

    function _sign(bytes memory key, bytes memory message) internal pure returns (bytes memory sig) {
        sig = new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH);
        bytes32 tag = keccak256(abi.encodePacked(key, message));
        assembly {
            mstore(add(sig, 32), tag)
        }
    }

    function test_attest_records_and_emits() public {
        bytes32 digest = keccak256("opening-1");
        bytes memory sig = _sign(pubkey, receipts.messageFor(ACCOUNT, KIND, digest));
        vm.prank(address(0xBEEF)); // any relayer
        uint256 index = receipts.attest(ACCOUNT, KIND, digest, sig);
        assertEq(index, 0);
        assertTrue(receipts.isAttested(ACCOUNT, digest));
        assertEq(receipts.nonces(ACCOUNT), 1);
        FenestellaReceipts.Receipt memory r = receipts.receiptOf(ACCOUNT, 0);
        assertEq(r.digest, digest);
        assertEq(r.kind, KIND);
        assertTrue(r.possessionProven);
    }

    function test_msg_sender_alone_proves_nothing() public {
        bytes32 digest = keccak256("opening-1");
        bytes memory junk = new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH);
        vm.prank(ACCOUNT); // the classical key, acting as the account itself
        vm.expectRevert(FenestellaReceipts.InvalidSignature.selector);
        receipts.attest(ACCOUNT, KIND, digest, junk);
    }

    function test_signature_cannot_be_replayed() public {
        bytes32 d1 = keccak256("one");
        bytes memory sig = _sign(pubkey, receipts.messageFor(ACCOUNT, KIND, d1));
        receipts.attest(ACCOUNT, KIND, d1, sig);
        vm.expectRevert(abi.encodeWithSelector(FenestellaReceipts.AlreadyAttested.selector, d1));
        receipts.attest(ACCOUNT, KIND, d1, sig);
    }

    function test_signature_is_bound_to_nonce_kind_and_digest() public {
        bytes32 d1 = keccak256("one");
        bytes32 d2 = keccak256("two");
        bytes memory sigForD1 = _sign(pubkey, receipts.messageFor(ACCOUNT, KIND, d1));
        vm.expectRevert(FenestellaReceipts.InvalidSignature.selector);
        receipts.attest(ACCOUNT, KIND, d2, sigForD1);
        vm.expectRevert(FenestellaReceipts.InvalidSignature.selector);
        receipts.attest(ACCOUNT, keccak256("mandate"), d1, sigForD1);
        // After one receipt the nonce moves, so an old signature for d2 at nonce 0 is dead.
        bytes memory sigD2Nonce0 = _sign(pubkey, receipts.messageFor(ACCOUNT, KIND, d2));
        receipts.attest(ACCOUNT, KIND, d1, sigForD1);
        vm.expectRevert(FenestellaReceipts.InvalidSignature.selector);
        receipts.attest(ACCOUNT, KIND, d2, sigD2Nonce0);
    }

    function test_signature_is_bound_to_this_contract() public {
        FenestellaReceipts other = new FenestellaReceipts();
        bytes32 d = keccak256("one");
        bytes memory sig = _sign(pubkey, other.messageFor(ACCOUNT, KIND, d));
        vm.expectRevert(FenestellaReceipts.InvalidSignature.selector);
        receipts.attest(ACCOUNT, KIND, d, sig);
    }

    function test_another_accounts_key_is_refused() public {
        bytes memory otherKey = new bytes(QorePQC.ML_DSA_87_PUBLIC_KEY_LENGTH);
        otherKey[0] = 0x99;
        bytes32 d = keccak256("one");
        bytes memory sig = _sign(otherKey, receipts.messageFor(ACCOUNT, KIND, d));
        vm.expectRevert(FenestellaReceipts.InvalidSignature.selector);
        receipts.attest(ACCOUNT, KIND, d, sig);
    }

    function test_account_without_key_is_refused() public {
        address nobody = address(0xDEAD);
        bytes memory sig = new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.NoPostQuantumKey.selector, nobody));
        receipts.attest(nobody, KIND, keccak256("x"), sig);
    }

    function test_wrong_signature_length_is_refused() public {
        vm.expectRevert(abi.encodeWithSelector(QorePQC.BadSignatureLength.selector, 65));
        receipts.attest(ACCOUNT, KIND, keccak256("x"), new bytes(65));
    }

    function test_empty_digest_is_refused() public {
        vm.expectRevert(FenestellaReceipts.EmptyDigest.selector);
        receipts.attest(ACCOUNT, KIND, bytes32(0), new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH));
    }

    function test_fails_closed_when_key_status_precompile_is_inactive() public {
        vm.etch(QorePQC.PQC_KEY_STATUS, address(new Empty()).code);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PrecompileUnavailable.selector, QorePQC.PQC_KEY_STATUS));
        receipts.attest(ACCOUNT, KIND, keccak256("x"), new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH));
    }

    function test_fails_closed_when_verify_precompile_is_inactive() public {
        vm.etch(QorePQC.PQC_VERIFY, address(new Empty()).code);
        bytes32 d = keccak256("x");
        bytes memory sig = _sign(pubkey, receipts.messageFor(ACCOUNT, KIND, d));
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PrecompileUnavailable.selector, QorePQC.PQC_VERIFY));
        receipts.attest(ACCOUNT, KIND, d, sig);
    }

    function test_unsupported_algorithm_is_refused() public {
        status.set(ACCOUNT, pubkey, 2, true);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.UnsupportedAlgorithm.selector, 2));
        receipts.attest(ACCOUNT, KIND, keccak256("x"), new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH));
    }
}

contract Reenter {
    Bills immutable bills;
    uint256 public id;

    constructor(Bills b) {
        bills = b;
    }

    function setId(uint256 i) external {
        id = i;
    }

    receive() external payable {
        // A payee that tries to be paid twice.
        try bills.pay{value: msg.value}(id) {} catch {}
    }
}

contract BillsTest is Test {
    Bills bills;
    address payee = address(0xCAFE);
    address payer = address(0xA11CE);

    function setUp() public {
        bills = new Bills();
        vm.deal(payer, 10 ether);
    }

    function _bill(uint256 amount) internal returns (uint256 id) {
        vm.prank(payee);
        id = bills.createBill(payer, amount, keccak256("invoice-42"));
    }

    function test_pay_forwards_exact_amount_and_holds_nothing() public {
        uint256 id = _bill(1 ether);
        vm.prank(payer);
        bills.pay{value: 1 ether}(id);
        assertEq(payee.balance, 1 ether);
        assertEq(address(bills).balance, 0);
        assertTrue(bills.billOf(id).paid);
    }

    function test_only_the_payer_can_pay() public {
        uint256 id = _bill(1 ether);
        address stranger = address(0xBAD);
        vm.deal(stranger, 2 ether);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Bills.NotThePayer.selector, stranger));
        bills.pay{value: 1 ether}(id);
    }

    function test_wrong_amount_is_refused() public {
        uint256 id = _bill(1 ether);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Bills.WrongAmount.selector, 2 ether, 1 ether));
        bills.pay{value: 2 ether}(id);
    }

    function test_cannot_pay_twice() public {
        uint256 id = _bill(1 ether);
        vm.startPrank(payer);
        bills.pay{value: 1 ether}(id);
        vm.expectRevert(abi.encodeWithSelector(Bills.AlreadyPaid.selector, id));
        bills.pay{value: 1 ether}(id);
        vm.stopPrank();
    }

    function test_unknown_bill_is_refused() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Bills.UnknownBill.selector, 7));
        bills.pay{value: 1}(7);
    }

    function test_zero_amount_and_zero_payer_are_refused() public {
        vm.expectRevert(Bills.ZeroAmount.selector);
        bills.createBill(payer, 0, bytes32(0));
        vm.expectRevert(Bills.ZeroPayer.selector);
        bills.createBill(address(0), 1, bytes32(0));
    }

    function test_reentrant_payee_gains_nothing() public {
        Reenter evil = new Reenter(bills);
        vm.prank(address(evil));
        uint256 id = bills.createBill(payer, 1 ether, bytes32(0));
        evil.setId(id);
        vm.prank(payer);
        bills.pay{value: 1 ether}(id);
        assertEq(address(evil).balance, 1 ether);
        assertEq(address(bills).balance, 0);
        assertEq(payer.balance, 9 ether);
    }

    /// QCAI audit, finding 1 ("missing access control on createBill"): anyone may
    /// post a bill, by design, because a bill is a request and not a debt. This
    /// pins down why that is safe: an unsolicited bill moves no money, and it
    /// changes nothing about any other bill.
    function test_unsolicited_bill_moves_nothing() public {
        uint256 real = _bill(1 ether);
        address spammer = address(0x5BA4);
        vm.deal(spammer, 1 ether);
        vm.startPrank(spammer);
        for (uint256 i = 0; i < 50; i++) {
            bills.createBill(payer, 100 ether, keccak256(abi.encode(i)));
        }
        vm.stopPrank();

        // Nobody's balance moved, and the contract still holds nothing.
        assertEq(payer.balance, 10 ether);
        assertEq(spammer.balance, 1 ether);
        assertEq(address(bills).balance, 0);

        // The spammer cannot pay its own bill on the payer's behalf.
        vm.prank(spammer);
        vm.expectRevert(abi.encodeWithSelector(Bills.NotThePayer.selector, spammer));
        bills.pay{value: 1 ether}(real + 1);

        // The real bill is untouched and still payable, whatever came after it.
        Bills.Bill memory b = bills.billOf(real);
        assertEq(b.payee, payee);
        assertEq(b.amount, 1 ether);
        assertFalse(b.paid);
        vm.prank(payer);
        bills.pay{value: 1 ether}(real);
        assertEq(payee.balance, 1 ether);
    }

    function testFuzz_contract_never_keeps_a_balance(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(payer, amount);
        uint256 id = _bill(amount);
        vm.prank(payer);
        bills.pay{value: amount}(id);
        assertEq(address(bills).balance, 0);
        assertEq(payee.balance, amount);
    }
}
