# @fenestella/connect

Ask a QoreChain user for **exactly** the EVM window your dApp or agent needs. No keys, no CLI, no blank cheque.

On QoreChain a classical (ECDSA) key can act on the EVM only through an *authorisation window* that the account's post-quantum ML-DSA-87 key opened: a number of blocks, a number of transactions, a value cap, and optionally a list of allowed contracts. Until now a dApp had to tell its users to open one by hand with `qorechaind`, and wallets could only open unscoped ones.

With this package your app makes one call. The user sees your site's origin (as the browser reports it), your reason and the bounds restated in plain words, and approves in their own wallet. You get back the window **as the chain stored it**.

```bash
npm install @fenestella/connect
```

```ts
import { requestWindow, windowCovers, FenestellaError } from "@fenestella/connect";

button.onclick = async () => {
  try {
    const granted = await requestWindow({
      reason: "Pay this month's invoices from the Bills contract.",
      allowedTargets: ["0xYourContract"],
      maxTxs: 10,
      maxValueUqor: "2000000", // 2 QOR, value plus fees
      blocks: 1200,            // about an hour
      network: "testnet",
    });
    console.log(granted.txHash, granted.window);
    // Now send your EVM transactions; the chain refuses anything outside the window.
  } catch (err) {
    if (err instanceof FenestellaError && err.code === "rejected") {
      // The user said no.
    }
  }
};
```

- Call `requestWindow()` from a click handler, or the browser blocks the popup.
- `windowCovers(state, need)` tells you whether a window that is already open covers what you need, so you can skip the request.
- `validateWindowSpec(spec)` returns every way a spec breaks the chain's bounds (17,280 blocks, 1,000 transactions, 16 targets; `nativeOnly` cannot be combined with targets).
- `windowCliCommand(spec)` gives the equivalent `qorechaind` command, for users who prefer the CLI.
- Errors carry a `code`: `rejected`, `invalid`, `failed`, `blocked` (popup blocked), `closed` (popup closed), `timeout`.

Zero dependencies. Browser only. The approval page is the public Fenestella console (`https://fenestella.vercel.app/request`); pass `fenestellaUrl` to use your own deployment.

Proven on testnet: a dApp asked for 3 transactions, 0.5 QOR, ~10 minutes, one contract; the chain granted exactly that ([receipt](https://fenestella.vercel.app/tx/BED3BCC1C24AE90E92B81C287CB8C721345CC38D6B94CFFD77247721084E0D8C)). Try it at [fenestella.vercel.app/demo](https://fenestella.vercel.app/demo).

MIT · part of [Fenestella](https://github.com/angelraph/fenestella)
