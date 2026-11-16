If someone stole your wallet key tonight, what could they actually take?

Most people can't answer that. I couldn't either. So I built the thing that answers it, then I went a step further and built an AI agent that can spend from my account without ever being able to rob it.

Meet Fenestella. 🪟

A fenestella is the small window cut through a thick castle wall. Big enough to pass one thing through. Never big enough to walk an army through.

That's exactly how @QoreChain works, and almost nobody knows it.

—

The problem

QoreChain was built for the day quantum computers can crack the keys every wallet uses today. Every account has two keys: your normal one (ECDSA, the same kind MetaMask uses) and a post-quantum one (ML-DSA-87).

On the native side, the chain wants both signatures on everything. A stolen normal key alone moves nothing.

On the EVM side, your normal key still signs. But the chain only lets it act through a "window" that your post-quantum key opened: so many blocks, so many transactions, a cap on value, and optionally only certain contracts.

That's a brilliant design. And until now it was almost invisible:

→ No screen told you what your own exposure was right now
→ No warning that an account with no post-quantum key yet can be taken over completely, because the very first key registration is the one thing a classical key is allowed to do alone
→ The wallet can't narrow a window to one contract. That needed the command line
→ dApps had no way to ask for a window, so they told users to run CLI commands
→ Every AI agent project was hand-building its own cage out of scripts and .env files

So I built the layer that was missing.

—

What Fenestella does

1/ See the truth
Paste any address, testnet or mainnet. Fenestella reads the chain and answers in one sentence: if this key leaked right now, what could an attacker do?

Every account lands in one of four states:
🟢 Sealed: nothing, the classical key alone is useless
🟡 Scoped: only the one contract you named, a little, for a while
🟠 Wide open: any contract, until the window runs out
🔴 Can be taken over: no post-quantum key yet

If it can't read something, it says so. It never guesses that you're safe.

2/ Open a fenestella
Pick a preset, name the one contract you need, set a count, a cap and a time. Your wallet signs it with both keys and the chain enforces every bound. The answer updates instantly: "Call only one named contract, in 20 transactions, spending up to 5 QOR, for about 2 hours." One click closes it.

It also tells you the stuff people miss: the cap doesn't count tokens, and a token approval made through a window outlives it.

3/ Put an AI agent on a leash
This is the part I'm proudest of.

The bill-paying agent gets its own key, linked to your account with one permission and a spending rule the chain enforces: it may only call Bills.pay. At most 1 QOR a payment. At most 3 QOR a day.

You never give it your keys. You never open a window for it.

Instead you give it a mandate:
• You write it in your browser: "pay bill #3, up to 0.4 QOR, within 24 hours"
• It's sealed to the agent with ML-KEM-1024 post-quantum encryption, with the bill's details locked into the seal. Change the amount and it won't even decrypt
• You sign its fingerprint on chain with your post-quantum key

The agent checks the signature is really yours, opens the mandate, checks the bill on chain, and pays.

Then I played the villain. I took the agent's key and told it to send 147 QOR to a dead address. No mandate. No checks. Just a stolen key and bad intentions.

The chain said no: "per-tx limit exceeded."

Not my code. Not a prompt telling the AI to behave. The chain.

That's the future I want for AI agents with money: not "trust the model", but "the model physically can't."

4/ Let apps ask
For builders there's one call, requestWindow(). Your app asks for exactly what it needs, the user sees your real site address and the limits in plain words, and approves in their own wallet. No CLI, no blank cheque.

—

Built honestly

Everything in the demo is a real testnet transaction, and every result in the README links to a receipt read straight from the chain:
✅ the agent paying a bill from a sealed, signed mandate
✅ the chain refusing the stolen agent key
✅ the chain refusing an off-list contract call
✅ a tampered mandate that won't decrypt
✅ windows opened and closed from the live site with a real wallet
✅ a classical key alone refused on transfer, window and EVM send

20 contract tests and 43 unit tests pass. It finds every wallet in your browser (QoreX, Keplr, MetaMask, OKX, plus the QoreChain Dashboard wallet) and tells you which ones can actually sign. It holds no keys.

I also wrote down what it can't stop, because a security tool that oversells is worse than none.

—

The vision

Post-quantum security shouldn't feel like a research paper. It should feel like a dashboard with one honest sentence on it.

Quantum day isn't a single moment. It's a slow leak. Keys get exposed one by one, and the accounts that survive are the ones whose doors were already small.

Fenestella makes those doors visible and small, for people, for dApps, and for the AI agents that are about to handle real money for all of us.

Next: a native QoreX screen for scoped windows, more agent jobs beyond bills (DCA, payroll, subscriptions) on the same leash, and requestWindow() as a drop-in for every dApp on the chain.

—

🎥 2:39 demo: https://youtu.be/4Lzn0d_LcqY
🌐 Try it (judges: 3 minutes, no wallet needed to start): https://fenestella.vercel.app
💻 Code, MIT: https://github.com/angelraph/fenestella
🏁 Project: https://build.qorechain.io/p/fenestella

Built for Build Before Q-Day, the QoreChain Developer Fest, in the Post-Quantum AI Agents track.

How far does your key reach right now?

#BuildBeforeQDay #QoreChain #PostQuantum #AIAgents #Web3
