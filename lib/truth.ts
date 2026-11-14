import type { NetworkId } from "./networks";

/**
 * Everything the chain says about one account, in a JSON-safe shape (integers
 * are decimal strings). Each section that could not be read is named in
 * `unknown`; an unreadable section is never treated as "nothing there".
 */
export type TruthSection = "auth" | "balances" | "pqc" | "kem" | "window" | "abstractAccount" | "height";

export type KeyType =
  /** Ethereum-style key (coin 60). The only kind an EVM window works for. */
  | "eth_secp256k1"
  /** Cosmos-style key (coin 118). Cannot use the EVM lane at all. */
  | "secp256k1"
  /** The account exists but has never signed, so its public key is not on chain. */
  | "none"
  | "other";

export interface WindowTruth {
  /** Admits at least one more transaction right now. */
  live: boolean;
  openedHeight: string;
  expiryHeight: string;
  maxTxs: string;
  usedTxs: string;
  maxValue: string;
  usedValue: string;
  remainingBlocks: string;
  remainingTxs: string;
  remainingValue: string;
  nativeOnly: boolean;
  allowedTargets: string[];
}

export interface RuleTruth {
  id: string;
  enabled: boolean;
  perTxLimit: string;
  dailyLimit: string;
  allowedDenoms: string[];
  allowedEvmCalls: string[];
  denomLimits: { denom: string; perTxLimit: string; dailyLimit: string }[];
}

export interface AuthenticatorTruth {
  scheme: string;
  pubkeyHex: string;
  permissions: string[];
  expiryUnix: string;
  createdAtUnix: string;
  label: string;
  revoked: boolean;
  hasSpendRule: boolean;
  /** The key's own rule, when it carries one. */
  rule?: RuleTruth;
}

export interface AccountTruth {
  network: NetworkId;
  chainId: string;
  readAt: string;
  height: string;
  blockSeconds: number;
  address: { cosmos: string; evm: string };
  /** The account has an entry in the auth module (it has received or sent something). */
  exists: boolean;
  keyType: KeyType;
  sequence: string;
  balanceUqor: string;
  tokens: { denom: string; amount: string }[];
  pqc: { registered: boolean; algorithmId?: number; possessionProven?: boolean };
  kem: { found: boolean };
  /** `null` when no window was ever stored. */
  window: WindowTruth | null;
  abstractAccount: {
    moduleEnabled: boolean;
    account: { type: string; owner: string } | null;
    rules: RuleTruth[];
    authenticators: AuthenticatorTruth[];
  };
  unknown: TruthSection[];
}

/** Permissions that let a linked key move value. The chain refuses them without a bounding rule (v3.2.8). */
export const VALUE_PERMISSIONS = ["send", "evm", "svm", "deploy", "all"] as const;
