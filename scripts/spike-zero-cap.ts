/**
 * Spike: can a spending rule capped at 1 uqor still let the agent call a
 * contract (value 0), while refusing any plain transfer? This is what the
 * AgentVault design rests on: the vault pays, the owner's account moves
 * nothing, so the owner's rule can be nearly zero.
 *
 *   npx tsx --conditions=react-server scripts/spike-zero-cap.ts [account]
 *
 * Uses a throwaway account that already linked the agent (default demo3).
 */
import { fetchAuthNonce, msg, resolveEvmAuthDigestVersion } from "@qorechain/sdk";
import { encodeFunctionData, keccak256, toBytes, toFunctionSelector, type Hex } from "viem";
import deployments from "../deployments.testnet.json";
import { readAccount } from "../lib/chain/read";
import { executionFailures, waitForTx } from "../lib/chain/tx";
import { agentAddress, agentExecuteEvm, BILLS_ABI } from "../lib/agent/leash";
import { agentKeyFor } from "../lib/agent/server";
import { NETWORKS } from "../lib/networks";
import { signerFor } from "./lib-accounts";
import { fail, info, ok, step } from "./lib";
import { readFileSync } from "node:fs";

const net = NETWORKS.testnet;
const BILLS = deployments.contracts.Bills.address as Hex;
const owner = await signerFor(process.argv[2] ?? "demo3");
const relayer = await signerFor("relayer");
const master = readFileSync(".keys/agent.key", "utf8").trim() as Hex;
const agentKey = agentKeyFor(master, owner.address);
const agent = agentAddress(agentKey);
console.log(`owner ${owner.address} (${owner.evmAddress}), agent ${agent}`);

const t0 = await readAccount("testnet", owner.address);
const key = t0.abstractAccount.authenticators.find((a) => a.pubkeyHex.toLowerCase() === agent.slice(2).toLowerCase());
if (!key || key.revoked) throw new Error("the agent is not linked to this account");
const rule = t0.abstractAccount.rules.find((r) => r.enabled);
info(`current rule: ${rule?.id} per-tx ${rule?.perTxLimit} daily ${rule?.dailyLimit} calls ${rule?.allowedEvmCalls.join(",")}`);

step(1, "Owner sets the rule to 1 uqor a payment, 1 uqor a day, one allowed call (Bills.createBill, value 0)");
const createSel = toFunctionSelector("createBill(address,uint256,bytes32)");
const r1 = await owner.signAndBroadcast(
  [
    msg.abstractaccount.updateSpendingRules({
      owner: owner.address,
      accountAddress: owner.address,
      rules: [
        {
          id: rule?.id ?? "fenestella-agent",
          enabled: true,
          perTxLimit: "1",
          dailyLimit: "1",
          allowedDenoms: ["uqor"],
          allowedEvmCalls: [`${BILLS.toLowerCase()}/${createSel}`],
          denomLimits: [],
        },
      ],
    }),
  ],
  "fenestella spike: near-zero rule",
);
ok(`rule updated (${r1.txHash})`);

async function relay(to: Hex, valueUqor: bigint, data: Hex | undefined, memo: string) {
  const [digestVersion, nonce] = await Promise.all([
    resolveEvmAuthDigestVersion({ rest: net.rest }),
    fetchAuthNonce({ rest: net.rest, address: owner.address, pubkey: agent }),
  ]);
  const m = await agentExecuteEvm({ agentPrivateKey: agentKey, account: owner.address, relayer: relayer.address, chainId: net.chainId, to, valueUqor, data, nonce: nonce.nonce, digestVersion });
  const sent = await relayer.signAndBroadcast([m], memo);
  const tx = await waitForTx(net.rest, sent.txHash);
  return { hash: sent.txHash, refused: executionFailures(tx)[0]?.attributes.reason ?? null };
}

step(2, "Agent calls the allowed contract function with value 0");
const data = encodeFunctionData({ abi: BILLS_ABI, functionName: "createBill", args: [owner.evmAddress as Hex, 1n, keccak256(toBytes("spike"))] });
const a = await relay(BILLS, 0n, data, "fenestella spike: value-0 call");
(a.refused ? fail : ok)(`value-0 call: ${a.refused ?? "accepted"} (${a.hash})`);

step(3, "Agent tries a plain transfer of 2 uqor to a thief");
const b = await relay("0x000000000000000000000000000000000000dEaD", 2n, undefined, "fenestella spike: plain transfer");
(b.refused ? ok : fail)(`plain transfer: ${b.refused ?? "ACCEPTED"} (${b.hash})`);

step(4, "Agent tries a call that is not on the list (Bills.pay)");
const c = await relay(BILLS, 0n, encodeFunctionData({ abi: BILLS_ABI, functionName: "pay", args: [0n] }), "fenestella spike: off-list call");
(c.refused ? ok : fail)(`off-list call: ${c.refused ?? "ACCEPTED"} (${c.hash})`);
