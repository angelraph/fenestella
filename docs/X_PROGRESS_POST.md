Quote of: https://x.com/RaphElevator/status/2122256610231763453

---

A few days ago I showed you an AI agent that pays my bills on @QoreChain without being able to rob me.

Then I found the hole in my own story.

If someone stole the agent's key, the chain still let it send small amounts to anyone. 1 QOR a payment, 3 a day. Not a disaster, but not "can't rob me" either. I'd even written it down in my own threat model as a known limit. Two other teams in the fest had solved it. So I couldn't sleep on it.

Here's what I built this week. 🧵

—

1/ The money moved into a vault

The agent's budget now lives in a contract I called AgentVault, not in my account.

The vault pays one thing: a real bill, to a payee I approved, inside limits I set. That's it. No admin, no owner shortcut, no upgrade button.

And here's the part I love. I approve payees and set limits by signing with my post-quantum key (ML-DSA-87). The vault checks every one of those signatures on chain with QoreChain's pqcVerify precompile. A stolen classical key can't do it. A stolen agent key can't do it. Nobody's msg.sender means anything to it.

—

2/ The leash got almost to zero

Before writing a single line of the vault, I tested something on chain.

I set my account's spending rule to 0.000001 QOR. Then I asked: can the agent still call a contract?

Yes. QoreChain measures what actually leaves your account, and when the vault pays, nothing leaves mine. So the agent works fine. But a plain transfer of even 2 uqor got refused instantly.

That one test is the whole design.

—

3/ Then I played the thief again

I took the agent's key and tried three things:

❌ Send my balance to a dead address → refused by the chain
❌ Approve itself as a payee in my vault → refused by the chain, it's only allowed one function
❌ Post a fake bill to me and pay it with that one allowed function → the chain let it through… and the vault said no. "Payee not approved." Nothing moved.

Meanwhile the real bill? The AI read it, gave its second opinion, and the agent paid it from the vault. Every step has a receipt on testnet.

—

4/ I paid for another audit, and it found something

I ran the vault through QoreChain's AI auditor. 85/100, four findings.

Three of them didn't hold up, and I explained why in public. One did: if you passed the vault a "token" address with no code behind it, it would happily credit a balance that didn't exist. Couldn't touch anyone's real money, but it was wrong.

So I fixed it, added tests for it (plus fee-on-transfer tokens while I was there), and redeployed. Then I pulled the test funds out of the old vault with a post-quantum-signed withdrawal, which doubled as the live proof that withdrawing works.

45 contract tests now. Both audits and every answer are in the repo.

—

5/ The small stuff that adds up

→ requestWindow() is on npm now: npm install @fenestella/connect. I tested it live with a real wallet: a demo app asked for 3 transactions, 0.5 QOR, one contract, and the chain granted exactly that.
→ The AI catches phishing and prompt injection, and when it gets it wrong, my own rules overrule it.
→ You can watch it work without a wallet.
→ All four Ship Weeks badges, 7 features verified on chain.

—

The honest part

The AI can still be fooled. A payee I approved can still bill me for real things. I wrote both down, because a security tool that oversells is worse than none.

But a stolen agent key now can't take a single coin. That was the promise in the video, and now it's actually true.

Try it (no wallet needed): https://fenestella.vercel.app/agent
Code and every receipt: https://github.com/angelraph/fenestella
Project: https://build.qorechain.io/p/fenestella

#BuildBeforeQDay #QoreChain #PostQuantum #AIAgents
