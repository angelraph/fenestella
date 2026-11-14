import type { closeEvmWindowMsg } from "@qorechain/sdk";
import type { NetworkId } from "../networks";

/** A typed native-lane message, as the SDK's builders return it. */
export type ChainMessage = ReturnType<typeof closeEvmWindowMsg>;

export interface BroadcastResult {
  txHash: string;
  height?: string;
  /** QoreX's own check that the committed transaction carries the ML-DSA-87 layer. */
  shield?: string;
}

/**
 * Something that can hybrid-sign and broadcast native-lane messages for one
 * account. Fenestella never holds a key itself: QoreX signs in the wallet, and
 * the local signer exists only for testnet development and scripts.
 */
export interface Signer {
  kind: "qorex" | "local";
  label: string;
  network: NetworkId;
  /** `qor1…` */
  address: string;
  signAndBroadcast(messages: ChainMessage[], memo?: string): Promise<BroadcastResult>;
}

export class SignerError extends Error {
  readonly code: "not-installed" | "unsupported" | "rejected" | "refused-type" | "chain" | "network";
  constructor(code: SignerError["code"], message: string) {
    super(message);
    this.name = "SignerError";
    this.code = code;
  }
}
