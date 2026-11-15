import {
  deriveUnifiedAccount,
  EthNativeSigner,
  msg,
  signProofOfPossession,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { NETWORKS, type NetworkId } from "../networks";
import { SignerError, type BroadcastResult, type ChainMessage, type Signer } from "./types";

/**
 * A signer that holds a testnet key in memory and hybrid-signs with the SDK.
 * It exists for development, scripts and tests. It refuses mainnet: a key
 * that matters belongs in a wallet, not in a page or an env file.
 */
export interface LocalSignerOptions {
  /** REST base URL. In the browser pass the same-origin proxy path. */
  rest?: string;
  fetch?: typeof fetch;
  /** Fee per transaction. Default 400,000 gas at 0.1 uqor per gas. */
  gas?: number;
  feeUqor?: string;
  /** Shown in the UI. Default "Local testnet key". */
  label?: string;
  /** HD account index on the Ethereum path m/44'/60'/0'/0/{index}. Default 0. */
  index?: number;
}

interface AccountState {
  exists: boolean;
  accountNumber: bigint;
  sequence: bigint;
}

type Json = Record<string, unknown>;

export class LocalSigner implements Signer {
  readonly kind = "local" as const;
  readonly label: string;
  readonly network: NetworkId;
  readonly address: string;
  readonly evmAddress: string;
  readonly account: UnifiedAccount;
  private readonly rest: string;
  private readonly chainId: string;
  private readonly fetchFn: typeof fetch;
  private readonly gas: number;
  private readonly feeUqor: string;

  private constructor(network: NetworkId, account: UnifiedAccount, opts: LocalSignerOptions) {
    if (network !== "testnet") {
      throw new SignerError("unsupported", "The local signer works on testnet only. Use QoreX on mainnet.");
    }
    this.network = network;
    this.label = opts.label ?? "Local testnet key";
    this.account = account;
    this.address = account.cosmos;
    this.evmAddress = account.evm;
    this.rest = (opts.rest ?? NETWORKS[network].rest).replace(/\/$/, "");
    this.chainId = NETWORKS[network].chainId;
    this.fetchFn = opts.fetch ?? fetch.bind(globalThis);
    this.gas = opts.gas ?? 400_000;
    this.feeUqor = opts.feeUqor ?? "40000";
  }

  /** Derive the Ethereum-style (coin 60) account and its ML-DSA-87 key from a mnemonic. */
  static async fromMnemonic(network: NetworkId, mnemonic: string, opts: LocalSignerOptions = {}): Promise<LocalSigner> {
    const account = await deriveUnifiedAccount(mnemonic.trim().replace(/\s+/g, " "), opts.index ?? 0);
    return new LocalSigner(network, account, opts);
  }

  private async getJson(path: string): Promise<{ status: number; body: Json }> {
    const res = await this.fetchFn(`${this.rest}${path}`, { cache: "no-store" });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
  }

  async accountState(): Promise<AccountState> {
    const r = await this.getJson(`/cosmos/auth/v1beta1/accounts/${this.address}`);
    if (r.status === 404) return { exists: false, accountNumber: 0n, sequence: 0n };
    if (r.status !== 200) throw new SignerError("chain", "Could not read the account from the chain.");
    let a = (r.body.account ?? {}) as Json;
    if (a.base_account && typeof a.base_account === "object") a = a.base_account as Json;
    return {
      exists: true,
      accountNumber: BigInt(String(a.account_number ?? "0")),
      sequence: BigInt(String(a.sequence ?? "0")),
    };
  }

  async isPqcRegistered(): Promise<boolean> {
    const r = await this.getJson(`/qorechain/pqc/v1/account/${this.address}`);
    if (r.status !== 200 || typeof r.body.found !== "boolean") {
      throw new SignerError("chain", "Could not read the post-quantum key status.");
    }
    return r.body.found;
  }

  /**
   * Check this key against the chain before signing anything: the account's
   * registered ML-DSA-87 key, if any, must be the one derived here. Returns a
   * reason when it is not, so the caller can refuse instead of sending a
   * transaction the chain will reject.
   */
  async checkAgainstChain(): Promise<{ ok: true; registered: boolean } | { ok: false; reason: string }> {
    const r = await this.getJson(`/qorechain/pqc/v1/account/${this.address}`);
    if (r.status !== 200 || typeof r.body.found !== "boolean") {
      return { ok: false, reason: "The chain did not answer whether this account has a post-quantum key. Try again." };
    }
    if (!r.body.found) return { ok: true, registered: false };
    const registered = String(((r.body.account ?? {}) as Json).public_key ?? "");
    let ours = "";
    for (const b of this.account.pqc.publicKey) ours += String.fromCharCode(b);
    if (registered !== btoa(ours)) {
      return {
        ok: false,
        reason:
          "This phrase gives the right address, but the post-quantum key registered for the account was made another way. Fenestella cannot sign for it; use the wallet that registered the key.",
      };
    }
    return { ok: true, registered: true };
  }

  private fee() {
    return { amount: [{ denom: "uqor", amount: this.feeUqor }], gas: String(this.gas) };
  }

  private async broadcast(txBytes: Uint8Array): Promise<BroadcastResult> {
    let b64 = "";
    for (const byte of txBytes) b64 += String.fromCharCode(byte);
    const res = await this.fetchFn(`${this.rest}/cosmos/tx/v1beta1/txs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx_bytes: btoa(b64), mode: "BROADCAST_MODE_SYNC" }),
    });
    const body = (await res.json().catch(() => ({}))) as Json;
    const txr = (body.tx_response ?? {}) as Json;
    const hash = String(txr.txhash ?? "");
    const code = Number(txr.code ?? (res.ok ? 0 : 1));
    if (!hash || code !== 0) {
      const log = String(txr.raw_log ?? body.message ?? `HTTP ${res.status}`);
      throw new SignerError("chain", `The chain refused the transaction: ${log}`);
    }
    return this.waitFor(hash);
  }

  private async waitFor(hash: string, timeoutMs = 45_000): Promise<BroadcastResult> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const r = await this.getJson(`/cosmos/tx/v1beta1/txs/${hash}`);
      if (r.status !== 200) continue;
      const txr = (r.body.tx_response ?? {}) as Json;
      const code = Number(txr.code ?? 0);
      if (code !== 0) {
        throw new SignerError("chain", `The transaction failed on chain (${String(txr.codespace ?? "")} code ${code}): ${String(txr.raw_log ?? "")}`);
      }
      return { txHash: hash, height: String(txr.height ?? "") };
    }
    throw new SignerError("chain", `The transaction was sent but not seen in a block in time. Hash ${hash}.`);
  }

  /**
   * Register the account's ML-DSA-87 key with a proof of possession. This is
   * the one transaction the chain accepts with the classical signature alone,
   * which is exactly why it should happen before anyone else can do it.
   */
  async registerPqcKey(): Promise<BroadcastResult> {
    const state = await this.accountState();
    if (!state.exists) {
      throw new SignerError("chain", "This account has no funds yet. Send it test QOR from the faucet first.");
    }
    const proofOfPossession = signProofOfPossession({
      chainId: this.chainId,
      account: this.address,
      keypair: this.account.pqc,
      algorithmId: 1,
    });
    const message = msg.pqc.registerPqcKeyV2({
      sender: this.address,
      publicKey: this.account.pqc.publicKey,
      algorithmId: 1,
      ecdsaPubkey: hexToBytes(this.account.publicKey),
      keyType: "hybrid",
      proofOfPossession,
    });
    const signer = new EthNativeSigner(this.account, { signMode: "classical" });
    const signed = signer.sign({
      chainId: this.chainId,
      messages: [message],
      fee: this.fee(),
      accountNumber: state.accountNumber,
      sequence: state.sequence,
    });
    return this.broadcast(signed.txRawBytes);
  }

  async signAndBroadcast(messages: ChainMessage[], memo?: string): Promise<BroadcastResult> {
    const state = await this.accountState();
    if (!state.exists) {
      throw new SignerError("chain", "This account has no funds yet. Send it test QOR from the faucet first.");
    }
    const signer = new EthNativeSigner(this.account, { rest: this.rest, fetch: this.fetchFn as never });
    const signBytesVersion = await signer.resolveSignBytesVersion(this.chainId);
    const signed = signer.sign({
      chainId: this.chainId,
      messages,
      fee: this.fee(),
      memo,
      accountNumber: state.accountNumber,
      sequence: state.sequence,
      signBytesVersion,
    });
    return this.broadcast(signed.txRawBytes);
  }
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Sign with the testnet wallet the QoreChain Dashboard keeps for you. The
 * Dashboard has no interface other sites can call, so its recovery phrase is
 * the only way in. The phrase stays in this tab's memory. Before anything is
 * signed, the address must match the one you expect and the post-quantum key
 * must match the one the chain has registered.
 */
export async function connectDashboardWallet(
  mnemonic: string,
  expectedAddress: string,
  opts: Omit<LocalSignerOptions, "label" | "index"> = {},
): Promise<LocalSigner> {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) {
    throw new SignerError("rejected", "A recovery phrase has 12 or 24 words.");
  }
  const want = expectedAddress.trim().toLowerCase();
  let match: LocalSigner | null = null;
  const tried: string[] = [];
  for (let index = 0; index < 5; index++) {
    const s = await LocalSigner.fromMnemonic("testnet", mnemonic, { ...opts, index, label: "Dashboard wallet" });
    tried.push(s.address);
    if (!want || s.address.toLowerCase() === want || s.evmAddress.toLowerCase() === want) {
      match = s;
      break;
    }
  }
  if (!match) {
    throw new SignerError(
      "rejected",
      `This phrase does not open ${expectedAddress.trim()}. It opens ${tried[0]} and its sibling accounts. Check that you revealed the right Dashboard wallet.`,
    );
  }
  const check = await match.checkAgainstChain();
  if (!check.ok) throw new SignerError("chain", check.reason);
  return match;
}
