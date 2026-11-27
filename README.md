# Cypher Box - Progressive Bitcoin Self-custody

[![Release](https://img.shields.io/github/v/release/CypherBoxLLC/Cypher-Box?color=f7931a&label=release)](https://github.com/CypherBoxLLC/Cypher-Box/releases)
[![Reproducible build](https://github.com/CypherBoxLLC/Cypher-Box/actions/workflows/build-verify.yml/badge.svg)](https://github.com/CypherBoxLLC/Cypher-Box/actions/workflows/build-verify.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey)](https://github.com/CypherBoxLLC/Cypher-Box/releases)

**Website:** [cypherbox.io](https://cypherbox.io) · **Community:** [Telegram](https://t.me/BitcoinUserSupport) · **Email:** info@cypherbox.io

Cypher Box walks you up the self-custody ladder: start with an easy custodial Lightning account(s), graduate to a Hot/Ark vault, land in full on-chain cold storage for long term secure storage, and reach the top rung by signing that cold storage yourself in **Offline Seed-Signing mode**: a spare phone that stays offline and keeps no seed. You can reverse the flow and top-up coins from cold storage back to your hot or lightning wallets for cheap fast payments.

Cloned from [BlueWallet](https://github.com/BlueWallet/BlueWallet) 6.5.1. Built with React Native + Electrum, powered by **Strike**, **Coinos**, and **Second's Bark SDK**.

---

## 🪜 The self-custody ladder

| Rail | Custody | Network | Best for |
|---|---|---|---|
| ⚡ **Lightning Accounts** | Custodial (Strike / Coinos) | Lightning | First sats, everyday spending |
| ⛵ **Bark Vault** | Escapable Lightning | Ark protocol (L2) | Lightning speed, your keys, experimental |
| 🔥 **Hot Vault** | Self-custodial | Bitcoin on-chain | Savings on your device |
| 🧊 **Cold Vault** | Self-custodial (watch-only) | Bitcoin on-chain | Savings signed offline by a hardware wallet or a phone in Offline Seed-Signing mode |
| 📴 **Offline Seed-Signing mode** | Self-custodial, offline, keeps no seed | Bitcoin on-chain (signs for a watch-only wallet) | The top rung: cold savings signed on your own offline phone, alone or as a multisig co-signer, from a seed you can make with dice |

Swap between rails in-app: Lightning ↔ Bark, top-up vaults from Lightning, withdraw Lightning to vaults.

---

## ⚡ Lightning Accounts

* OAuth login (Strike) or credentials (Coinos); tokens live only in your device's Keychain (iPhone) or Keystore (Android)
* Shown only where they can be offered: Strike in the countries on Strike's list (not the EEA, the UK, India or South Korea), Coinos everywhere but the EEA and the UK. On iPhone the App Store country decides; on Android, the SIM and mobile network country
* Send/receive Lightning and on-chain BTC; Liquid receive via Coinos
* Lightning addresses, payment history, withdrawal-threshold reminders
* Real-time payment notifications via a self-hosted relay
* Swap between accounts, withdraw to vaults, top-up from vaults

## ⛵ Bark Vault - Escapable Lightning Ark 

* Read full user guide: https://cypherbox.io/how-to-use-your-bark-vault/

* Your sats live in **lightning capsules (VTXOs)** on Bitcoin mainnet via the [Ark protocol](https://ark-protocol.org) and [Second's Bark SDK](https://gitlab.com/ark-bitcoin/bark). 
Self-custodial: you can exit to the chain without the server's permission.

* Send & receive over Lightning, receive on Ark addresses, board from on-chain
* **Capsule dashboard** with color-coded expiry at a glance:

  | | Lightning Capsule age | Meaning |
  |---|---|---|
  | 🟢 | 21+ days left | Fresh, nothing to do |
  | 🟡 | 14–20 days | Past the midpoint |
  | 🟠 | 7–13 days | Refresh window open |
  | 🔴 | < 7 days | Refresh now, reminders firing |

* **Tap-to-refresh reminders**: up to 5 escalating notifications (4d/2d/24h/12h/6h) before any capsule expires; tapping one opens the app with the refresh already running
* **Encrypted backups** (`.cbark`), optional: iCloud Drive on iOS, a folder of your choice or Google Drive on Android. One backup file per device, shown as done only once a copy has left the phone
* **Emergency exit**: unilateral on-chain sweep, no server cooperation needed
* **Expired capsule recovery**: capsules that expired before a refresh show a RECOVER button, which refreshes them into a new capsule with a full lifetime (any fee shown first) or, if the server refuses, moves them on-chain to your Hot Vault
  > ⚠️ Recovering an expired capsule is at the discretion of the Ark Service Provider (ASP), Second.tech, which can stop allowing it at any time. Refresh your capsules before they expire.
* Transparent fees shown inline before every action

## 🔥 Hot Vault & 🧊 Cold Vault

* Keys generated and stored on-device, never leave it
* SegWit-first, BIP39, RBF + CPFP
* **Roll your own entropy**: add your own six-sided dice rolls to the 12 words, mixed with the phone's randomness
* **Optional BIP39 passphrase**, kept on the phone and never sent anywhere by the app (an iPhone's iCloud or encrypted computer backup includes it): it protects the paper backup, and recovery needs the seed *and* the passphrase
* **Keychain / Keystore backup** (optional): a copy of the 12 words in the iPhone Keychain or Android Keystore, opened with Face ID or fingerprint. Recovering checks each backup first (master fingerprint, first address, balance) before restoring it
* **Coin control** with UTXO visualization: label, consolidate, pick coins
* Cold Vault: watch-only + PSBT signing with **BBQr animated QR** for airgapped hardware wallets or a phone in Offline Seed-Signing mode
* Custom Electrum server support, plausible deniability
* **Privacy boundary:** the app is wired so your xPub is never exposed to the Lightning custodians or exchanges; they only ever see the single address you chose to withdraw to. Users are advised to practice good coin control and labelling.

## 📴 Offline Seed-Signing mode - the top rung

* Turns a dedicated phone that stays offline (an old phone you no longer use) into a cold signer for a watch-only wallet: a Cypher Box Cold Vault, Sparrow or another app
* **Stateless**: the seed is never written to the phone. You back it up on paper or steel and as a **SeedQR**, and scan the SeedQR each time you sign, so the seed is in memory only for that signature. Wipe Seed removes any seed saved before and confirms it's gone
* **Dice seeds you can check**: from 50 rolls of a six-sided die, the seed comes from your rolls alone (the SeedSigner and COLDCARD method), so [EntropyLab](https://entropylab.online) or Ian Coleman's BIP39 tool make the same 12 words from the same rolls. 77 rolls or more are recommended; with fewer, the rolls are mixed with the phone's randomness
* **Multisig co-signer**: the signer can be one key of a native SegWit multisig, tested with **Sparrow** and **Nunchuk** as the coordinator. Register the wallet file on the signer, check each key's fingerprint and the receive addresses, then sign
* **No blind signing**: before anything is signed, it shows what the transaction does, including which outputs are change, and hands the signed transaction back as a QR code
* One-way by design: it needs a fresh install on an offline phone, and the app then stays a signer

## 🌍 Languages

English and Arabic, with a full right-to-left layout in Arabic. French is next.

---

## 🔍 Don't trust, verify

Every release is **reproducible**:

* CI builds the unsigned bundle **twice, on two different machines**, in a [pinned container](./Dockerfile.build) and fails on any byte difference
* Releases ship with the unsigned artifact + SHA-256, a signed git tag, and a sideload APK signed with the upload key: [releases](https://github.com/CypherBoxLLC/Cypher-Box/releases)
* Rebuild it yourself: `make repro-verify` at any release tag
* [walletscrutiny/](./walletscrutiny) contains the verification script for comparing the Play Store binary against this source
* PRs are gated by dependency review, secret scanning (gitleaks), and unit tests

---

## 🛠 Build & run

> Minimum Node/npm versions: see `engines` in `package.json` (use even-numbered LTS).
> Toolchain pins, Gradle cache rules, codegen gotchas and other build-environment notes live in [docs/BUILD.md](docs/BUILD.md).

```bash
git clone https://github.com/CypherBoxLLC/Cypher-Box.git
cd Cypher-Box
npm ci   # always ci, never plain install — keeps the lockfile authoritative
```

### Android

1. Open `android/` in Android Studio
2. Start an AVD or connect a device
3. `npx react-native run-android`

### iOS

```bash
npx pod-install
npm start
# in another terminal:
npx react-native run-ios
```

> **iOS Simulator debug:** Product → Destination Architectures → Show Both → pick a Rosetta-compatible simulator.

---

## 🗺 Roadmap

* ✅ Bark SDK upgrade (bark 0.6.1): capsules stay spendable while refreshing, dust consolidation, safer exit
* ✅ 0.1.13: Offline Seed-Signing mode (dice seeds, SeedQR, multisig co-signer), expired Bark capsule recovery, Arabic
* ✅ 0.1.14: Electrum fake-transaction fix (verified Accelerate) and TLS certificate checking, Hot Vault keychain hardening, Bark SDK 0.9 (`@secondts/bark-react-native` 0.28) with a safer Emergency Exit, capsule labels
* ⏳ **Pre-signed emergency exits** and coin-selection fixes in exits (bark upstream)
* ⏳ **French translation**
* ⏳ Coin flips and 20-sided dice for seeds, back once fully tested
* ⏳ Revive the e2e test suite on RN 0.77
* ⏳ **Bring your own chain source**: point the Bark Vault at your own esplora endpoint (Umbrel, Start9, self-hosted Electrs) instead of a public block explorer, so your addresses never leave your node. Bitcoin Core RPC to follow. Changing the chain source touches refresh, unilateral exit, backup and recovery, so it ships only after all four are re-tested end to end.

---

## 🛡 Responsible disclosure

Found a vulnerability? Report it privately with **"Report a vulnerability"** on this repository's [Security tab](https://github.com/CypherBoxLLC/Cypher-Box/security/advisories), or email **info@cypherbox.io** - please don't disclose publicly until it's resolved. Valid, responsible disclosures may qualify for a bounty based on severity. See [SECURITY.md](./SECURITY.md).

---

**License:** [MIT](./LICENSE) · **Upstream:** [BlueWallet](https://github.com/BlueWallet/BlueWallet) · **Bark SDK:** [Second](https://second.tech)
