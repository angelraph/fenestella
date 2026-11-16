// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QorePQC} from "./QorePQC.sol";

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title AgentVault
/// @notice Where a QoreChain account keeps the budget its bill-paying agent
/// may spend. The agent acts as the owner's account (through a linked key the
/// chain bounds with a spending rule), so it cannot be told apart from the
/// owner by `msg.sender`. That is why nothing here that widens what can leave
/// trusts `msg.sender`:
///
/// - Paying is the only thing the owner's account can do directly, and only
///   for a real bill, to a payee the owner approved, within the vault's limits.
/// - Approving payees, setting limits, pausing and withdrawing need an
///   ML-DSA-87 signature by the key the chain registered for the owner,
///   checked by the pqcVerify precompile. A stolen agent key or a stolen
///   classical key cannot produce one.
///
/// Because the vault pays, the owner's account moves nothing when the agent
/// pays a bill, so the owner's spending rule can be set to almost zero: a
/// stolen agent key then cannot send plain transfers at all.
///
/// One contract serves every owner. It has no admin and no upgrade path.
contract AgentVault {
    /// @dev Domain tag of every signed message. Bump on any layout change.
    bytes public constant DOMAIN = "fenestella/agent-vault/v1";
    address public constant NATIVE = address(0);

    bytes32 public constant ACTION_PAYEE = keccak256("payee");
    bytes32 public constant ACTION_LIMITS = keccak256("limits");
    bytes32 public constant ACTION_PAUSE = keccak256("pause");
    bytes32 public constant ACTION_WITHDRAW = keccak256("withdraw");

    struct Limits {
        uint256 perPayment;
        uint256 perDay;
    }

    struct Bill {
        address owner;
        address payee;
        address token;
        uint256 amount;
        bytes32 memoHash;
        bool paid;
    }

    /// owner => token => balance
    mapping(address => mapping(address => uint256)) public balanceOf;
    /// owner => payee => approved
    mapping(address => mapping(address => bool)) public payeeApproved;
    /// owner => token => limits (zero limits mean the token cannot be paid out)
    mapping(address => mapping(address => Limits)) public limitsOf;
    /// owner => token => day => spent
    mapping(address => mapping(address => mapping(uint256 => uint256))) public spentOn;
    mapping(address => bool) public paused;
    /// owner => nonce of the next signed admin message
    mapping(address => uint256) public nonces;

    Bill[] private _bills;
    bool private _entered;

    event Deposited(address indexed owner, address indexed token, address indexed from, uint256 amount);
    event PayeeSet(address indexed owner, address indexed payee, bool approved);
    event LimitsSet(address indexed owner, address indexed token, uint256 perPayment, uint256 perDay);
    event PauseSet(address indexed owner, bool paused);
    event Withdrawn(address indexed owner, address indexed token, uint256 amount);
    event BillCreated(uint256 indexed id, address indexed owner, address indexed payee, address token, uint256 amount, bytes32 memoHash);
    event BillPaid(uint256 indexed id, address indexed owner, address indexed payee, address token, uint256 amount);

    error InvalidSignature();
    error NotTheOwner(address caller);
    error UnknownBill(uint256 id);
    error AlreadyPaid(uint256 id);
    error PayeeNotApproved(address payee);
    error OverPaymentLimit(uint256 amount, uint256 limit);
    error OverDailyLimit(uint256 wouldSpend, uint256 limit);
    error InsufficientBalance(uint256 amount, uint256 balance);
    error VaultPaused();
    error ZeroAmount();
    error ZeroAddress();
    error WrongValue();
    error TransferFailed();
    error Reentered();
    error NotAToken(address token);

    modifier nonReentrant() {
        if (_entered) revert Reentered();
        _entered = true;
        _;
        _entered = false;
    }

    // ------------------------------------------------------------------ money in

    /// @notice Add native QOR to `owner`'s vault. Anyone may top up anyone.
    function deposit(address owner) external payable {
        if (owner == address(0)) revert ZeroAddress();
        if (msg.value == 0) revert ZeroAmount();
        balanceOf[owner][NATIVE] += msg.value;
        emit Deposited(owner, NATIVE, msg.sender, msg.value);
    }

    /// @notice Add an ERC-20 (e.g. testnet fUSD) to `owner`'s vault; needs an allowance.
    /// The owner is credited with what actually arrived, so a token that takes a
    /// fee on transfer cannot leave the vault owing more than it holds.
    function depositToken(address owner, address token, uint256 amount) external nonReentrant {
        if (owner == address(0) || token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 before = _tokenBalance(token);
        _call(token, abi.encodeCall(IERC20Minimal.transferFrom, (msg.sender, address(this), amount)));
        uint256 received = _tokenBalance(token) - before;
        if (received == 0) revert ZeroAmount();
        balanceOf[owner][token] += received;
        emit Deposited(owner, token, msg.sender, received);
    }

    // --------------------------------------------------------------------- bills

    /// @notice Post a bill to `owner`, payable to the caller.
    function createBill(address owner, address token, uint256 amount, bytes32 memoHash) external returns (uint256 id) {
        if (owner == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        id = _bills.length;
        _bills.push(Bill({owner: owner, payee: msg.sender, token: token, amount: amount, memoHash: memoHash, paid: false}));
        emit BillCreated(id, owner, msg.sender, token, amount, memoHash);
    }

    /// @notice Pay a bill from the owner's vault. Only the billed owner's account
    /// (the owner, or its agent acting for it) may call it, and only for an
    /// approved payee within the owner's limits.
    function payBill(uint256 id) external nonReentrant {
        if (id >= _bills.length) revert UnknownBill(id);
        Bill storage bill = _bills[id];
        address owner = bill.owner;
        if (msg.sender != owner) revert NotTheOwner(msg.sender);
        if (bill.paid) revert AlreadyPaid(id);
        if (paused[owner]) revert VaultPaused();
        if (!payeeApproved[owner][bill.payee]) revert PayeeNotApproved(bill.payee);

        Limits memory l = limitsOf[owner][bill.token];
        if (bill.amount > l.perPayment) revert OverPaymentLimit(bill.amount, l.perPayment);
        uint256 day = block.timestamp / 1 days;
        uint256 wouldSpend = spentOn[owner][bill.token][day] + bill.amount;
        if (wouldSpend > l.perDay) revert OverDailyLimit(wouldSpend, l.perDay);
        uint256 bal = balanceOf[owner][bill.token];
        if (bill.amount > bal) revert InsufficientBalance(bill.amount, bal);

        bill.paid = true;
        spentOn[owner][bill.token][day] = wouldSpend;
        balanceOf[owner][bill.token] = bal - bill.amount;
        _send(bill.token, bill.payee, bill.amount);
        emit BillPaid(id, owner, bill.payee, bill.token, bill.amount);
    }

    function billOf(uint256 id) external view returns (Bill memory) {
        if (id >= _bills.length) revert UnknownBill(id);
        return _bills[id];
    }

    function billCount() external view returns (uint256) {
        return _bills.length;
    }

    // ------------------------------------------------- owner, post-quantum only

    /// @notice The exact bytes the owner's ML-DSA-87 key signs for its next admin action.
    function messageFor(address owner, bytes32 action, bytes32 paramsHash) public view returns (bytes memory) {
        return abi.encodePacked(DOMAIN, block.chainid, address(this), owner, nonces[owner], action, paramsHash);
    }

    function setPayee(address owner, address payee, bool approved, bytes calldata signature) external {
        if (payee == address(0)) revert ZeroAddress();
        _authorize(owner, ACTION_PAYEE, keccak256(abi.encode(payee, approved)), signature);
        payeeApproved[owner][payee] = approved;
        emit PayeeSet(owner, payee, approved);
    }

    function setLimits(address owner, address token, uint256 perPayment, uint256 perDay, bytes calldata signature) external {
        _authorize(owner, ACTION_LIMITS, keccak256(abi.encode(token, perPayment, perDay)), signature);
        limitsOf[owner][token] = Limits({perPayment: perPayment, perDay: perDay});
        emit LimitsSet(owner, token, perPayment, perDay);
    }

    function setPaused(address owner, bool isPaused, bytes calldata signature) external {
        _authorize(owner, ACTION_PAUSE, keccak256(abi.encode(isPaused)), signature);
        paused[owner] = isPaused;
        emit PauseSet(owner, isPaused);
    }

    /// @notice Send `amount` of `token` back to the owner's own address. Works while paused.
    function withdraw(address owner, address token, uint256 amount, bytes calldata signature) external nonReentrant {
        _authorize(owner, ACTION_WITHDRAW, keccak256(abi.encode(token, amount)), signature);
        uint256 bal = balanceOf[owner][token];
        if (amount > bal) revert InsufficientBalance(amount, bal);
        balanceOf[owner][token] = bal - amount;
        _send(token, owner, amount);
        emit Withdrawn(owner, token, amount);
    }

    // ------------------------------------------------------------------ internal

    function _authorize(address owner, bytes32 action, bytes32 paramsHash, bytes calldata signature) internal {
        (bytes memory pubkey,) = QorePQC.registeredKey(owner);
        if (!QorePQC.verify(pubkey, signature, messageFor(owner, action, paramsHash))) revert InvalidSignature();
        nonces[owner]++;
    }

    function _send(address token, address to, uint256 amount) internal {
        if (token == NATIVE) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            _call(token, abi.encodeCall(IERC20Minimal.transfer, (to, amount)));
        }
    }

    /// @dev Calls an ERC-20 and accepts both standard (returns true) and old (returns nothing) tokens.
    /// An address with no code is refused: a call to it would "succeed" without moving anything.
    function _call(address token, bytes memory data) internal {
        if (token.code.length == 0) revert NotAToken(token);
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && (ret.length != 32 || !abi.decode(ret, (bool))))) revert TransferFailed();
    }

    function _tokenBalance(address token) internal view returns (uint256) {
        if (token.code.length == 0) revert NotAToken(token);
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeCall(IERC20Minimal.balanceOf, (address(this))));
        if (!ok || ret.length < 32) revert NotAToken(token);
        return abi.decode(ret, (uint256));
    }

    /// @dev Plain transfers are refused: money must arrive through deposit(), so it is always credited to an owner.
    receive() external payable {
        revert WrongValue();
    }
}
