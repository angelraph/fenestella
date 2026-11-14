/**
 * The two QoreChain networks Fenestella reads. Endpoints are the public ones
 * from the QoreChain SDK presets; they are repeated here so that pure modules
 * (and their tests) do not have to load the SDK.
 */
export type NetworkId = "testnet" | "mainnet";

export interface Network {
  id: NetworkId;
  label: string;
  chainId: string;
  evmChainId: number;
  rest: string;
  rpc: string;
  evmRpc: string;
  explorer: string;
  /** Abstract accounts (linked keys, spending rules) are switched on by governance per network. */
  abstractAccountsExpected: boolean;
}

export const NETWORKS: Record<NetworkId, Network> = {
  testnet: {
    id: "testnet",
    label: "Testnet",
    chainId: "qorechain-diana",
    evmChainId: 9800,
    rest: "https://api-testnet.qore.host",
    rpc: "https://rpc-testnet.qore.host",
    evmRpc: "https://evm-testnet.qore.host",
    explorer: "https://explore.qore.network",
    abstractAccountsExpected: true,
  },
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    chainId: "qorechain-vladi",
    evmChainId: 9801,
    rest: "https://api.qore.host",
    rpc: "https://rpc.qore.host",
    evmRpc: "https://evm.qore.host",
    explorer: "https://explore.qore.network",
    abstractAccountsExpected: false,
  },
};

export function isNetworkId(x: unknown): x is NetworkId {
  return x === "testnet" || x === "mainnet";
}

export function networkByChainId(chainId: string): Network | undefined {
  return Object.values(NETWORKS).find((n) => n.chainId === chainId);
}

/** Same-origin paths the browser uses instead of the CORS-less public endpoints. */
export function browserEndpoints(id: NetworkId): { rest: string; rpc: string } {
  return { rest: `/chain/${id}/rest`, rpc: `/chain/${id}/rpc` };
}

/** Chain limits on an EVM authorisation window (pqc module). */
export const WINDOW_LIMITS = {
  maxBlocks: 17_280,
  maxTxs: 1_000,
  maxTargets: 16,
} as const;

export const UQOR_PER_QOR = 1_000_000n;
