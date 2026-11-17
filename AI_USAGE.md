# AI usage

Fenestella was built by its author working with an AI coding assistant: Claude Code, by Anthropic, running in the Claude desktop app with access to a terminal and to the author's own Chrome. This file records who decided what, what the assistant produced, how every output was checked, and what went wrong.

The product also uses AI at run time: the bill-paying agent reads invoices with a language model (OpenAI's gpt-5-mini in production, Anthropic's Claude supported). That part is described in the README under "The agent's AI". This file is about how the project was built.

## How we worked

1. The author set the goal, chose the category and made every product decision.
2. The assistant researched the chain's docs, the live endpoints and the other projects, proposed a plan, and waited for approval before building.
3. The assistant wrote the code and the tests, ran them against the live testnet, and reported what passed, what failed and what it could not check. Nothing was reported as done without a receipt from the chain or a passing test.
4. The author tested in their own browser with their own wallets, signed every step that needed their keys, and decided what shipped and what was posted.
5. Work was checkpointed after every stage, so a long build could be picked up exactly where it stopped.

## Decided by the author

- The product: an account console, scoped windows and a request API, then an AI agent that pays bills and cannot rob you. Not another vault, scanner or swap.
- To answer rival projects with things no one else had: a public attack lab, a chain-wide Q-Day radar, signed and sealed agent reports, rules in plain English, and an MCP server so any AI app can run the agent.
- The name, the brand, the design references, the mobile menu and the moving landing page.
- The category: Post-Quantum AI Agents.
- Bringing in an outside review of the plan and adopting its corrections: a wallet user's attestation is the hybrid-signed transaction, not a `pqcVerify` call; no window for the agent unless the chain requires one; the drill proof is a native transaction with the window shut.
- The plain, human tone of every public text. The assistant drafts; the author's voice decides.
- Every on-chain action on the author's own accounts, approved in their wallet, and every npm publish, made by the author with their own two-factor code.

## Produced by the assistant

- **Research:** fest rules, prizes and voting; QoreChain docs for windows, key registration, abstract accounts, precompiles, QoreX and QoreSeal; a read of every project in the category.
- **Code:** the Next.js console and its pages; the chain reader and exposure logic; signers and wallet detection; `@fenestella/connect` and `@fenestella/mcp` (both on npm); the agent service with its AI, guard, mandates, autopay, reports and relay; the attack lab and its public attempt log; the radar scanner; the Solidity contracts (`AgentVault`, `AgentReports`, `FenestellaReceipts`, `Bills`, `QorePQC`).
- **Tests:** unit tests, contract tests including fuzz tests and an invariant suite, and browser tests that run at phone size. The current counts are generated from the real runs in [`lib/generated/stats.json`](lib/generated/stats.json).
- **Automation:** the GitHub Actions jobs for the radar scan, the autopay rounds and the check that published numbers are current.
- **Writing:** the README, the threat model, the audit answers, the fest page texts, the X posts and this file, all reviewed and edited by the author.
- **Video pipeline:** script, neural voiceover, screen recorder, motion cards and editor.

## How the output was checked

- **Types and tests on every change:** `tsc`, the unit tests, `forge test` and the browser tests. As of 17 November 2026: 91 unit tests, 54 contract tests (6 of them fuzz tests, plus an invariant suite that checks 6 rules after thousands of random moves by an owner, a vendor and a thief), and 16 browser tests.
- **Live on testnet:** every claim in the README links to a receipt read from the chain. The attack lab's 13 attacks were run live and every one was refused; the page now publishes every attempt anyone makes.
- **Numbers that cannot drift:** the counts on the site come from one generated file; a unit test fails if the README disagrees, and a GitHub check fails if the file is stale. This was added after the author caught the home page still showing week-one numbers.
- **Two QoreChain AI audits** of the contracts; every finding is answered in [AUDIT.md](AUDIT.md). The findings that held up were fixed, and the vault was redeployed after the second.
- **The author's own runs:** the window, request, agent, vault and autopay flows in their Chrome with their own wallets, and the site on their phone.

## What went wrong along the way, and how it was caught

- The first agent link was refused because one agent key was already bound to another account. The design changed to one key per owner.
- The live AI once flagged a prompt injection and still said "pay". A guard written in code now has the last word and can only make the AI stricter.
- An audit found that the vault would credit a "token" address with no code behind it. Fixed, tested and redeployed; the old vault was emptied with a post-quantum-signed withdrawal.
- A rule check accepted a known payee's name with a different address, the classic invoice scam. Caught in review, fixed, and covered by a test.
- The radar's first scan was throttled by the API and read many accounts as "unknown"; the scanner learned to cache and retry, and the scan moved to GitHub Actions.
- Copying files through Windows PowerShell corrupted characters in the README once; repaired, and that route is no longer used.
- The relayer that pays fees for the lab and the agent ran low on test QOR; caught in a full re-test before judging and refilled.
- The home page kept stale test counts and the security page wrongly said the contracts hold no funds. The author caught the first; the sweep that followed caught the second. Both are now generated or corrected, and checked automatically.
- On phones, the menu was missing and long addresses overflowed. The author caught it on their own phone; the fix came with browser tests that fail if any page is wider than the screen.
