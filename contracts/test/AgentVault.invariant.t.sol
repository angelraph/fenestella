// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {QorePQC} from "../src/QorePQC.sol";
import {MockKeyStatus, MockVerify} from "./Fenestella.t.sol";

/// @dev Drives the vault with random sequences of actions from an owner, an
/// approved vendor and a thief, and keeps its own books to compare against.
/// The thief holds no post-quantum key: everything it signs is a forgery.
contract VaultHandler is Test {
    AgentVault public vault;
    bytes public ownerKey;

    address public constant OWNER = address(0xA11CE);
    address public constant VENDOR = address(0xCAFE);
    address public constant THIEF = address(0xBAD);
    address constant NATIVE = address(0);

    // The handler's own books.
    uint256 public deposited;
    uint256 public paidOut;
    uint256 public withdrawn;
    uint256 public thiefStart;

    // Anything that must never happen sets one of these.
    uint256 public forgedAdminAccepted;
    uint256 public paidUnapproved;
    uint256 public paidOverPerPayment;
    uint256 public paidOverPerDay;
    uint256 public strangerPaid;

    mapping(uint256 => uint256) public timesPaid;
    mapping(uint256 => uint256) public spentByDay;
    uint256[] public bills;

    // What the owner has signed, as the handler understands it.
    mapping(address => bool) public approved;
    uint256 public perPayment;
    uint256 public perDay;
    bool public isPaused;

    // Counters, to show the run explored the space.
    uint256 public payments;
    uint256 public refusals;

    constructor(AgentVault v, bytes memory key) {
        vault = v;
        ownerKey = key;
        vm.deal(OWNER, 1_000_000 ether);
        vm.deal(THIEF, 1_000 ether);
        thiefStart = THIEF.balance;
    }

    function _sig(bytes memory message) internal view returns (bytes memory sig) {
        sig = new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH);
        bytes32 tag = keccak256(abi.encodePacked(ownerKey, message));
        assembly {
            mstore(add(sig, 32), tag)
        }
    }

    function _forged(uint256 seed) internal pure returns (bytes memory sig) {
        sig = new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH);
        bytes32 tag = keccak256(abi.encode("forged", seed));
        assembly {
            mstore(add(sig, 32), tag)
        }
    }

    // ------------------------------------------------------------ the owner

    function deposit(uint96 amount) external {
        amount = uint96(bound(amount, 1, 50 ether));
        vm.prank(OWNER);
        vault.deposit{value: amount}(OWNER);
        deposited += amount;
    }

    /// The owner approves or removes the vendor. It never approves the thief.
    function ownerApprove(bool on) external {
        address payee = VENDOR;
        bytes memory m = vault.messageFor(OWNER, vault.ACTION_PAYEE(), keccak256(abi.encode(payee, on)));
        vault.setPayee(OWNER, payee, on, _sig(m));
        approved[payee] = on;
    }

    function ownerLimits(uint96 per, uint96 daily) external {
        per = uint96(bound(per, 0, 20 ether));
        daily = uint96(bound(daily, 0, 40 ether));
        bytes memory m = vault.messageFor(OWNER, vault.ACTION_LIMITS(), keccak256(abi.encode(NATIVE, uint256(per), uint256(daily))));
        vault.setLimits(OWNER, NATIVE, per, daily, _sig(m));
        perPayment = per;
        perDay = daily;
    }

    function ownerPause(bool on) external {
        bytes memory m = vault.messageFor(OWNER, vault.ACTION_PAUSE(), keccak256(abi.encode(on)));
        vault.setPaused(OWNER, on, _sig(m));
        isPaused = on;
    }

    function ownerWithdraw(uint96 amount) external {
        uint256 bal = vault.balanceOf(OWNER, NATIVE);
        if (bal == 0) return;
        amount = uint96(bound(amount, 1, bal));
        bytes memory m = vault.messageFor(OWNER, vault.ACTION_WITHDRAW(), keccak256(abi.encode(NATIVE, uint256(amount))));
        vault.withdraw(OWNER, NATIVE, amount, _sig(m));
        withdrawn += amount;
    }

    /// The owner's account (or its agent) pays a bill. The vault decides.
    function ownerPays(uint256 pick) external {
        if (bills.length == 0) return;
        uint256 id = bills[pick % bills.length];
        AgentVault.Bill memory b = vault.billOf(id);
        uint256 day = block.timestamp / 1 days;
        vm.prank(OWNER);
        try vault.payBill(id) {
            payments++;
            paidOut += b.amount;
            timesPaid[id]++;
            spentByDay[day] += b.amount;
            if (!approved[b.payee]) paidUnapproved++;
            if (b.amount > perPayment) paidOverPerPayment++;
            if (spentByDay[day] > perDay) paidOverPerDay++;
            if (isPaused) paidUnapproved++;
        } catch {
            refusals++;
        }
    }

    // --------------------------------------------- vendors, thieves, time

    function vendorBills(uint96 amount) external {
        amount = uint96(bound(amount, 1, 25 ether));
        vm.prank(VENDOR);
        bills.push(vault.createBill(OWNER, NATIVE, amount, keccak256(abi.encode(amount))));
    }

    function thiefBills(uint96 amount) external {
        amount = uint96(bound(amount, 1, 25 ether));
        vm.prank(THIEF);
        bills.push(vault.createBill(OWNER, NATIVE, amount, bytes32(0)));
    }

    /// Someone other than the owner tries to pay a bill.
    function strangerPays(uint256 pick, bool asThief) external {
        if (bills.length == 0) return;
        vm.prank(asThief ? THIEF : VENDOR);
        try vault.payBill(bills[pick % bills.length]) {
            strangerPaid++;
        } catch {
            refusals++;
        }
    }

    /// The thief tries every admin action with signatures it made up.
    function thiefForges(uint8 what, uint256 seed, uint96 amount) external {
        bytes memory sig = _forged(seed);
        vm.startPrank(THIEF);
        if (what % 4 == 0) {
            try vault.setPayee(OWNER, THIEF, true, sig) { forgedAdminAccepted++; } catch { refusals++; }
        } else if (what % 4 == 1) {
            try vault.setLimits(OWNER, NATIVE, type(uint256).max, type(uint256).max, sig) { forgedAdminAccepted++; } catch { refusals++; }
        } else if (what % 4 == 2) {
            try vault.setPaused(OWNER, false, sig) { forgedAdminAccepted++; } catch { refusals++; }
        } else {
            try vault.withdraw(OWNER, NATIVE, bound(amount, 1, 1_000 ether), sig) { forgedAdminAccepted++; } catch { refusals++; }
        }
        vm.stopPrank();
    }

    /// A real owner signature, replayed after it was used.
    function thiefReplays() external {
        bytes memory m = vault.messageFor(OWNER, vault.ACTION_PAYEE(), keccak256(abi.encode(THIEF, true)));
        // A signature the owner might have made for an earlier nonce does not match the current message.
        bytes memory stale = new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH);
        bytes32 tag = keccak256(abi.encodePacked(ownerKey, m, "stale"));
        assembly {
            mstore(add(stale, 32), tag)
        }
        vm.prank(THIEF);
        try vault.setPayee(OWNER, THIEF, true, stale) { forgedAdminAccepted++; } catch { refusals++; }
    }

    /// The thief sends value straight at the vault.
    function thiefSendsValue(uint96 amount) external {
        amount = uint96(bound(amount, 1, 10 ether));
        vm.prank(THIEF);
        (bool ok, ) = address(vault).call{value: amount}("");
        if (ok) forgedAdminAccepted++; // receive() must refuse loose value
    }

    function passTime(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 3 days));
    }

    function billCount() external view returns (uint256) {
        return bills.length;
    }
}

/// forge-config: default.invariant.runs = 64
/// forge-config: default.invariant.depth = 128
contract AgentVaultInvariantTest is Test {
    AgentVault vault;
    VaultHandler handler;

    function setUp() public {
        vm.etch(QorePQC.PQC_KEY_STATUS, address(new MockKeyStatus()).code);
        vm.etch(QorePQC.PQC_VERIFY, address(new MockVerify()).code);
        vault = new AgentVault();
        bytes memory key = new bytes(QorePQC.ML_DSA_87_PUBLIC_KEY_LENGTH);
        key[0] = 0x42;
        MockKeyStatus(QorePQC.PQC_KEY_STATUS).set(address(0xA11CE), key, 1, true);
        handler = new VaultHandler(vault, key);
        targetContract(address(handler));
    }

    /// The vault always holds exactly what its owners are owed: nothing appears, nothing leaks.
    function invariant_solvent() public view {
        assertEq(address(vault).balance, vault.balanceOf(handler.OWNER(), address(0)));
        assertEq(vault.balanceOf(handler.OWNER(), address(0)), handler.deposited() - handler.paidOut() - handler.withdrawn());
    }

    /// No signature the owner did not make ever changes payees, limits, the pause or the balance.
    function invariant_forgeriesNeverWork() public view {
        assertEq(handler.forgedAdminAccepted(), 0);
    }

    /// Every payment went to a payee the owner approved, while not paused, within both limits.
    function invariant_paymentsStayInsideTheRules() public view {
        assertEq(handler.paidUnapproved(), 0);
        assertEq(handler.paidOverPerPayment(), 0);
        assertEq(handler.paidOverPerDay(), 0);
    }

    /// Only the owner's account can pay its bills.
    function invariant_onlyTheOwnerPays() public view {
        assertEq(handler.strangerPaid(), 0);
    }

    /// The thief never ends up with more than it started with.
    function invariant_thiefGainsNothing() public view {
        assertLe(handler.THIEF().balance, handler.thiefStart());
    }

    /// No bill is ever paid twice.
    function invariant_noDoublePay() public view {
        uint256 n = handler.billCount();
        for (uint256 i = 0; i < n; i++) {
            assertLe(handler.timesPaid(handler.bills(i)), 1);
        }
    }
}

/// Fuzzed single properties, for any input forge can find.
contract AgentVaultFuzzTest is Test {
    AgentVault vault;
    bytes key;
    address constant OWNER = address(0xA11CE);
    address constant VENDOR = address(0xCAFE);

    function setUp() public {
        vm.etch(QorePQC.PQC_KEY_STATUS, address(new MockKeyStatus()).code);
        vm.etch(QorePQC.PQC_VERIFY, address(new MockVerify()).code);
        vault = new AgentVault();
        key = new bytes(QorePQC.ML_DSA_87_PUBLIC_KEY_LENGTH);
        key[0] = 0x42;
        MockKeyStatus(QorePQC.PQC_KEY_STATUS).set(OWNER, key, 1, true);
        vm.deal(OWNER, 1_000 ether);
    }

    function _sig(bytes memory message) internal view returns (bytes memory sig) {
        sig = new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH);
        bytes32 tag = keccak256(abi.encodePacked(key, message));
        assembly {
            mstore(add(sig, 32), tag)
        }
    }

    /// Any 4,627-byte signature that is not the owner's is refused, whatever its contents.
    function testFuzz_anyForgedSignatureIsRefused(bytes32 head, bytes32 tail, address payee) public {
        vm.assume(payee != address(0)); // refused earlier, as ZeroAddress
        bytes memory m = vault.messageFor(OWNER, vault.ACTION_PAYEE(), keccak256(abi.encode(payee, true)));
        vm.assume(head != keccak256(abi.encodePacked(key, m)));
        bytes memory sig = new bytes(QorePQC.ML_DSA_87_SIGNATURE_LENGTH);
        assembly {
            mstore(add(sig, 32), head)
            mstore(add(sig, 4627), tail)
        }
        vm.expectRevert(AgentVault.InvalidSignature.selector);
        vault.setPayee(OWNER, payee, true, sig);
        assertFalse(vault.payeeApproved(OWNER, payee));
    }

    /// A signature of the wrong length is refused before anything else.
    function testFuzz_wrongLengthSignatureIsRefused(uint16 len) public {
        vm.assume(len != QorePQC.ML_DSA_87_SIGNATURE_LENGTH);
        len = uint16(bound(len, 0, 9000));
        vm.expectRevert();
        vault.setPayee(OWNER, VENDOR, true, new bytes(len));
    }

    /// A payment is made if and only if the bill fits under the per-payment limit (with funds and approval in place).
    function testFuzz_perPaymentLimitIsExact(uint96 amount, uint96 limit) public {
        amount = uint96(bound(amount, 1, 100 ether));
        limit = uint96(bound(limit, 0, 100 ether));
        vm.prank(OWNER);
        vault.deposit{value: 200 ether}(OWNER);
        vault.setPayee(OWNER, VENDOR, true, _sig(vault.messageFor(OWNER, vault.ACTION_PAYEE(), keccak256(abi.encode(VENDOR, true)))));
        vault.setLimits(OWNER, address(0), limit, type(uint128).max, _sig(vault.messageFor(OWNER, vault.ACTION_LIMITS(), keccak256(abi.encode(address(0), uint256(limit), uint256(type(uint128).max))))));
        vm.prank(VENDOR);
        uint256 id = vault.createBill(OWNER, address(0), amount, bytes32(0));
        uint256 before = VENDOR.balance;
        vm.prank(OWNER);
        if (amount > limit) {
            vm.expectRevert(abi.encodeWithSelector(AgentVault.OverPaymentLimit.selector, uint256(amount), uint256(limit)));
            vault.payBill(id);
            assertEq(VENDOR.balance, before);
        } else {
            vault.payBill(id);
            assertEq(VENDOR.balance, before + amount);
        }
    }

    /// Withdrawing more than the balance is refused even with the owner's own signature.
    function testFuzz_cannotWithdrawMoreThanHeld(uint96 held, uint96 ask) public {
        held = uint96(bound(held, 1, 100 ether));
        ask = uint96(bound(ask, uint256(held) + 1, type(uint96).max));
        vm.prank(OWNER);
        vault.deposit{value: held}(OWNER);
        bytes memory sig = _sig(vault.messageFor(OWNER, vault.ACTION_WITHDRAW(), keccak256(abi.encode(address(0), uint256(ask)))));
        vm.expectRevert();
        vault.withdraw(OWNER, address(0), ask, sig);
        assertEq(vault.balanceOf(OWNER, address(0)), held);
    }
}
