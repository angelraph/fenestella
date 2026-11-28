# QoreScan: what cryptography Fenestella actually uses

On 28 November 2026 I ran [QoreScan](https://github.com/qorechain/qorescan), QoreChain's own crypto inventory tool, over Fenestella's contracts, two of its testnet accounts and the live site's TLS. It reads only, never private keys. To run it again: `npm run qorescan`.

- Full inventory, CycloneDX 1.6: [`qorescan-cbom.json`](qorescan-cbom.json)
- The same inventory mapped to DORA's crypto article: [`qorescan-dora.md`](qorescan-dora.md)

QoreScan says its output is an inventory aid, not a certification or an audit. That is how I read it too.

## What it found

| | Algorithm | Where | What it means for Fenestella |
|---|---|---|---|
| Post-quantum | ML-DSA-87 | `QorePQC.sol` (the `pqcVerify` and `pqcKeyStatus` precompiles), both accounts' registered keys | Every admin action on the vault (payees, limits, pause, withdraw) and every attestation in `FenestellaReceipts` is checked against the owner's registered ML-DSA-87 key on chain. The agent's reports carry its hybrid ML-DSA-87 signature (QoreSign), checked when the owner opens them. |
| Post-quantum | ML-KEM-1024 | The dev account's published encryption key | Mandates and the agent's reports are sealed (QoreSeal) to registered ML-KEM-1024 keys like this one, so only the named account can open them. |
| Hybrid | X25519MLKEM768 | TLS 1.3 on fenestella.vercel.app | The site's connection already uses a post-quantum key exchange. |
| Quantum-vulnerable | ECDSA secp256k1 | Each account's classical key, and the EVM lane | This is the key Fenestella exists to fence in. On the native lane it is only half of a hybrid signature; on the EVM lane it can act only inside a window the ML-DSA-87 key opened, and an agent key only inside its spending rule. |
| Quantum-vulnerable | Ed25519 | The 4 testnet validators' consensus keys | The chain's own, not Fenestella's. |
| Quantum-vulnerable | RSA-2048 / RSA-4096 | The site's TLS certificates | Issued by the hosting provider. Nothing in Fenestella relies on them for safety: every claim the site makes links to a receipt you can check on chain. |
| Hash | Keccak-256 | `AgentVault.sol` (message and bill hashing) | Hashing, not signing. Not affected by Shor's algorithm. |

## What it did not find

No contract of Fenestella's calls `ecrecover`. No admin path in any of them trusts a classical signature or `msg.sender`: changing a vault's payees, limits, pause or withdrawals needs a `pqcVerify`-checked ML-DSA-87 signature. `msg.sender` is used only for paying an already-approved bill (`payBill`), and the agent's key can reach that call only through the spending rule the chain enforces.
