import { encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, parseAbi, toBytes, toFunctionSelector, type Hex } from "viem";
import deployments from "../../deployments.testnet.json";

/**
 * AgentVault (contracts/src/AgentVault.sol): where an owner keeps the budget
 * its agent may spend. Shared by the browser and the server.
 */
export const VAULT = (deployments.contracts as Record<string, { address: string; block: string }>).AgentVault.address.toLowerCase() as Hex;
export const VAULT_FROM_BLOCK = BigInt((deployments.contracts as Record<string, { address: string; block: string }>).AgentVault.block);
export const NATIVE = "0x0000000000000000000000000000000000000000" as Hex;
export const DOMAIN = "fenestella/agent-vault/v1";

export const VAULT_ABI = parseAbi([
  "function deposit(address owner) payable",
  "function createBill(address owner, address token, uint256 amount, bytes32 memoHash) returns (uint256 id)",
  "function payBill(uint256 id)",
  "function billOf(uint256 id) view returns ((address owner, address payee, address token, uint256 amount, bytes32 memoHash, bool paid))",
  "function billCount() view returns (uint256)",
  "function balanceOf(address owner, address token) view returns (uint256)",
  "function payeeApproved(address owner, address payee) view returns (bool)",
  "function limitsOf(address owner, address token) view returns (uint256 perPayment, uint256 perDay)",
  "function spentOn(address owner, address token, uint256 day) view returns (uint256)",
  "function paused(address owner) view returns (bool)",
  "function nonces(address owner) view returns (uint256)",
  "function messageFor(address owner, bytes32 action, bytes32 paramsHash) view returns (bytes)",
  "function setPayee(address owner, address payee, bool approved, bytes signature)",
  "function setLimits(address owner, address token, uint256 perPayment, uint256 perDay, bytes signature)",
  "function setPaused(address owner, bool isPaused, bytes signature)",
  "function withdraw(address owner, address token, uint256 amount, bytes signature)",
  "event BillCreated(uint256 indexed id, address indexed owner, address indexed payee, address token, uint256 amount, bytes32 memoHash)",
  "event BillPaid(uint256 indexed id, address indexed owner, address indexed payee, address token, uint256 amount)",
  "error InvalidSignature()",
  "error NotTheOwner(address caller)",
  "error UnknownBill(uint256 id)",
  "error AlreadyPaid(uint256 id)",
  "error PayeeNotApproved(address payee)",
  "error OverPaymentLimit(uint256 amount, uint256 limit)",
  "error OverDailyLimit(uint256 wouldSpend, uint256 limit)",
  "error InsufficientBalance(uint256 amount, uint256 balance)",
  "error VaultPaused()",
  "error ZeroAmount()",
  "error ZeroAddress()",
  "error WrongValue()",
  "error TransferFailed()",
  "error Reentered()",
]);

export const PAY_BILL_SELECTOR = toFunctionSelector("payBill(uint256)");

export type VaultAction = "payee" | "limits" | "pause" | "withdraw";
export const ACTION: Record<VaultAction, Hex> = {
  payee: keccak256(toBytes("payee")),
  limits: keccak256(toBytes("limits")),
  pause: keccak256(toBytes("pause")),
  withdraw: keccak256(toBytes("withdraw")),
};

/** What one signed admin action asks for. */
export type VaultAdmin =
  | { action: "payee"; payee: Hex; approved: boolean }
  | { action: "limits"; token: Hex; perPayment: bigint; perDay: bigint }
  | { action: "pause"; paused: boolean }
  | { action: "withdraw"; token: Hex; amount: bigint };

export function paramsHash(a: VaultAdmin): Hex {
  switch (a.action) {
    case "payee":
      return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bool" }], [a.payee, a.approved]));
    case "limits":
      return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }], [a.token, a.perPayment, a.perDay]));
    case "pause":
      return keccak256(encodeAbiParameters([{ type: "bool" }], [a.paused]));
    case "withdraw":
      return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [a.token, a.amount]));
  }
}

/** The exact bytes the owner's ML-DSA-87 key signs; mirrors AgentVault.messageFor. */
export function adminMessage(opts: { chainId: number; owner: Hex; nonce: bigint; admin: VaultAdmin }): Hex {
  return encodePacked(
    ["bytes", "uint256", "address", "address", "uint256", "bytes32", "bytes32"],
    [toHexString(DOMAIN), BigInt(opts.chainId), VAULT, opts.owner, opts.nonce, ACTION[opts.admin.action], paramsHash(opts.admin)],
  );
}

function toHexString(s: string): Hex {
  return ("0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

/** Calldata for the admin call that carries the owner's signature. */
export function adminCalldata(owner: Hex, a: VaultAdmin, signature: Hex): Hex {
  switch (a.action) {
    case "payee":
      return encodeFunctionData({ abi: VAULT_ABI, functionName: "setPayee", args: [owner, a.payee, a.approved, signature] });
    case "limits":
      return encodeFunctionData({ abi: VAULT_ABI, functionName: "setLimits", args: [owner, a.token, a.perPayment, a.perDay, signature] });
    case "pause":
      return encodeFunctionData({ abi: VAULT_ABI, functionName: "setPaused", args: [owner, a.paused, signature] });
    case "withdraw":
      return encodeFunctionData({ abi: VAULT_ABI, functionName: "withdraw", args: [owner, a.token, a.amount, signature] });
  }
}

export function payBillCalldata(id: bigint): Hex {
  return encodeFunctionData({ abi: VAULT_ABI, functionName: "payBill", args: [id] });
}

/** The owner's vault, as the agent page shows it. Amounts in uqor. */
export interface VaultView {
  address: string;
  balanceUqor: string;
  perPaymentUqor: string;
  perDayUqor: string;
  spentTodayUqor: string;
  paused: boolean;
  nonce: string;
  vendorApproved: boolean;
}
