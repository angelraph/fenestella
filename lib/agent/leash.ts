import {
  buildMetaMaskExecuteEvm,
  linkAuthenticatorMsgs,
  msg,
  revokeAuthenticatorMsg,
  signAuthenticatorLinkEip191,
} from "@qorechain/sdk";
import { encodeFunctionData, hexToBytes, parseAbi, toFunctionSelector, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ChainMessage } from "../signer/types";

/**
 * The leash an agent wears: a key linked to the owner's account that may only
 * call `Bills.pay`, bounded by a spending rule the chain enforces. The agent
 * never holds the owner's keys and never needs an EVM window: a relayer
 * broadcasts each payment the agent signs, and the chain checks the rule.
 */
export const BILLS_ABI = parseAbi([
  "function pay(uint256 id) payable",
  "function createBill(address payer, uint256 amount, bytes32 memoHash) returns (uint256 id)",
  "function billOf(uint256 id) view returns ((address payee, address payer, uint256 amount, bytes32 memoHash, bool paid))",
  "function count() view returns (uint256)",
  "event BillCreated(uint256 indexed id, address indexed payee, address indexed payer, uint256 amount, bytes32 memoHash)",
  "event BillPaid(uint256 indexed id, address indexed payer, address indexed payee, uint256 amount)",
]);

export const PAY_SELECTOR = toFunctionSelector("pay(uint256)");

/** 1 uqor = 10^12 aqor (wei). The EVM lane counts value in aqor. */
export const AQOR_PER_UQOR = 1_000_000_000_000n;

export interface LeashTerms {
  /** The contract the agent may call (the owner's AgentVault, or the older Bills). */
  bills: string;
  /** The one function of it the agent may call; defaults to Bills.pay. */
  selector?: string;
  /** Most one payment may move, in uqor. */
  perTxUqor: bigint;
  /** Most all payments together may move per UTC day, in uqor. */
  dailyUqor: bigint;
  /** When the link expires, unix seconds. */
  expiryUnix: number;
  label?: string;
  ruleId?: string;
}

export function leashRule(t: LeashTerms) {
  return {
    id: t.ruleId ?? "fenestella-agent",
    enabled: true,
    perTxLimit: t.perTxUqor.toString(),
    dailyLimit: t.dailyUqor.toString(),
    allowedDenoms: ["uqor"],
    allowedEvmCalls: [`${t.bills.toLowerCase()}/${t.selector ?? PAY_SELECTOR}`],
    denomLimits: [],
  };
}

export function agentAddress(agentPrivateKey: Hex): string {
  return privateKeyToAccount(agentPrivateKey).address;
}

/**
 * The owner-signed messages that put the agent on its leash, in one
 * transaction: replace the account's spending rules with the agent's rule,
 * then link the agent key with the `evm` permission only. `proof` is the
 * agent's signature over the chain's link text for this account, which shows
 * it holds the key being linked.
 */
export function linkAgentMessagesFromProof(opts: {
  owner: string;
  chainId: string;
  proof: { pubkey: Uint8Array; possessionProof: Uint8Array };
  terms: LeashTerms;
}): ChainMessage[] {
  return linkAuthenticatorMsgs({
    owner: opts.owner,
    chainId: opts.chainId,
    scheme: "secp256k1",
    pubkey: opts.proof.pubkey,
    possessionProof: opts.proof.possessionProof,
    permissions: ["evm"],
    expiryUnix: opts.terms.expiryUnix,
    label: opts.terms.label ?? "Fenestella bill payer",
    spendingRule: leashRule(opts.terms),
  }) as ChainMessage[];
}

/** The agent's possession proof for linking to `owner` (needs the agent key; server or scripts only). */
export function agentLinkProof(agentPrivateKey: Hex, owner: string, chainId: string) {
  const p = signAuthenticatorLinkEip191({ chainId, account: owner, privateKey: agentPrivateKey });
  return { pubkey: p.pubkey, possessionProof: p.possessionProof };
}

export function linkAgentMessages(opts: { owner: string; chainId: string; agentPrivateKey: Hex; terms: LeashTerms }): ChainMessage[] {
  return linkAgentMessagesFromProof({
    owner: opts.owner,
    chainId: opts.chainId,
    proof: agentLinkProof(opts.agentPrivateKey, opts.owner, opts.chainId),
    terms: opts.terms,
  });
}

/** Owner-signed: create the account's abstract-account record, needed once before linking keys. */
export function createAbstractAccountMessage(owner: string): ChainMessage {
  return msg.abstractaccount.createAbstractAccount({ owner, accountType: "session_based" }) as ChainMessage;
}

/** Owner-signed: cut any linked key off at once, whatever its scheme. */
export function revokeKeyMessage(owner: string, scheme: string, pubkeyHex: string): ChainMessage {
  const hex = (pubkeyHex.startsWith("0x") ? pubkeyHex : `0x${pubkeyHex}`) as Hex;
  return revokeAuthenticatorMsg({ owner, scheme: scheme === "ed25519" ? "ed25519" : "secp256k1", pubkey: hexToBytes(hex) }) as ChainMessage;
}

/** Owner-signed: cut the agent off at once. */
export function revokeAgentMessage(owner: string, agentEvmAddress: string): ChainMessage {
  const pubkey = hexToBytes(agentEvmAddress as Hex);
  return revokeAuthenticatorMsg({ owner, scheme: "secp256k1", pubkey }) as ChainMessage;
}

/** An EIP-1193 provider backed by a local key, enough for the SDK's personal_sign path. */
function keyProvider(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  return {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [account.address];
      if (method === "personal_sign") {
        const message = String((params ?? [])[0]);
        return account.signMessage({ message: { raw: message as Hex } });
      }
      throw new Error(`Agent key provider: ${method} is not supported`);
    },
  };
}

/** The agent signs one instruction; the relayer will broadcast it and pay the fee. */
export async function agentExecuteEvm(opts: {
  agentPrivateKey: Hex;
  account: string;
  relayer: string;
  chainId: string;
  to: string;
  valueUqor?: bigint;
  data?: Hex;
  gasLimit?: number;
  nonce: bigint;
  digestVersion: "v1" | "v2";
}): Promise<ChainMessage> {
  const address = agentAddress(opts.agentPrivateKey);
  return (await buildMetaMaskExecuteEvm({
    provider: keyProvider(opts.agentPrivateKey) as never,
    address,
    relayer: opts.relayer,
    chainId: opts.chainId,
    account: opts.account,
    to: opts.to,
    value: ((opts.valueUqor ?? 0n) * AQOR_PER_UQOR).toString(),
    data: opts.data ? hexToBytes(opts.data) : new Uint8Array(),
    gasLimit: opts.gasLimit ?? 200_000,
    nonce: opts.nonce,
    digestVersion: opts.digestVersion,
  })) as ChainMessage;
}

export function payCalldata(billId: bigint): Hex {
  return encodeFunctionData({ abi: BILLS_ABI, functionName: "pay", args: [billId] });
}

/**
 * Owner-signed: point the agent's leash at the owner's AgentVault. The agent
 * key may then call only `AgentVault.payBill`, and the account's own balance
 * is capped at 1 uqor a payment and a day: payments come from the vault.
 */
export function vaultLeashMessage(owner: string, vault: string, selector: string): ChainMessage {
  return msg.abstractaccount.updateSpendingRules({
    owner,
    accountAddress: owner,
    rules: [leashRule({ bills: vault, selector, perTxUqor: 1n, dailyUqor: 1n, expiryUnix: 0 })],
  }) as ChainMessage;
}
