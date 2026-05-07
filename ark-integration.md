# Ark in Cypher Box: Self-Custody Bitcoin Without the Liquidity Headache

Cypher Box now ships an Ark wallet, built on second.tech's **Bark SDK**. Ark is a new layer-2 Bitcoin protocol designed to give you Lightning-like speed and cost while keeping the keys in your hands. This page explains what we built, what it costs, and what you give up in return — so you can decide how much you want to put into it.

> **This is highly experimental technology.** The Ark protocol and the Bark SDK are pre-1.0. Treat your Ark balance the way you would treat a hot wallet: small enough that you can sleep if it breaks.

## Why Ark

Today, there are mostly two ways to spend bitcoin instantly:

- **Custodial Lightning wallets** (Strike, Wallet of Satoshi, Cash App, and so on). Fast, cheap, easy. The catch is that the company holds your keys. They can freeze, censor, or lose your money, and most will eventually require KYC for any meaningful amount.
- **Non-custodial Lightning** (Phoenix, Breez, Mutiny, and others). You hold keys, but you also inherit channel and liquidity management: channel opens, splices, force-closes, inbound capacity, on-chain fees during congestion. It works, but the UX and fee surface are still rough for everyday users.

**Ark sits between them.** You hold the keys to your funds, encoded as VTXOs (virtual UTXOs). An Ark Service Provider (ASP) batches everyone's VTXOs into rounds, so payments are instant and cheap and you do not manage channels. If the ASP misbehaves or disappears, you can broadcast on-chain to recover your money on your own — no ASP cooperation required. That last property is what makes Ark self-custodial.

The price of that arrangement is what the rest of this page is about.

## What's new in the UX

Ark introduces a few concepts that do not exist in older wallets. We have tried to hide the sharp edges without hiding the tradeoffs.

**VTXOs and refreshes.** Your Ark balance is a set of VTXOs, each with an expiry date — typically around 30 days, set by the ASP. Before that expiry, your wallet has to refresh the VTXO back to the ASP to extend its lifetime. Cypher Box does this for you in the background every six hours by default. New wallets ship with **Auto-refresh** on; you can flip it off in the Capsules tab. You also set a fee ceiling there — rounds with an estimated cost above your ceiling are skipped rather than auto-paid, so a sudden mempool spike cannot quietly drain your wallet. The home screen shows a "last refresh Xm ago" banner so you can verify it is working, and manual refresh always works regardless of toggle state or whether the OS deferred a scheduled fire.

> **What actually happens if a refresh is missed.** While a VTXO is alive, you have a unilateral exit path: you can broadcast on-chain to recover the funds without the ASP's help. At expiry, both you and the ASP can spend the VTXO — and the ASP is built to sweep entire rounds in a single efficient transaction, so in practice the ASP will sweep first. The protocol's recovery mechanism is that the ASP then issues you an "Ark Note" which you can redeem for a fresh VTXO in a later round. Funds are usually recoverable that way, **but only if the ASP cooperates.** If the ASP is offline, censoring you, or gone at the moment your VTXO expires, the Ark Note path does not save you. Missing a refresh is not "slower and more expensive to spend" — it is a real downgrade from self-custody to trusting the ASP to honor a future redemption. Auto-refresh exists precisely so you never enter this state.

Auto-refresh requires the wallet seed to be readable by the app while your phone is unlocked, so the background task can sign without prompting you. You confirm with Face ID or Touch ID once during wallet setup. If you would rather not make that tradeoff, flip the toggle off and refresh manually — the banner still reminds you when any VTXO is within 7 days of expiry.

> **Android users — read this.** Android background work depends on your phone's battery settings. Cypher Box prompts you to grant **Settings → Apps → Cypher Box → Battery → Unrestricted** during wallet setup. Without it — and especially on Samsung, Xiaomi, Huawei, and OnePlus devices — the OS will silently delay or skip refreshes, the same reason your bank app sometimes misses notifications. iOS does not require an equivalent setting.

**Ark-backup file.** Unlike a normal wallet, a 12 or 24 word seed alone is not enough to recover an Ark wallet — that only gets you back an empty wallet. You also need an `ark-backup.cbark` file that changes every time your VTXO set changes. Cypher Box rewrites this file automatically on every wallet change and pushes it to multiple destinations so the loss of any one does not lose your funds. On Android that means three places: the app's local storage, your connected Google Drive, and a folder you pick via the system file chooser — the last one survives uninstalling Cypher Box. On iOS it lives in the Files app under Cypher Box; if you have iCloud Drive sync enabled for the app, Apple mirrors it off-device. The file is encrypted on your device with a key derived from your seed before it leaves; whoever stores it sees ciphertext only. When you create a wallet, Cypher Box refuses to finish setup until at least one off-device backup has been written, read back, and decrypted to confirm the round-trip works.

**Emergency exit.** When the ASP is healthy, exits are fast and nearly free. If the ASP is censoring you, offline, or gone, Cypher Box lets you trigger a unilateral exit that broadcasts your VTXOs on-chain. This costs network fees and takes confirmations, but it does not require ASP cooperation.

**Fiat onramp.** We have integrated **Strike** for fiat purchases. You can buy bitcoin and have it land directly in your Ark wallet, in small amounts, without thinking about UTXO management or channel opens.

**Instant zero-fee swaps.** You can move funds between **Coinos**, **Strike**, and your Ark balance instantly with no Cypher Box fee — only the underlying Lightning routing fees. For larger amounts, withdraw to a cold-storage on-chain address instead. The wallet makes that a one-tap action for exactly this reason.

## Fees

Short and honest:

- **Receiving Lightning: free.** No fee, no inbound liquidity purchase, no channel-open cost. For a non-custodial wallet, this is unusual and we think it matters.
- **Outgoing Lightning: 0.5%** of the payment amount, plus any routing fees the network charges.
- **On-chain withdrawals:** standard Bitcoin network fees, paid to miners. Cypher Box does not add a markup.
- **VTXO refreshes and Ark rounds:** participation costs are absorbed by the ASP under normal use. In some scenarios there can be a small on-chain cost when VTXOs need to be settled to the base layer. The wallet shows the cost before you confirm.

If a fee ever surprises you, that is a bug — please report it.

## Privacy notes specific to Bark

Bark is designed so that the ASP sees the rounds it processes, but does not see a persistent link between your identity and individual VTXOs across rounds. Each round mixes your output with everyone else's, similar in spirit to a coinjoin. With that said:

- The ASP can see Lightning invoices you ask it to pay or receive, including amount and destination. This is the same exposure you would give any LSP.
- Your IP address is visible to the ASP and to Cypher Box's backend services. If that matters to you, run the app behind a system-level VPN. Native Tor routing is on our roadmap but is not yet shipping.
- On-chain exits and on-chain deposits are visible on the public blockchain like any other Bitcoin transaction.
- Your `ark-backup.cbark` file is encrypted on your device before it leaves it. Whoever ends up storing a copy — Google Drive, iCloud Drive, or a folder on your phone — sees ciphertext only.

**Auto-refresh does not change any of this.** Your seed never leaves the device — it stays in the OS keychain and is read only by local wallet code to sign refresh requests. Cypher Box's servers do not sit between your wallet and the ASP; the background task talks directly to the ASP, the same as when you tap Refresh manually. Our notifications server sees nothing about your seed, your VTXOs, or your transactions. Turning Auto-refresh on does not increase our visibility into your wallet.

Bark is not a privacy coin and we do not market it as one. It is meaningfully more private than a custodial wallet, and roughly comparable to good non-custodial Lightning practice.

## Honest limits

A short list of things that are not perfect and worth knowing before you commit funds:

- **Recovery requires both your seed and your backup file.** The seed alone reconstructs an empty wallet. This is a property of the Ark protocol, not a Cypher Box bug — there is no fix at the wallet layer.
- **Auto-backup runs on the wallet's 30-second sync tick.** A wallet state change paired with an immediate uninstall could lose the latest update. Closing the app for a few seconds before uninstalling closes that window.
- **iOS off-device backup depends on your iCloud Drive setting for Cypher Box,** which the app cannot verify on its own. Check the toggle in iOS Settings if you are relying on cloud backup.
- **Aggressive vendor battery managers** (Samsung One UI, Xiaomi MIUI, Huawei EMUI, OnePlus, others) can defer Auto-refresh indefinitely if Cypher Box is not on their unrestricted list. The app prompts you on first enable; if you skip the prompt, plan on opening the app to refresh manually.
- **Drive backups are tied to the Google account you connected.** Switching accounts orphans the previous backup in the old account. Re-connect to the new account to keep auto-backup current.

## Should you use it

Use Ark in Cypher Box for what it is good at: small to mid-sized everyday spending, frequent payments, fiat onramps, and moving between exchanges and self-custody quickly. **Keep long-term savings in cold storage.**

This is bleeding-edge Bitcoin infrastructure. The protocol will change. The SDK will change. We will ship breaking updates. If that is not a tradeoff you want, stick to the on-chain wallet inside Cypher Box and revisit Ark in a few releases.
