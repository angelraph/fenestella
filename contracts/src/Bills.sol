// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Bills
/// @notice The one contract Fenestella's reference agent is allowed to call.
/// A payee posts a bill for a payer; paying it forwards exactly the billed
/// amount to the payee in the same call.
///
/// The contract never holds a balance between calls, has no owner and no
/// withdraw function, so there is nothing in it to drain. What limits the
/// payer's agent is not this contract: it is the account's spending rule and
/// EVM window, enforced by the chain.
contract Bills {
    struct Bill {
        address payee;
        address payer;
        uint256 amount;
        bytes32 memoHash;
        bool paid;
    }

    Bill[] private _bills;

    event BillCreated(uint256 indexed id, address indexed payee, address indexed payer, uint256 amount, bytes32 memoHash);
    event BillPaid(uint256 indexed id, address indexed payer, address indexed payee, uint256 amount);

    error UnknownBill(uint256 id);
    error AlreadyPaid(uint256 id);
    error NotThePayer(address caller);
    error WrongAmount(uint256 sent, uint256 owed);
    error ZeroAmount();
    error ZeroPayer();
    error TransferFailed();

    /// @notice Post a bill payable to the caller.
    /// @param memoHash Hash of the invoice text or of its sealed envelope; the text itself stays off chain.
    function createBill(address payer, uint256 amount, bytes32 memoHash) external returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        if (payer == address(0)) revert ZeroPayer();
        id = _bills.length;
        _bills.push(Bill({payee: msg.sender, payer: payer, amount: amount, memoHash: memoHash, paid: false}));
        emit BillCreated(id, msg.sender, payer, amount, memoHash);
    }

    /// @notice Pay a bill in full. Only the billed payer can pay, and only the exact amount.
    function pay(uint256 id) external payable {
        if (id >= _bills.length) revert UnknownBill(id);
        Bill storage bill = _bills[id];
        if (bill.paid) revert AlreadyPaid(id);
        if (msg.sender != bill.payer) revert NotThePayer(msg.sender);
        if (msg.value != bill.amount) revert WrongAmount(msg.value, bill.amount);

        bill.paid = true;
        (bool ok,) = bill.payee.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
        emit BillPaid(id, msg.sender, bill.payee, msg.value);
    }

    function billOf(uint256 id) external view returns (Bill memory) {
        if (id >= _bills.length) revert UnknownBill(id);
        return _bills[id];
    }

    function count() external view returns (uint256) {
        return _bills.length;
    }
}
