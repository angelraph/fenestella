# AI usage

Fenestella was built by its author working with an AI coding assistant (Claude Code, by Anthropic). This file records who decided what, what the assistant produced, and how the output was checked.

## How we worked

1. The author set the goal and made the product decisions.
2. The assistant researched the chain's docs and live endpoints, proposed a plan, and waited for approval.
3. The assistant wrote code and tests, ran them against the live testnet, and reported what passed, what failed and what it could not check.
4. The author tested with real wallets in their own browser, signed every step that needed their keys, and decided what shipped.

## Decided by the author

- The product: an account console, scoped windows and a request API, plus an agent kept on a leash. Not another vault, scanner or swap.
- The name, the brand and logo, and the design references (Rabby, 1Password, Safe).
- The category: Post-Quantum AI Agents.
- Bringing in an outside review of the plan and adopting its corrections: a wallet user's attestation is the hybrid-signed transaction, not a `pqcVerify` call; no window for the agent unless the chain requires one; the drill proof is a native transaction with the window shut.
- Adding the QoreChain Dashboard wallet to the wallet picker, and the plain, human tone of the submission.
- Every on-chain action on the author's own account, approved in their wallet.

## Produced by the assistant

- Research: fest rules and categories; QoreChain docs for windows, key registration, abstract accounts, precompiles and QoreX; the other projects in the feed.
- All code: the Next.js console, chain reader, exposure logic, signers, wallet detection, `@fenestella/connect`, the agent service, mandates, the rule editor, the receipt page, the Solidity contracts and their tests, the testnet scripts and the unit tests.
- The demo video pipeline: script, neural voiceover, recorder, motion cards and editor.
- The README, the fest texts and this file.

## How the output was checked

- `tsc` type checks and 43 vitest unit tests; 20 Foundry tests for the contracts.
- Every claim in the README was run on `qorechain-diana`, and each links to a receipt read from the chain.
- The author ran the window and agent flows in their own Chrome with their own wallet.

## What went wrong along the way, and was fixed

- A unit test expected the wrong duration string; the code was right.
- Two Solidity address literals failed the checksum rule; fixed at compile time.
- The first agent link was refused by the chain because one agent key had already been bound to another account. That showed that a shared agent needs one key per owner, and the design changed to derive one per owner.
- The QoreX browser extension turned out to be mainnet only; Fenestella now says so plainly and offers the Dashboard wallet for testnet.
- Explorer links opened on mainnet and showed "not found"; Fenestella got its own receipt page that reads testnet directly.
