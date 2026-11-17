import Link from "next/link";

export const metadata = { title: "Docs · Fenestella" };

const REQUEST = `import { requestWindow, FenestellaError } from "@fenestella/connect";

try {
  const granted = await requestWindow({
    reason: "Pay this month's invoices from the Bills contract.",
    allowedTargets: ["0xa8006f2378e8307ffdb0d46fc89668bc69d00eb0"],
    maxTxs: 10,
    maxValueUqor: "2000000", // 2 QOR: value plus the maximum fee of each transaction
    blocks: 1200,
    network: "testnet",
  });
  // granted.txHash, granted.account, granted.evmAddress
  // granted.window: what the chain now stores for the account
} catch (err) {
  if (err instanceof FenestellaError) {
    // err.code: "rejected" | "invalid" | "failed" | "blocked" | "closed" | "timeout"
  }
}`;

const MCP = `npx @fenestella/mcp keygen      # prints a new agent key

// claude_desktop_config.json or .mcp.json
{
  "mcpServers": {
    "fenestella": {
      "command": "npx",
      "args": ["-y", "@fenestella/mcp"],
      "env": { "FENESTELLA_AGENT_KEY": "0x…" }
    }
  }
}`;

const COVERS = `import { windowCovers } from "@fenestella/connect";

const res = await fetch(
  "https://fenestella.vercel.app/api/account?network=testnet&address=" + account,
);
const { truth } = await res.json();

if (!windowCovers(truth.window, need)) {
  await requestWindow({ ...need, reason: "..." });
}`;

const API = `GET /api/account?network=testnet&address=qor1...   (or 0x...)

{
  "truth": {
    "address": { "cosmos": "qor1...", "evm": "0x..." },
    "keyType": "eth_secp256k1",
    "pqc": { "registered": true, "possessionProven": true },
    "kem": { "found": false },
    "window": { "live": true, "remainingTxs": "2", "remainingValue": "200000",
                "remainingBlocks": "118", "nativeOnly": false,
                "allowedTargets": ["0x..."] },
    "abstractAccount": { "moduleEnabled": true, "account": null,
                         "rules": [], "authenticators": [] },
    "unknown": []
  },
  "exposure": { "level": "scoped", "headline": "...", "can": [], "cannot": [],
                "warnings": [], "advice": [], "linkedKeys": [] }
}`;

export default function DocsPage() {
  return (
    <article className="prose">
      <span className="eyebrow">Docs</span>
      <h1>Build with Fenestella</h1>
      <p className="lede">
        Three things you can use today: the request call, the account API, and the contracts. Everything here runs
        against <code>qorechain-diana</code>.
      </p>

      <h2 id="request">Ask for a window</h2>
      <p>
        <code>@fenestella/connect</code> has no dependencies and is{" "}
        <a href="https://www.npmjs.com/package/@fenestella/connect">on npm</a> (source in{" "}
        <a href="https://github.com/angelraph/fenestella/tree/main/packages/connect">packages/connect</a>):
      </p>
      <pre className="cli">npm install @fenestella/connect</pre>
      <pre className="cli">{REQUEST}</pre>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Meaning</th>
            <th>Chain limit</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>blocks</code></td>
            <td>How long the window stays open</td>
            <td>1 to 17,280</td>
          </tr>
          <tr>
            <td><code>maxTxs</code></td>
            <td>How many EVM transactions it admits</td>
            <td>1 to 1,000</td>
          </tr>
          <tr>
            <td><code>maxValueUqor</code></td>
            <td>Total value plus maximum fees, in uqor (1 QOR = 1,000,000)</td>
            <td>above 0</td>
          </tr>
          <tr>
            <td><code>allowedTargets</code></td>
            <td>The only recipients allowed; contract creation is refused</td>
            <td>at most 16</td>
          </tr>
          <tr>
            <td><code>nativeOnly</code></td>
            <td>Plain QOR transfers only; cannot be combined with targets</td>
            <td></td>
          </tr>
          <tr>
            <td><code>reason</code></td>
            <td>Shown to the user as your words</td>
            <td>280 characters</td>
          </tr>
        </tbody>
      </table>
      <p>What the user sees, and what you cannot change:</p>
      <ul>
        <li>Your origin, as the browser reports it. It is never read from your message.</li>
        <li>The bounds restated in plain words by Fenestella, with warnings where they apply.</li>
        <li>The result is the window as the chain stores it after the transaction, not what you asked for.</li>
      </ul>
      <p>
        Call <code>requestWindow()</code> from a click handler, or the browser blocks the popup.{" "}
        <Link href="/demo">Try the flow</Link>.
      </p>

      <h2 id="covers">Skip the request when a window already fits</h2>
      <pre className="cli">{COVERS}</pre>

      <h2 id="mcp">For AI agents: the MCP server</h2>
      <p>
        <code>@fenestella/mcp</code> gives Claude, Cursor or any MCP client a QoreChain agent on a leash the chain
        enforces. Its key, kept on your machine, may call only <code>AgentVault.payBill</code>; the vault pays only
        payees you approved with your post-quantum key, within your limits. Without a key it reads: what a stolen
        classical key could do to an account, the Q-Day radar, your vault and bills, and the <code>pqcVerify</code> /{" "}
        <code>pqcKeyStatus</code> precompiles.
      </p>
      <pre className="cli">{MCP}</pre>
      <p>
        Tools: <code>check_account</code>, <code>qday_radar</code>, <code>vault_status</code>, <code>list_bills</code>,{" "}
        <code>request_window</code> (a link you approve in your own wallet), <code>verify_pq_signature</code>,{" "}
        <code>link_agent</code> and <code>pay_bill</code>. The relayer forwards only a <code>payBill</code> call to the
        vault and refuses to spend a fee on a bill the vault would refuse.{" "}
        <a href="https://github.com/angelraph/fenestella/tree/main/packages/mcp">Full guide</a>.
      </p>

      <h2 id="api">Account API</h2>
      <p>
        Read-only, no key needed. Each section of the answer is read on its own; one that fails is named in{" "}
        <code>unknown</code> and is never reported as safe.
      </p>
      <pre className="cli">{API}</pre>
      <p>
        Exposure levels: <code>takeover</code>, <code>open</code>, <code>scoped</code>, <code>sealed</code>,{" "}
        <code>unknown</code>.
      </p>

      <h2 id="contracts">Contracts on testnet</h2>
      <table>
        <thead>
          <tr>
            <th>Contract</th>
            <th>Address</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>FenestellaReceipts</td>
            <td><code>0xc520f7084758a3faafd2d8ffb7432c87787a1acc</code></td>
            <td>Records a digest only with an ML-DSA-87 signature by the account&apos;s registered key</td>
          </tr>
          <tr>
            <td>Bills</td>
            <td><code>0xa8006f2378e8307ffdb0d46fc89668bc69d00eb0</code></td>
            <td>Post a bill; paying forwards the exact amount to the payee and holds nothing</td>
          </tr>
        </tbody>
      </table>
      <p>
        <code>QorePQC.sol</code> wraps the chain&apos;s <code>pqcKeyStatus</code> and <code>pqcVerify</code> precompiles
        and reverts when a precompile is inactive, so an empty answer is never read as “verified”. Reuse it in your own
        contracts.
      </p>

      <h2 id="run">Run it yourself</h2>
      <pre className="cli">{`git clone https://github.com/angelraph/fenestella
cd fenestella && npm install
npm run dev      # the console
npm test         # unit tests
npm run spike    # window lifecycle on testnet with a throwaway key
npm run attack   # everything the classical key alone can try`}</pre>
    </article>
  );
}
