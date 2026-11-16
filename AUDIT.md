# QCAI audits and our responses

On 16 November 2026 we ran all three contracts (`QorePQC.sol`, `FenestellaReceipts.sol`, `Bills.sol`, flattened into one file) through the **QoreChain AI Smart Contract Auditor** on the QoreChain Dashboard (paid audit, 150 QOR).

**Result: security score 85, risk level medium, 4 findings.**

| ![Score](docs/screens/10-qcai-audit-score.jpg) | ![Findings](docs/screens/11-qcai-audit-findings.jpg) |
| --- | --- |

The auditor's summary: *"While the core cryptographic functions appear secure, the lack of proper access controls and potential DoS vectors require attention."* We took each finding seriously, checked it against the code, and did something about every one that held.

## Findings

### 1. HIGH: missing access control on `createBill`

> Any user can create bills for any payer, potentially leading to unauthorized bill creation.

**Assessment: true as stated; by design for the contract, and it exposed a real weakness in our server.**

A bill is a *request*, not a debt. Like an invoice, anyone may send one. What matters is who can pay it, and that is locked down:

- only the named payer can pay (`NotThePayer`), only the exact amount (`WrongAmount`), only once (`AlreadyPaid`);
- the payer's agent pays only a bill named in a mandate the owner sealed and anchored with their ML-DSA-87 key, after the agent's AI approves it, within the chain-enforced spending rule;
- the agent's AI flags a payee the owner has never paid (`new_payee`).

Restricting `createBill` to an allowlist would need an owner or a registry, and the contract deliberately has neither.

**But the finding was right about one thing.** Our server listed an owner's bills by reading the **newest 30 bills** of the contract. Someone posting a flood of bills to other people could push the owner's real bill out of that window, so the agent and its AI would no longer see it. That is a denial of service against our product, not against the contract.

**Fixed:**
- [`lib/agent/server.ts`](lib/agent/server.ts) `billsFor()` now finds every bill through the `BillCreated` event filtered by the **indexed `payer`** topic, scanning from the deployment block in 10,000-block chunks (the testnet RPC's limit) with a per-owner cache. Bills addressed to other people never enter the scan, however many there are. Checked on testnet against a full read of the contract: every payer's bills match.
- New Foundry test `test_unsolicited_bill_moves_nothing`: a spammer posts 50 bills of 100 QOR to the payer. No balance moves, the contract holds nothing, the spammer cannot pay on the payer's behalf, and the real bill stays intact and payable.

### 2. MEDIUM: potential overflow in nonce management

> `nonces` uses uint256 which could theoretically overflow after 2^256 − 1 transactions per account, though practically unlikely.

**Assessment: not exploitable.** The contracts compile with Solidity `^0.8.24`, where `nonces[account]++` is checked arithmetic and reverts on overflow instead of wrapping. Reaching 2^256 receipts for one account is not physically possible. No change.

### 3. LOW: unbounded storage growth in `_bills`

> The `_bills` array grows unbounded with each bill created, potentially leading to gas limit issues or denial-of-service when querying large arrays.

**Assessment: no on-chain risk; the off-chain part was real and is fixed with finding 1.** The contract never iterates over `_bills`: `pay` and `billOf` read one element by index (constant gas), and `count` returns the length. Growth costs only the poster's gas. The query-side concern applied to our server's listing, which no longer depends on the array's size.

### 4. INFO: no ERC compliance required

Correct; these are application contracts. No change.

## Not scored: "Quantum safe"

The auditor marked the quantum-safety score "Not scored" for the EVM/Solidity target. The contracts' post-quantum properties are covered by our own tests instead: `FenestellaReceipts` accepts a record only with an ML-DSA-87 signature verified by the chain's `pqcVerify` precompile and never trusts `msg.sender`; `QorePQC` fails closed when a precompile is inactive. See the 11 receipt tests in [`contracts/test/Fenestella.t.sol`](contracts/test/Fenestella.t.sol), the [real receipt on testnet](https://fenestella.vercel.app/tx/0xfa030023c46c526dd07eab33be5cda41c3de3e9a5aaced2498dfe084cbd7541f), and [THREAT_MODEL.md](THREAT_MODEL.md).

## Why the deployed contracts were not redeployed

None of the findings needed a contract change, and the deployed addresses are registered for the Q-Day Drill. The exact source audited is the source in [`contracts/src`](contracts/src).


---

# Second audit: AgentVault

On 17 November 2026 we ran `AgentVault.sol` (with `QorePQC.sol`, flattened) through the same **QoreChain AI Smart Contract Auditor** (paid audit, 150 QOR). AgentVault is the contract that holds the agent's budget; we built it after the first audit to close the last gap in our threat model.

**Result: security score 85, risk level medium, 4 findings. One held, and it is fixed.**

| ![Score](docs/screens/13-qcai-vault-score.jpg) | ![Findings](docs/screens/14-qcai-vault-findings.jpg) |
| --- | --- |

### 1. HIGH: "potential privilege escalation via signature replay"

> The nonce mechanism for post-quantum signatures is susceptible to replay attacks if not properly enforced.

**Assessment: not exploitable; it is enforced.** Every signed admin message is `abi.encodePacked(DOMAIN, block.chainid, address(this), owner, nonces[owner], action, keccak256(params))`, and `_authorize` increments the owner's nonce after every accepted signature. A signature therefore works once, on one chain, on one contract, for one owner, for one action with its exact parameters. Foundry tests pin each case: `test_a_signature_cannot_be_replayed`, `test_a_signature_for_one_payee_cannot_approve_another`, `test_a_payee_signature_cannot_be_used_as_a_withdrawal`, plus forged-key and inactive-precompile cases. On testnet, the same signature format was accepted once per action and the nonce moved each time. No change.

### 2. MEDIUM: "front-running vulnerability in bill creation"

> Anyone can create bills for an owner, which could lead to front-running attacks.

**Assessment: by design, and harmless.** A bill is a request; nothing is paid unless the payee was approved by the owner's post-quantum signature, within the owner's limits. A bill posted ahead of a real one changes nothing about the real one. This is exactly attack 3 of our live drill: a thief's bill was refused by the vault with `PayeeNotApproved` ([receipt](https://fenestella.vercel.app/tx/2215D12E61B14CFD36CCB661183473D95EF75139A5FC1106D5E9AEF002D24175)). Our server already lists an owner's bills by the indexed `owner` topic, so a flood of bills cannot hide real ones (the fix from the first audit). No change.

### 3. LOW: "unbounded array growth in bills"

**Assessment: no on-chain risk.** `billOf` and `billCount` are constant-gas reads; nothing iterates over `_bills`. No change.

### 4. INFO: "missing ERC-20 standard compliance check"

> It does not fully comply with all ERC-20 standards, particularly around return value handling.

**Assessment: true in a sharper way than stated, and fixed.** We had flagged the same area ourselves before running the audit: a call to an address with **no code** "succeeds" with empty return data, so `depositToken` could credit a balance in a "token" that does not exist, and a token that takes a fee on transfer would be credited more than arrived. Neither could touch another owner's funds (balances are per owner and per token), but both are wrong.

**Fixed in AgentVault v2:**
- every token call refuses an address with no code (`NotAToken`);
- a return value must be empty or exactly one `true`;
- `depositToken` credits the **measured** amount received (balance before and after), so a fee-on-transfer token can never leave the vault owing more than it holds.

New Foundry tests: `test_a_token_address_with_no_code_is_refused`, `test_a_bill_in_a_token_with_no_code_cannot_be_paid`, `test_a_fee_on_transfer_token_credits_only_what_arrived`. 45 contract tests in all.

v2 is deployed at `0x51fb13cc0513f02cd16e98f9b4a9f233027c2551`. The first vault (`0xe25290a9…3d08`) is kept in `deployments.testnet.json`; the test owner's 1.1 QOR left it through an **ML-DSA-87-signed withdrawal** relayed by a third party, paid only to the owner ([receipt](https://fenestella.vercel.app/tx/0x64908a62c468b153f4676a261576080d36890ba6042d1ae1858675a8064f0cdb)), which is also our live proof that withdrawal works.
