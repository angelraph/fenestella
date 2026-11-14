import { qorechainRegistry } from "@qorechain/sdk";
import { getQorexNative, hasCapability, QOREX_DOWNLOAD_URLS } from "@qorechain/qorex-types";
import { NETWORKS, type NetworkId } from "../networks";
import { SignerError, type ChainMessage, type Signer } from "./types";

export { QOREX_DOWNLOAD_URLS };

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Turn whatever QoreX threw into one of our error kinds, keeping its own words. */
export function classifyQorexError(err: unknown): SignerError {
  const text = err instanceof Error ? err.message : String(err);
  const lower = text.toLowerCase();
  if (lower.includes("reject") || lower.includes("denied") || lower.includes("cancel")) {
    return new SignerError("rejected", "You declined the request in QoreX.");
  }
  if (lower.includes("cannot display") || lower.includes("not supported") || lower.includes("managed by the wallet")) {
    return new SignerError("refused-type", `QoreX refused this kind of message: ${text}`);
  }
  if (lower.includes("unsupported chain") || lower.includes("network")) {
    return new SignerError("network", `QoreX is on a different network: ${text}`);
  }
  return new SignerError("chain", text);
}

/**
 * Connect the QoreX wallet (extension or in-app browser) on the given network.
 * QoreX builds the transaction, shows it, adds the hybrid secp256k1 +
 * ML-DSA-87 signature and broadcasts; this page only supplies the messages.
 */
export async function connectQorex(network: NetworkId): Promise<Signer> {
  const native = getQorexNative();
  if (!native) {
    throw new SignerError("not-installed", "QoreX was not found in this browser.");
  }
  if (!hasCapability(native, "signAndBroadcast")) {
    throw new SignerError("unsupported", "This QoreX build cannot sign dApp transactions yet. Update QoreX.");
  }
  const chainId = NETWORKS[network].chainId;
  let address: string;
  try {
    await native.enable(chainId);
    const key = await native.getKey(chainId);
    address = key.bech32Address;
  } catch (err) {
    throw classifyQorexError(err);
  }

  const registry = qorechainRegistry();

  return {
    kind: "qorex",
    label: "QoreX",
    network,
    address,
    async signAndBroadcast(messages: ChainMessage[], memo?: string) {
      const encoded = messages.map((m) => ({ typeUrl: m.typeUrl, value: toBase64(registry.encode(m)) }));
      let res;
      try {
        res = await native.signAndBroadcast({ chainId, messages: encoded, memo });
      } catch (err) {
        throw classifyQorexError(err);
      }
      if (res.code !== 0) {
        throw new SignerError("chain", `The chain refused the transaction (code ${res.code}). Hash ${res.txHash}.`);
      }
      if (res.shield === "downgraded") {
        throw new SignerError(
          "chain",
          `The transaction was committed without the post-quantum layer. Treat this as an alert. Hash ${res.txHash}.`,
        );
      }
      return { txHash: res.txHash, height: res.height === undefined ? undefined : String(res.height), shield: res.shield };
    },
  };
}
