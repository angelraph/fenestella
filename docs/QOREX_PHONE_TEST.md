# QoreX phone test

A real-user check of the agent flow in the QoreX phone app on testnet. About 10 minutes. Write down what QoreX shows at each step, and take a screenshot whenever it refuses something: a refusal is a result too, and it goes in the README exactly as it happened.

## Before you start

1. Install the QoreX app on your phone and open **Settings**, then turn on **Use testnet (developers)**.
2. Use an account that holds about **3 test QOR** and has its post-quantum key registered (sending any amount once registers it). If it is a new account, send it 3 QOR from your QoreChain Dashboard testnet wallet.
3. Write down its `qor1…` address.

## The test

| # | Do this | What should happen | What happened |
| --- | --- | --- | --- |
| 1 | In QoreX's own browser, open `fenestella.vercel.app` | The page loads; the ☰ menu is at the top right | |
| 2 | Open ☰, press **Connect wallet**, choose **QoreX** | QoreX asks to connect; the menu then shows your address | |
| 3 | Open ☰ → **Console**, paste your address, **Read account** | "Sealed" if no window is open | |
| 4 | On your account page, **Open a fenestella** with the *One contract* preset, approve in QoreX | QoreX shows the window and asks you to sign; the page then shows the open window | |
| 5 | Close the window, approve in QoreX | The window is gone | |
| 6 | Open ☰ → **Agent**, step 1 **Link the agent**, approve in QoreX | Either the agent shows as linked, or QoreX refuses the message type (screenshot the exact words) | |
| 7 | Step 6 **Autopay**: turn it on for Northwind, approve in QoreX | QoreX shows a 1 uqor transfer to yourself with the autopay memo; the page lists the permission | |
| 8 | Turn autopay off again, approve in QoreX | The permission is gone | |
| 9 | Step 2 **Fund your vault** | Expected refusal: the page says funding needs the Dashboard wallet, because QoreX does not sign raw EVM transactions | |
| 10 | Open ☰ → **Attack lab**, **Run every attack** | 13 of 13 refused, on the phone | |

## After

Send me the filled table and the screenshots. I will put the results in the README's wallet section, with every refusal in QoreX's own words, and fix anything on the page that looked wrong on the phone.
