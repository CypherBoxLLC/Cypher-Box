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

**VTXOs and refreshes.** Your Ark balance is a set of VTXOs, each with an expiry date. Before they expire, they need to be refreshed back to the ASP, otherwise they settle out as regular on-chain UTXOs (slower and more expensive to spend). Cypher Box shows an in-app warning when any VTXO is within 7 days of expiry, and refreshing is one tap and one fee confirmation.

> **Important: refresh is not automatic today.** You must open the app before the expiry date and tap Refresh. The round runs in the foreground for up to a minute, so keep the app open until it confirms. We are working on background and push-notification reminders for a future release, but until that ships, treat your Ark wallet like a plant: it needs to be checked. If you do not refresh in time, your funds are not lost — they fall back to on-chain UTXOs and become slower and more expensive to spend.

**Ark-backup file.** Unlike a normal wallet, a 12 or 24 word seed alone is not enough to recover an Ark wallet. You also need an `ark-backup` file that changes every time your VTXO set changes. We auto-save this file locally and, with your consent, sync it to **iCloud or Google Drive**, so a fresh device install can restore everything. Lose the file and the seed and the funds are gone — same as any wallet.

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
- The cloud-synced `ark-backup` file is encrypted on your device before it leaves it. iCloud and Google Drive cannot read its contents.

Bark is not a privacy coin and we do not market it as one. It is meaningfully more private than a custodial wallet, and roughly comparable to good non-custodial Lightning practice.

## Should you use it

Use Ark in Cypher Box for what it is good at: small to mid-sized everyday spending, frequent payments, fiat onramps, and moving between exchanges and self-custody quickly. **Keep long-term savings in cold storage.**

This is bleeding-edge Bitcoin infrastructure. The protocol will change. The SDK will change. We will ship breaking updates. If that is not a tradeoff you want, stick to the on-chain wallet inside Cypher Box and revisit Ark in a few releases.
