/**
 * The attacker: someone who holds the account's classical (ECDSA) key and
 * nothing else. This is the Q-Day Drill's threat model, run by us first.
 *
 *   npm run attack
 *
 * It uses ONLY the secp256k1 private key of the dev account (the ML-DSA key
 * is derived but never used) and tries what that key alone could do. Every
 * attempt must be refused by the chain. Run `npm run spike` first so the
 * account is funded and has its post-quantum key registered.
 */
import { EthNativeSigner, msg, deriveUnifiedAccount } from "@qorechain/sdk";
import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readAccount } from "../lib/chain/read";
import { openWindowMessage } from "../lib/messages";
import { NETWORKS } from "../lib/networks";
import { fail, info, loadMnemonic, ok, step } from "./lib";

const net = NETWORKS.testnet;
const SINK = "0x000000000000000000000000000000000000dEaD";

type Json = Record<string, unknown>;

async function broadcastClassical(txRawBytes: Uint8Array): Promise<{ refused: boolean; detail: string }> {
  const res = await fetch(`${net.rest}/cosmos/tx/v1beta1/txs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx_bytes: Buffer.from(txRawBytes).toString("base64"), mode: "BROADCAST_MODE_SYNC" }),
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  const txr = (body.tx_response ?? {}) as Json;
  const code = Number(txr.code ?? (res.ok ? 0 : -1));
  const detail = String(txr.raw_log ?? body.message ?? `HTTP ${res.status}`);
  return { refused: code !== 0, detail: `${String(txr.codespace ?? "")} code ${code}: ${detail}`.trim() };
}

async function main() {
  const { mnemonic } = loadMnemonic();
  const victim = await deriveUnifiedAccount(mnemonic);
  const before = await readAccount("testnet", victim.cosmos);
  console.log(`Victim   ${victim.cosmos}\n         ${victim.evm}`);
  if (!before.pqc.registered) {
    console.log("\nThis account has no post-quantum key, so the classical key owns it. Run `npm run spike` first.");
    process.exitCode = 2;
    return;
  }
  if (before.window?.live) {
    info("Note: a window is live. Attempts inside its bounds are expected to pass; close it for a clean run.");
  }

  const acct = await fetch(`${net.rest}/cosmos/auth/v1beta1/accounts/${victim.cosmos}`).then((r) => r.json() as Promise<Json>);
  const a = (acct.account ?? {}) as Json;
  const seq = { accountNumber: BigInt(String(a.account_number ?? "0")), sequence: BigInt(String(a.sequence ?? "0")) };
  const fee = { amount: [{ denom: "uqor", amount: "40000" }], gas: "400000" };
  const classical = new EthNativeSigner(victim, { signMode: "classical" });
  let breaches = 0;

  step(1, "Native transfer signed with the classical key alone");
  {
    const signed = classical.sign({
      chainId: net.chainId,
      messages: [msg.bank.send({ fromAddress: victim.cosmos, toAddress: victim.cosmos, amount: [{ denom: "uqor", amount: "1" }] })],
      fee,
      ...seq,
    });
    const r = await broadcastClassical(signed.txRawBytes);
    if (r.refused) ok(`refused: ${r.detail.slice(0, 160)}`);
    else {
      breaches++;
      fail(`ACCEPTED: ${r.detail}`);
    }
  }

  step(2, "Open an EVM window with the classical key alone");
  {
    const signed = classical.sign({
      chainId: net.chainId,
      messages: [openWindowMessage(victim.cosmos, { blocks: 100, maxTxs: 5, maxValueUqor: "1000000" })],
      fee,
      ...seq,
    });
    const r = await broadcastClassical(signed.txRawBytes);
    if (r.refused) ok(`refused: ${r.detail.slice(0, 160)}`);
    else {
      breaches++;
      fail(`ACCEPTED: ${r.detail}`);
    }
  }

  step(3, "EVM transfer with no window open");
  {
    const wallet = createWalletClient({
      account: privateKeyToAccount(victim.privateKey as `0x${string}`),
      transport: http(net.evmRpc),
      chain: {
        id: net.evmChainId,
        name: "QoreChain Testnet",
        nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
        rpcUrls: { default: { http: [net.evmRpc] } },
      },
    });
    try {
      const hash = await wallet.sendTransaction({ to: SINK, value: parseEther("0.001"), gas: 21_000n });
      if (before.window?.live) info(`sent inside the live window: ${hash}`);
      else {
        breaches++;
        fail(`ACCEPTED: ${hash}`);
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      ok(`refused: ${text.split("\n").find((l) => /window|pqc|PQC/.test(l))?.trim() ?? text.slice(0, 160)}`);
    }
  }

  const after = await readAccount("testnet", victim.cosmos);
  console.log(`\nBalance before ${before.balanceUqor} uqor, after ${after.balanceUqor} uqor.`);
  console.log(breaches === 0 ? "Result: the classical key alone moved nothing." : `Result: ${breaches} attempt(s) got through.`);
  process.exitCode = breaches === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`\nStopped: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
