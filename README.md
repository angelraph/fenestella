# Fenestella

**The small window on a QoreChain account.**

A *fenestella* is the small opening cut through a thick wall: wide enough to pass one thing through, not wide enough to walk an army through. On QoreChain that opening is real. A classical (ECDSA) key can only act through the **EVM authorisation window** the account's post-quantum key opened, and the chain enforces its bounds.

Fenestella is the console for that opening:

1. **See the truth.** Paste any address. Fenestella reads the chain and answers one question in one sentence: *if this account's classical key leaked right now, what could an attacker still do?*
2. **Open a fenestella.** Open a window limited to named contracts or to plain transfers, with a transaction count, a spending cap and an expiry. Close it in one click.
3. **Let apps ask.** `@fenestella/connect` gives any dApp or agent one call, `requestWindow()`, to ask a user for exactly the window it needs. The user sees the caller's origin and the bounds in words, and approves in their own wallet.

Built for [Build Before Q-Day](https://build.qorechain.io/), the QoreChain Developer Fest. Category: Post-Quantum AI Agents. Network: `qorechain-diana` (testnet, EVM chain id 9800).

> Status: work in progress, built in public during the fest. The [Status](#status) section says exactly what works today and what does not.

## Why this exists

QoreChain's account model is its real difference. Every native transaction needs a hybrid secp256k1 + ML-DSA-87 signature. An EVM transaction is admitted only if the sender has a registered ML-DSA-87 key and an open window: up to 17,280 blocks, up to 1,000 transactions, a cap on value plus fees, and optionally a scope (plain transfers only, or at most 16 named recipients).

The chain ships all of that. The screens for it are missing:

| Gap | Where it stands today |
| --- | --- |
| Scoped windows (targets, native-only) | The QoreX window card has duration, count and cap only. Scope needs the CLI or the SDK. |
| A dApp asking for a window | No request API. Each project tells users to open one by hand. |
| Knowing your own exposure | No single place shows key, window, scope, linked keys and what they add up to. |
| Linked keys with spending rules | Live on testnet, no wallet UI yet. |

Fenestella does not replace QoreX. QoreX holds the keys and signs. Fenestella decides how far they reach and shows it.

## What a leaked key can do: how the answer is computed

`lib/exposure.ts` is a pure function from chain state to a plain-language answer. It has five outcomes:

| Level | Meaning |
| --- | --- |
| **Can be taken over** | No ML-DSA-87 key is registered. The first registration is the one transaction the chain accepts with the classical signature alone, so whoever holds the classical key can register their own and lock the owner out. This is worse than any open window. |
| **Wide open** | A live window with no scope: any contract, any recipient, up to its bounds. |
| **Scoped opening** | A live window limited to plain transfers or to named addresses. |
| **Sealed** | Key registered, no live window. The classical key alone moves nothing. |
| **Not known** | A section the answer depends on could not be read. An unreadable answer is never treated as safe. |

It also says what the chain is explicit about and people miss: the window's cap counts native QOR only, so token amounts are not capped; a token approval made through a window outlives it; and a window on a coin-118 account does nothing, because the EVM lane takes Ethereum-style keys only.

## `@fenestella/connect`

```ts
import { requestWindow, windowCovers } from "@fenestella/connect";

const granted = await requestWindow({
  reason: "Pay this month's invoices from the Bills contract.",
  allowedTargets: ["0xYourContract"],
  maxTxs: 10,
  maxValueUqor: "2000000", // 2 QOR: value plus the maximum fee of each transaction
  blocks: 1200,
  network: "testnet",
});
// granted.window is what the chain now stores for the account.
```

How it stays honest:

- The approval page opens as a popup. The caller's origin is taken from the browser (`event.origin`), never from the message.
- Each side ignores any message that does not come from the window it opened, at the origin it expects.
- The request is checked against the chain's bounds before anything is shown. Fenestella restates targets, cap, count and expiry in words; the caller does not choose that text.
- The result is the window as the chain reports it after the transaction, not what the caller asked for.

The package lives in `packages/connect`. It has no dependencies. It is not on npm yet.

## Contracts

`contracts/` is a Foundry project.

- **`QorePQC.sol`**: fail-closed access to the testnet precompiles `pqcKeyStatus` (`0x…0a02`) and `pqcVerify` (`0x…0a01`). An inactive precompile returns empty data; these helpers revert on it instead of reading it as "verified".
- **`FenestellaReceipts.sol`**: a public record of what an account's post-quantum key agreed to (a window, an agent mandate). A receipt needs an ML-DSA-87 signature by the key the chain has registered for that account. `msg.sender` is never used for authorisation, because on QoreChain an EVM transaction is signed by the classical key. No owner, no funds, no upgrade path.
- **`Bills.sol`**: the one contract the reference agent may call. Paying a bill forwards the exact amount to the payee in the same call; the contract never holds a balance.

One thing to be clear about: **a QoreX user cannot produce a raw ML-DSA-87 signature over arbitrary bytes today** (QoreX refuses `signArbitrary`). So the `pqcVerify` path of `FenestellaReceipts` is for signers that hold their own ML-DSA key (scripts, services, the SDK). For a QoreX user the attestation is the hybrid-signed native transaction itself.

## Run it

Requires Node.js 22 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests
npm run typecheck
```

Contracts (requires [Foundry](https://getfoundry.sh)):

```bash
cd contracts
forge install foundry-rs/forge-std --no-git
forge test
```

Testnet scripts. They use a throwaway key in `.keys/` (git-ignored) or `FENESTELLA_MNEMONIC`. Testnet only; never use a phrase that guards real funds.

```bash
npm run spike      # register the ML-DSA-87 key, open a scoped window, read it back, close it
npm run attack     # try everything the classical key alone can do; every attempt must be refused
npx tsx scripts/deploy.ts        # deploy both contracts (after `forge build`)
npx tsx scripts/drill.ts status  # the Q-Day Drill account: setup | proof | status
```

The first `npm run spike` prints a new address and stops. Fund it from the [faucet](https://dashboard.qorechain.io/faucet) and run it again.

## How it is put together

```
app/                 Next.js console: /, /account/[address], /request (approval page), /demo
app/api/account      Server-side chain read (the chain's REST API sends no CORS headers)
lib/chain/read.ts    Reads one account; every section fails on its own into `unknown`
lib/exposure.ts      Chain state -> what a leaked classical key can do
lib/signer/          QoreX signer (wallet signs) and a testnet-only local signer (scripts, development)
lib/messages.ts      MsgOpenEVMWindow / MsgCloseEVMWindow via the QoreChain SDK
packages/connect/    @fenestella/connect: spec checks, postMessage protocol, requestWindow()
contracts/           Foundry: QorePQC, FenestellaReceipts, Bills, tests
scripts/             spike-window.ts, attack.ts
tests/               vitest
```

Fenestella never holds a key. With QoreX, the page sends messages and the wallet builds, shows, hybrid-signs and broadcasts the transaction. The local signer keeps a testnet phrase in the tab's memory only and refuses mainnet.

## Status

Checked on 14 November 2026, on `qorechain-diana`.

Works, and verified:

- Reading any account on testnet and mainnet, and the exposure answer (43 unit tests).
- The window lifecycle with the local signer (`npm run spike`): ML-DSA-87 registration with proof of possession, a window scoped to one contract opened, read back and closed.
- The attacker (`npm run attack`): with only the classical key of a protected account, a native transfer, an open-window message and an EVM transfer were all refused by the chain, and the balance did not change.
- The contracts: 20 Foundry tests pass. Both are deployed (see [deployments.testnet.json](deployments.testnet.json)):
  - `FenestellaReceipts`: `0xc520f7084758a3faafd2d8ffb7432c87787a1acc`
  - `Bills`: `0xa8006f2378e8307ffdb0d46fc89668bc69d00eb0`
- The live `pqcKeyStatus` precompile answers in the shape `QorePQC.sol` expects (2,752 bytes for a registered account, 160 for an unregistered one).

Testnet accounts this project uses:

- Deployer and development account: `qor18ydtk2rx0wma4csyl9353kj0z29w645daa47z9`
- Q-Day Drill account: `qor1mzv9k3qwhye6cmyqcwnj5alua529zcgfm3klug`

Not verified yet:

- **Signing through QoreX.** QoreX accepts dApp messages it can display and refuses the rest; its docs do not say whether a dApp may send `MsgOpenEVMWindow`. This is the next thing to test with a real wallet.
- **The popup flow of `requestWindow()`** in a real browser.
- **`pqcVerify` on chain.** `FenestellaReceipts.attest` is tested against a mock; no receipt has been written on testnet yet.

Not built yet: the linked-key (spending rule) editor, the bill-payer agent, the sealed and anchored mandate.

## Kits and credits

- [`@qorechain/sdk`](https://www.npmjs.com/package/@qorechain/sdk) and [`@qorechain/evm`](https://www.npmjs.com/package/@qorechain/evm): network presets, address encodings, window messages, hybrid signing for the local signer.
- [`@qorechain/qorex-types`](https://www.npmjs.com/package/@qorechain/qorex-types): QoreX detection and `signAndBroadcast`.
- [`@qorechain/qoreseal`](https://www.npmjs.com/package/@qorechain/qoreseal), [`@qorechain/qoresign`](https://www.npmjs.com/package/@qorechain/qoresign), [`@qorechain/pqc`](https://www.npmjs.com/package/@qorechain/pqc), [`@qorechain/qorex-wallet-mock`](https://www.npmjs.com/package/@qorechain/qorex-wallet-mock): installed for the mandate and end-to-end test work that follows; not used by shipped code yet.
- Next.js, React, viem, vitest, Foundry.

How AI was used in building this is logged in [AI_USAGE.md](AI_USAGE.md).

## Licence

[MIT](LICENSE).
