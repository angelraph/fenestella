import type { NextConfig } from "next";

// The chain's REST and Tendermint RPC endpoints send no CORS headers, so the
// browser reaches them through same-origin rewrites. Nothing is stored or
// altered on the way; it is a plain pass-through to the public endpoints.
const config: NextConfig = {
  transpilePackages: ["@fenestella/connect"],
  async rewrites() {
    return [
      { source: "/chain/testnet/rest/:path*", destination: "https://api-testnet.qore.host/:path*" },
      { source: "/chain/testnet/rpc/:path*", destination: "https://rpc-testnet.qore.host/:path*" },
      { source: "/chain/testnet/rpc", destination: "https://rpc-testnet.qore.host/" },
      { source: "/chain/mainnet/rest/:path*", destination: "https://api.qore.host/:path*" },
      { source: "/chain/mainnet/rpc/:path*", destination: "https://rpc.qore.host/:path*" },
      { source: "/chain/mainnet/rpc", destination: "https://rpc.qore.host/" },
    ];
  },
};

export default config;
