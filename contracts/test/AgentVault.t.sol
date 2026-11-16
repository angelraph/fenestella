// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {QorePQC} from "../src/QorePQC.sol";
import {MockKeyStatus, MockVerify, Empty} from "./Fenestella.t.sol";

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount && allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev A payee that tries to pay a second bill while being paid.
contract ReentrantPayee {
    AgentVault vault;
    uint256 public otherBill;
    bool public tried;
    bool public reentered;

    constructor(AgentVault v) {
        vault = v;
    }

    function bill(address owner, uint256 amount) external returns (uint256) {
        return vault.createBill(owner, address(0), amount, bytes32(0));
    }

    function setOther(uint256 id) external {
        otherBill = id;
    }

    receive() external payable {
        if (!tried) {
            tried = true;
            try vault.payBill(otherBill) {
                reentered = true;
            } catch {}
        }
    }
}

contract AgentVaultTest is Test {
    AgentVault vault;
    MockKeyStatus status;
    MockToken token;
    address constant OWNER = address(0xA11CE);
    address constant VENDOR = address(0xCAFE);
    address constant THIEF = address(0xBAD);
    address constant NATIVE = address(0);
    bytes pubkey;

    function setUp() public {
        vm.etch(QorePQC.PQC_KEY_STATUS, address(new MockKeyStatus()).code);
        vm.etch(QorePQC.PQC_VERIFY, address(new MockVerify()).code);
        status = MockKeyStatus(QorePQC.PQC_KEY_STATUS);
        vault = new AgentVault();
        token = new MockToken();
        pubkey = new bytes(QorePQC.ML_DSA_87_PUBLIC_KEY_LENGTH);
        pubkey[0] = 0x42;
        status.set(OWNER, pubkey, 1, true);
        vm.deal(OWNER, 100 ether);
        vm.deal(THIEF, 100 ether);
    }

    // ---------------------------------------------------------------- helpers

    function _sig(bytes memory key, bytes memory message) internal pure returns (bytes memory sig) {
        sig = new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH);
        bytes32 tag = keccak256(abi.encodePacked(key, message));
        assembly {
            mstore(add(sig, 32), tag)
        }
    }

    function _ownerSig(bytes32 action, bytes32 paramsHash) internal view returns (bytes memory) {
        return _sig(pubkey, vault.messageFor(OWNER, action, paramsHash));
    }

    function _approve(address payee) internal {
        vault.setPayee(OWNER, payee, true, _ownerSig(vault.ACTION_PAYEE(), keccak256(abi.encode(payee, true))));
    }

    function _limits(address tok, uint256 perPayment, uint256 perDay) internal {
        vault.setLimits(OWNER, tok, perPayment, perDay, _ownerSig(vault.ACTION_LIMITS(), keccak256(abi.encode(tok, perPayment, perDay))));
    }

    function _fund(uint256 amount) internal {
        vm.prank(OWNER);
        vault.deposit{value: amount}(OWNER);
    }

    function _bill(address payee, uint256 amount) internal returns (uint256 id) {
        vm.prank(payee);
        id = vault.createBill(OWNER, NATIVE, amount, keccak256("invoice"));
    }

    function _ready() internal {
        _fund(10 ether);
        _approve(VENDOR);
        _limits(NATIVE, 1 ether, 3 ether);
    }

    // ------------------------------------------------------------- happy path

    function test_agent_pays_an_approved_bill_within_limits() public {
        _ready();
        uint256 id = _bill(VENDOR, 0.4 ether);
        vm.prank(OWNER); // the agent acts as the owner's account
        vault.payBill(id);
        assertEq(VENDOR.balance, 0.4 ether);
        assertEq(vault.balanceOf(OWNER, NATIVE), 9.6 ether);
        assertTrue(vault.billOf(id).paid);
    }

    function test_pays_an_erc20_bill_within_its_own_limits() public {
        token.mint(OWNER, 1000);
        vm.startPrank(OWNER);
        token.approve(address(vault), 1000);
        vault.depositToken(OWNER, address(token), 1000);
        vm.stopPrank();
        _approve(VENDOR);
        _limits(address(token), 100, 150);
        vm.prank(VENDOR);
        uint256 id = vault.createBill(OWNER, address(token), 100, bytes32(0));
        vm.prank(OWNER);
        vault.payBill(id);
        assertEq(token.balanceOf(VENDOR), 100);
        vm.prank(VENDOR);
        uint256 id2 = vault.createBill(OWNER, address(token), 100, bytes32(0));
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.OverDailyLimit.selector, 200, 150));
        vault.payBill(id2);
    }

    // ------------------------------------------- what a stolen agent key can't do

    function test_a_thief_bill_is_refused_because_the_payee_is_not_approved() public {
        _ready();
        uint256 id = _bill(THIEF, 0.5 ether);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.PayeeNotApproved.selector, THIEF));
        vault.payBill(id);
    }

    function test_cannot_approve_a_payee_without_the_owner_post_quantum_key() public {
        _ready();
        bytes memory forged = _sig(hex"beef", vault.messageFor(OWNER, vault.ACTION_PAYEE(), keccak256(abi.encode(THIEF, true))));
        vm.prank(OWNER); // msg.sender is the owner: still not enough
        vm.expectRevert(AgentVault.InvalidSignature.selector);
        vault.setPayee(OWNER, THIEF, true, forged);
    }

    function test_cannot_withdraw_to_anyone_but_the_owner() public {
        _ready();
        bytes memory sig = _ownerSig(vault.ACTION_WITHDRAW(), keccak256(abi.encode(NATIVE, 2 ether)));
        vm.prank(THIEF); // anyone may relay the owner's signed withdrawal; the money still goes to the owner
        vault.withdraw(OWNER, NATIVE, 2 ether, sig);
        assertEq(OWNER.balance, 92 ether);
        assertEq(THIEF.balance, 100 ether);
    }

    function test_cannot_raise_limits_without_the_owner_key() public {
        _ready();
        vm.prank(OWNER);
        vm.expectRevert(AgentVault.InvalidSignature.selector);
        vault.setLimits(OWNER, NATIVE, 100 ether, 100 ether, new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH));
    }

    function test_over_the_payment_limit_is_refused() public {
        _ready();
        uint256 id = _bill(VENDOR, 1.5 ether);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.OverPaymentLimit.selector, 1.5 ether, 1 ether));
        vault.payBill(id);
    }

    function test_over_the_daily_limit_is_refused_and_resets_next_day() public {
        _ready();
        for (uint256 i = 0; i < 3; i++) {
            uint256 id = _bill(VENDOR, 1 ether);
            vm.prank(OWNER);
            vault.payBill(id);
        }
        uint256 fourth = _bill(VENDOR, 1 ether);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.OverDailyLimit.selector, 4 ether, 3 ether));
        vault.payBill(fourth);
        vm.warp(block.timestamp + 1 days);
        vm.prank(OWNER);
        vault.payBill(fourth);
        assertEq(VENDOR.balance, 4 ether);
    }

    function test_no_limits_set_means_nothing_can_be_paid() public {
        _fund(10 ether);
        _approve(VENDOR);
        uint256 id = _bill(VENDOR, 1);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.OverPaymentLimit.selector, 1, 0));
        vault.payBill(id);
    }

    function test_only_the_billed_owner_can_pay() public {
        _ready();
        uint256 id = _bill(VENDOR, 0.4 ether);
        vm.prank(THIEF);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.NotTheOwner.selector, THIEF));
        vault.payBill(id);
    }

    function test_a_bill_is_paid_once() public {
        _ready();
        uint256 id = _bill(VENDOR, 0.4 ether);
        vm.startPrank(OWNER);
        vault.payBill(id);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.AlreadyPaid.selector, id));
        vault.payBill(id);
        vm.stopPrank();
    }

    function test_pause_stops_payments_but_not_withdrawal() public {
        _ready();
        vault.setPaused(OWNER, true, _ownerSig(vault.ACTION_PAUSE(), keccak256(abi.encode(true))));
        uint256 id = _bill(VENDOR, 0.4 ether);
        vm.prank(OWNER);
        vm.expectRevert(AgentVault.VaultPaused.selector);
        vault.payBill(id);
        vault.withdraw(OWNER, NATIVE, 10 ether, _ownerSig(vault.ACTION_WITHDRAW(), keccak256(abi.encode(NATIVE, 10 ether))));
        assertEq(vault.balanceOf(OWNER, NATIVE), 0);
    }

    // ------------------------------------------------------ signature binding

    function test_a_signature_cannot_be_replayed() public {
        bytes memory sig = _ownerSig(vault.ACTION_PAYEE(), keccak256(abi.encode(VENDOR, true)));
        vault.setPayee(OWNER, VENDOR, true, sig);
        vm.expectRevert(AgentVault.InvalidSignature.selector);
        vault.setPayee(OWNER, VENDOR, true, sig);
    }

    function test_a_signature_for_one_payee_cannot_approve_another() public {
        bytes memory sig = _ownerSig(vault.ACTION_PAYEE(), keccak256(abi.encode(VENDOR, true)));
        vm.expectRevert(AgentVault.InvalidSignature.selector);
        vault.setPayee(OWNER, THIEF, true, sig);
    }

    function test_a_payee_signature_cannot_be_used_as_a_withdrawal() public {
        _fund(1 ether);
        bytes memory sig = _ownerSig(vault.ACTION_PAYEE(), keccak256(abi.encode(VENDOR, true)));
        vm.expectRevert(AgentVault.InvalidSignature.selector);
        vault.withdraw(OWNER, NATIVE, 1 ether, sig);
    }

    function test_an_account_without_a_post_quantum_key_cannot_be_administered() public {
        address noKey = address(0x1234);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.NoPostQuantumKey.selector, noKey));
        vault.setPayee(noKey, VENDOR, true, new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH));
    }

    function test_fails_closed_when_the_verify_precompile_is_inactive() public {
        vm.etch(QorePQC.PQC_VERIFY, address(new Empty()).code);
        bytes memory sig = _ownerSig(vault.ACTION_PAYEE(), keccak256(abi.encode(VENDOR, true)));
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PrecompileUnavailable.selector, QorePQC.PQC_VERIFY));
        vault.setPayee(OWNER, VENDOR, true, sig);
    }

    // ----------------------------------------------------------- money safety

    function test_plain_transfers_to_the_vault_are_refused() public {
        vm.prank(OWNER);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_owners_are_isolated() public {
        _ready();
        address other = address(0xB0B);
        vm.deal(other, 1 ether);
        vm.prank(other);
        vault.deposit{value: 1 ether}(other);
        vm.prank(VENDOR);
        uint256 id = vault.createBill(other, NATIVE, 0.5 ether, bytes32(0));
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.PayeeNotApproved.selector, VENDOR));
        vault.payBill(id); // VENDOR is approved for OWNER, not for `other`
        assertEq(vault.balanceOf(OWNER, NATIVE), 10 ether);
    }

    function test_a_reentrant_payee_cannot_pay_itself_twice() public {
        _fund(10 ether);
        _limits(NATIVE, 5 ether, 10 ether);
        ReentrantPayee evil = new ReentrantPayee(vault);
        _approve(address(evil));
        uint256 a = evil.bill(OWNER, 1 ether);
        uint256 b = evil.bill(OWNER, 1 ether);
        evil.setOther(b);
        vm.prank(OWNER);
        vault.payBill(a);
        assertFalse(evil.reentered());
        assertEq(address(evil).balance, 1 ether);
        assertFalse(vault.billOf(b).paid);
    }

    function testFuzz_vault_holds_exactly_what_owners_are_owed(uint96 dep, uint96 amount) public {
        vm.assume(dep > 0 && amount > 0 && amount <= dep);
        vm.deal(OWNER, dep);
        _fund(dep);
        _approve(VENDOR);
        _limits(NATIVE, amount, amount);
        uint256 id = _bill(VENDOR, amount);
        vm.prank(OWNER);
        vault.payBill(id);
        assertEq(address(vault).balance, vault.balanceOf(OWNER, NATIVE));
        assertEq(VENDOR.balance, amount);
    }
}
