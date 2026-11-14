# AI usage

This project is built with an AI coding assistant (Claude Code, Anthropic) working alongside the author. This file records what the assistant produced, what the author decided, and how the output was checked. It is updated as the project moves.

## Workflow

1. The author sets the goal and makes the product decisions.
2. The assistant researches the chain's documentation and live endpoints, proposes a plan, and waits for approval.
3. The assistant writes code and tests, runs them, and reports what passed, what failed and what was not checked.
4. The author reviews, tests with a real wallet, and decides what ships.

## Decisions made by the author

- The product: an account console and a request API for EVM windows, instead of another agent, vault, scanner or swap.
- The name, Fenestella.
- The category, Post-Quantum AI Agents.
- A new repository with a clean history, separate from earlier work.
- Bringing in an outside review of the plan. Its corrections were adopted: a QoreX user's attestation is the hybrid transaction, not a `pqcVerify` call; no window for the agent unless the chain requires one; the drill proof is a native transaction with the window shut.

## Work produced by the assistant

14 November 2026:

- Research: the fest rules and categories, the QoreChain docs for windows, key registration, abstract accounts and precompiles, the QoreX integration docs, and the other projects in the feed. Claims were checked against the live testnet where possible (module config, protocol features, active precompiles, a real account's state).
- The build plan the author approved.
- All code in the first commit: the Next.js console, the chain reader, the exposure logic, the signers, `@fenestella/connect`, the Solidity contracts and their Foundry tests, the testnet scripts, and the unit tests.
- The README and this file.

## How the output was checked

- Type-checked with `tsc` and unit-tested with vitest (43 tests).
- The console was run locally and read against live testnet and mainnet accounts.
- The contracts were compiled with solc 0.8.24. The compile step caught two address-checksum errors, which were fixed.
- The live `pqcKeyStatus` precompile was called on testnet to confirm the return shape the contract code assumes.

## What the assistant got wrong or could not check

- One unit test had a wrong expected string; the code was right and the test was corrected.
- The Foundry tests have not been run (Foundry was not installed on the build machine at the time).
- Signing through QoreX, the popup request flow, and the local signer on testnet are unverified. The README's Status section tracks these.
