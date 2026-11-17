# @fenestella/mcp

Give your AI assistant (Claude, Cursor, any MCP client) a QoreChain agent that can pay your bills and can't rob you.

The model can be talked into anything. A phishing invoice, a prompt injection, a bad day. So this server doesn't trust it. Its key is linked to your account on a leash that **the chain** enforces:

- it can call one function, `AgentVault.payBill`, and nothing else
- it can move at most 0.000001 QOR of your own balance
- the vault pays only payees you approved, within your limits, and only your post-quantum (ML-DSA-87) signature can change those

The key stays on your machine. Fenestella's relayer only forwards the signed call and pays the fee, and it refuses to spend a fee on a bill the vault would turn down anyway.

It also reads, for anyone, on mainnet and testnet: what a stolen classical key could do to an account, how much of QoreChain is ready for Q-Day, and the chain's own post-quantum precompiles.

## Set it up

```bash
npx @fenestella/mcp keygen
```

That prints a new agent key. Add the server to your MCP client with that key. For Claude Desktop or Claude Code (`claude_desktop_config.json` / `.mcp.json`):

```json
{
  "mcpServers": {
    "fenestella": {
      "command": "npx",
      "args": ["-y", "@fenestella/mcp"],
      "env": { "FENESTELLA_AGENT_KEY": "0x…the key from keygen…" }
    }
  }
}
```

Leave `FENESTELLA_AGENT_KEY` out and it runs read-only.

Then ask your assistant to link the agent to your testnet account. It gives you a link; you open it, connect your wallet and press **Link this agent**. Approve the payees and set your limits on the same page. From then on you can say "pay my Northwind bill" and watch the vault decide.

## Tools

| Tool | What it does | Needs the key |
| --- | --- | --- |
| `check_account` | What someone holding only an account's classical key could do right now, its linked keys and rules, and what contracts see through `pqcKeyStatus` | no |
| `qday_radar` | How much of mainnet or testnet could be taken over today (totals only) | no |
| `vault_status` | Your vault's balance, limits, what was spent today, whether a payee is approved | no |
| `list_bills` | Bills posted to you, and whether the vault would pay each one, or why not | no |
| `request_window` | A link that asks you for a scoped EVM window (targets, count, cap, time); you approve it in your own wallet | no |
| `verify_pq_signature` | Asks the `pqcVerify` precompile whether an ML-DSA-87 signature is valid for an account's registered key | no |
| `link_agent` | This agent's key for your account, and the link to put it on the leash | yes |
| `pay_bill` | Signs `payBill(id)` and hands it to the relayer; returns the receipt | yes |

One master key gives a different agent key for every account it works for, so revoking it on one account never touches another.

## What it's been through

Run live on testnet on 17 November 2026: the agent paid a 0.15 QOR bill from the vault ([receipt](https://fenestella.vercel.app/tx/1A285C635AB301D9CEF0270A44E42ABD3880018FF10696895B8CCAFD23F6D4B1)), and a bill from a payee the owner never approved was refused before a fee was spent. The script is [`scripts/spike-mcp.ts`](https://github.com/angelraph/fenestella/blob/main/scripts/spike-mcp.ts).

`FENESTELLA_URL` points it at another Fenestella deployment (default `https://fenestella.vercel.app`). Testnet only for anything that moves money.

MIT. Part of [Fenestella](https://github.com/angelraph/fenestella).
