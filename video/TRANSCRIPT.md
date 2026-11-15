# Fenestella demo video: transcript

Voice: Microsoft neural voice "Andrew" (edge-tts). Length: about 2 minutes 50 seconds.

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

For the agents track, meet the bill payer. It gets its own key, linked with one permission and a spending rule: only Bills dot pay, at most one QOR a payment, and three a day. A vendor posts a bill. You write the mandate. It is sealed to the agent with ML-KEM-1024, and you sign its fingerprint on chain with your post-quantum key. The agent proves the mandate is yours, opens it, checks the bill, and pays, with no window open on your account.

## 06. Now try to break it

Now steal the agent's key, and try to drain the account. No mandate, no checks. The chain refuses it: per-transaction limit exceeded.

## 07. For builders

Builders get one call: request window. Your app asks for exactly what it needs. The user sees your real address and the limits in plain words, and approves in their own wallet.

## 08. Docs, FAQ, security

The docs, the FAQ and a plain security page explain how it works, and what a window cannot stop.

## Outro

Every result you saw is a real testnet transaction, recorded in the repository. Fenestella. See how far your key reaches, and keep it small.
