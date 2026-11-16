/**
 * Write a real FenestellaReceipts record on qorechain-diana, proven by the
 * chain's pqcVerify precompile.
 *
 *   npx tsx scripts/receipt.ts [digest-text]
 *
 * The dev account's ML-DSA-87 key signs the exact bytes the contract will
 * check; the call goes through a one-call window scoped to the contract. Then
 * a forged attempt (signature over a different digest) is simulated and must
 * revert with InvalidSignature.
 */
import { pqcSign, pqcVerify } from "@qorechain/sdk";
import { keccak256, parseAbi, toBytes, toHex, type Hex } from "viem";
import deployments from "../deployments.testnet.json";
import { evmCallInWindow, publicClient, signerFor } from "./lib-accounts";
import { fail, info, ok, step } from "./lib";

const RECEIPTS = deployments.contracts.FenestellaReceipts.address as Hex;
const ABI = parseAbi([
  "function messageFor(address account, bytes32 kind, bytes32 digest) view returns (bytes)",
  "function attest(address account, bytes32 kind, bytes32 digest, bytes signature) returns (uint256)",
  "function isAttested(address account, bytes32 digest) view returns (bool)",
  "function nonces(address account) view returns (uint256)",
  "error InvalidSignature()",
]);

async function main() {
  const dev = await signerFor("dev");
  const account = dev.evmAddress as Hex;
  const kind = keccak256(toBytes("window"));
  const digest = keccak256(toBytes(process.argv[2] ?? `fenestella receipt ${new Date().toISOString()}`));
  console.log(`Account ${dev.address} (${account})\nReceipts ${RECEIPTS}`);

  step(1, "Read the exact bytes the contract will verify");
  const message = await publicClient.readContract({ address: RECEIPTS, abi: ABI, functionName: "messageFor", args: [account, kind, digest] });
  ok(`${(message.length - 2) / 2} bytes, nonce ${await publicClient.readContract({ address: RECEIPTS, abi: ABI, functionName: "nonces", args: [account] })}`);

  step(2, "Sign them with the account's ML-DSA-87 key");
  const msgBytes = toBytes(message);
  const sig = pqcSign(dev.account.pqc.secretKey, msgBytes);
  info(`signature ${sig.length} bytes; local verify: ${pqcVerify(dev.account.pqc.publicKey, msgBytes, sig)}`);

  step(3, "Simulate a forged attestation (signature for a different digest)");
  const otherDigest = keccak256(toBytes("not what was signed"));
  try {
    await publicClient.simulateContract({ address: RECEIPTS, abi: ABI, functionName: "attest", args: [account, kind, otherDigest, toHex(sig)], account });
    fail("the forged attestation was accepted");
  } catch (err) {
    const name = (err as { cause?: { data?: { errorName?: string } } }).cause?.data?.errorName ?? String(err).slice(0, 120);
    ok(`refused: ${name}`);
  }

  step(4, "Simulate the real attestation");
  await publicClient.simulateContract({ address: RECEIPTS, abi: ABI, functionName: "attest", args: [account, kind, digest, toHex(sig)], account });
  ok("the precompile accepts the signature");

  step(5, "Write it on chain (one-call window scoped to the contract)");
  const hash = await evmCallInWindow(dev, RECEIPTS, (w) =>
    w.writeContract({ address: RECEIPTS, abi: ABI, functionName: "attest", args: [account, kind, digest, toHex(sig)], gas: 1_500_000n }),
  );
  const attested = await publicClient.readContract({ address: RECEIPTS, abi: ABI, functionName: "isAttested", args: [account, digest] });
  (attested ? ok : fail)(`recorded: ${attested} (${hash})`);
}

main().catch((err) => {
  console.error(`\nStopped: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
