# Fenestella demo video: transcript

Voice: Microsoft neural voice "Andrew" (edge-tts). Length: 2 minutes 55 seconds.

## Intro

Fenestella. On QoreChain, a stolen classical key can only reach as far as the window your post-quantum key leaves open. Fenestella shows you that window, shrinks it, and lets agents work safely inside it.

## 01. The console

Start on the console. Paste any address, on testnet or mainnet. Every account is in one of four states: sealed, scoped, wide open, or the dangerous one. No post-quantum key yet, so anyone holding the classical key can register theirs first, and take the account.

## 02. See the truth

This is a fresh testnet account. In one sentence, Fenestella answers the question that matters: if this key leaked right now, what could an attacker do? Here, nothing. Below are the facts it read from the chain: the ML-DSA-87 key and its proof of possession, the key type, the window, and the balance.

## 03. Every wallet, honestly

Connect wallet finds every wallet in the browser, and says which ones can sign. Here we use the QoreChain Dashboard wallet. Its phrase stays in this tab, and Fenestella checks it against the chain before it signs anything.

## 04. Open a fenestella

Now open a fenestella. Pick a preset, name the one contract you need, and set the count, the cap and the time. The wallet signs with both keys, and the chain enforces every bound. The answer changes: a leaked key could now call only that contract, briefly. One click closes it again.

## 05. The bill-paying agent

For the agents track, meet the bill payer. It gets its own key, linked with one permission and a spending rule the chain enforces: only Bills dot pay, at most one QOR a payment, and three a day. A vendor posts a bill.

## 06. The agent's AI

The agent has an AI brain. Paste the invoice you got. This one is phishing: a new wallet, five QOR, pay within the hour. The AI checks the chain with its own tools, finds no bill to match, and refuses, saying why. The genuine invoice matches the bill and the payee, so it drafts the mandate.

## 07. A sealed, signed mandate

The mandate is sealed to the agent with ML-KEM-1024, and you sign its fingerprint on chain with your post-quantum key. The agent proves it is yours, checks the bill, asks its AI for a second opinion, and pays, with no window open on your account.

## 08. Now try to break it

Now steal the agent's key, and try to drain the account. No mandate, no checks. The chain refuses it: per-transaction limit exceeded. The AI can be fooled. The leash cannot.

## 09. For builders

Builders get one call: request window. Your app asks for exactly what it needs, the user sees your real address and the limits in plain words, and approves in their own wallet. The chain grants exactly that, nothing wider.

## Outro

Every result you saw is a real testnet transaction, linked in the repository, with a threat model and a public audit. Fenestella. See how far your key reaches, and keep it small.
