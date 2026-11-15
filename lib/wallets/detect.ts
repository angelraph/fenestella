import { getQorexNative, hasCapability } from "@qorechain/qorex-types";
import { NETWORKS, type NetworkId } from "../networks";

/**
 * Find every wallet in this browser that can hold a QoreChain account.
 *
 * Three families, and they are not equal:
 *
 * - QoreX (extension, or the in-app browser of the phone app) holds the
 *   account's ML-DSA-87 key, so it is the only one that can sign a window.
 * - Cosmos wallets (Keplr, Leap, Cosmostation) hold the classical key only.
 *   Fenestella uses them to find your account; it never asks a page to hold
 *   the post-quantum key for them.
 * - EVM wallets (MetaMask, Rabby and any other EIP-6963 wallet) also hold the
 *   classical key only. They are what sends EVM transactions through a window
 *   once one is open.
 */
export type WalletFamily = "qorex" | "cosmos" | "evm";

export interface DetectedWallet {
  /** Stable id, e.g. "qorex", "keplr", "evm:io.metamask". */
  id: string;
  name: string;
  family: WalletFamily;
  /** Data-URL icon, when the wallet announces one. */
  icon?: string;
  /** True only for QoreX: it can hybrid-sign native messages. */
  canSign: boolean;
  /** What this wallet is good for here, in a few words. */
  role: string;
}

export interface ConnectedAccount {
  wallet: DetectedWallet;
  /** `qor1…` or `0x…`; the console accepts either. */
  address: string;
  network: NetworkId;
}

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193;
}
interface KeplrLike {
  enable(chainId: string): Promise<void>;
  getKey(chainId: string): Promise<{ bech32Address: string }>;
  experimentalSuggestChain?(info: unknown): Promise<void>;
}

const evmProviders = new Map<string, Eip1193>();

function cosmosProviders(): { id: string; name: string; provider: KeplrLike }[] {
  const w = window as unknown as {
    keplr?: KeplrLike;
    leap?: KeplrLike;
    cosmostation?: { providers?: { keplr?: KeplrLike } };
  };
  const out: { id: string; name: string; provider: KeplrLike }[] = [];
  if (w.keplr) out.push({ id: "keplr", name: "Keplr", provider: w.keplr });
  if (w.leap) out.push({ id: "leap", name: "Leap", provider: w.leap });
  const cs = w.cosmostation?.providers?.keplr;
  if (cs) out.push({ id: "cosmostation", name: "Cosmostation", provider: cs });
  return out;
}

/** Ask EIP-6963 wallets to announce themselves and collect answers for a short moment. */
function discoverEvm(timeoutMs: number): Promise<Eip6963Detail[]> {
  return new Promise((resolve) => {
    const found = new Map<string, Eip6963Detail>();
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail;
      if (detail?.info?.rdns && detail.provider) found.set(detail.info.rdns, detail);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

export async function detectWallets(timeoutMs = 350): Promise<DetectedWallet[]> {
  if (typeof window === "undefined") return [];
  const wallets: DetectedWallet[] = [];

  const native = getQorexNative();
  if (native) {
    const signs = hasCapability(native, "signAndBroadcast");
    wallets.push({
      id: "qorex",
      name: "QoreX",
      family: "qorex",
      canSign: signs,
      role: signs ? "Opens and closes windows" : "Update QoreX to sign from dApps",
    });
  }

  for (const c of cosmosProviders()) {
    wallets.push({ id: c.id, name: c.name, family: "cosmos", canSign: false, role: "Find and read your account" });
  }

  const announced = await discoverEvm(timeoutMs);
  evmProviders.clear();
  for (const d of announced) {
    // QoreX announces its own read-only EVM provider; the native entry above already covers it.
    if (d.info.rdns.startsWith("network.qore.qorex")) continue;
    const id = `evm:${d.info.rdns}`;
    evmProviders.set(id, d.provider);
    wallets.push({
      id,
      name: d.info.name,
      family: "evm",
      icon: d.info.icon?.startsWith("data:image/") ? d.info.icon : undefined,
      canSign: false,
      role: "Read your account; sends EVM transactions through a window",
    });
  }
  if (announced.length === 0) {
    const legacy = (window as unknown as { ethereum?: Eip1193 & { isMetaMask?: boolean } }).ethereum;
    if (legacy) {
      evmProviders.set("evm:injected", legacy);
      wallets.push({
        id: "evm:injected",
        name: legacy.isMetaMask ? "MetaMask" : "Browser wallet",
        family: "evm",
        canSign: false,
        role: "Read your account; sends EVM transactions through a window",
      });
    }
  }
  return wallets;
}

export class WalletConnectError extends Error {}

/** Connect a view-only wallet (Cosmos or EVM family) and return the account it exposes. */
export async function connectViewer(wallet: DetectedWallet, network: NetworkId): Promise<ConnectedAccount> {
  const net = NETWORKS[network];
  try {
    if (wallet.family === "evm") {
      const provider = evmProviders.get(wallet.id);
      if (!provider) throw new WalletConnectError(`${wallet.name} is no longer available. Reload the page.`);
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts?.[0];
      if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        throw new WalletConnectError(`${wallet.name} did not share an account.`);
      }
      return { wallet, address, network };
    }
    if (wallet.family === "cosmos") {
      const entry = cosmosProviders().find((c) => c.id === wallet.id);
      if (!entry) throw new WalletConnectError(`${wallet.name} is no longer available. Reload the page.`);
      try {
        await entry.provider.enable(net.chainId);
      } catch {
        // The wallet does not know QoreChain yet: offer it the chain, then try again.
        const { qoreChainInfo } = (await import("@qorechain/wallet-adapter")) as unknown as {
          qoreChainInfo(o: { chainId: string; rpc: string; rest: string }): unknown;
        };
        if (!entry.provider.experimentalSuggestChain) {
          throw new WalletConnectError(`${wallet.name} cannot add QoreChain from a website.`);
        }
        await entry.provider.experimentalSuggestChain(qoreChainInfo({ chainId: net.chainId, rpc: net.rpc, rest: net.rest }));
        await entry.provider.enable(net.chainId);
      }
      const key = await entry.provider.getKey(net.chainId);
      return { wallet, address: key.bech32Address, network };
    }
  } catch (err) {
    if (err instanceof WalletConnectError) throw err;
    const text = err instanceof Error ? err.message : String(err);
    throw new WalletConnectError(/reject|denied|cancel/i.test(text) ? `You declined the request in ${wallet.name}.` : text);
  }
  throw new WalletConnectError("QoreX connects through its own signer.");
}
