# ⚡ Cypher Box — A Fun Way to Play Bitcoin

[![Release](https://img.shields.io/badge/release-v0.1.4-f7931a)](https://github.com/CypherBoxLLC/Cypher-Box/releases)
[![Reproducible build](https://github.com/CypherBoxLLC/Cypher-Box/actions/workflows/build-verify.yml/badge.svg)](https://github.com/CypherBoxLLC/Cypher-Box/actions/workflows/build-verify.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey)](https://github.com/CypherBoxLLC/Cypher-Box/releases)

**Website:** [cypherbox.io](https://cypherbox.io) · **Community:** [Telegram](https://t.me/BitcoinUserSupport) · **Email:** info@cypherbox.io

Cypher Box walks you up the self-custody ladder: start with an easy custodial Lightning account, graduate to a non-custodial Lightning vault on the Ark protocol, and land in full on-chain cold storage.

Cloned from [BlueWallet](https://github.com/BlueWallet/BlueWallet) 6.5.1. Built with React Native + Electrum, powered by **Strike**, **Coinos**, and **Second's Bark SDK**.

---

## 🪜 The self-custody ladder

| Rail | Custody | Network | Best for |
|---|---|---|---|
| ⚡ **Lightning Accounts** | Custodial (Strike / Coinos) | Lightning | First sats, everyday spending |
| ⛵ **Bark Vault** | **Self-custodial** | Ark protocol (L2) | Lightning speed, your keys |
| 🔥 **Hot Vault** | Self-custodial | Bitcoin on-chain | Savings on your device |
| 🧊 **Cold Vault** | Self-custodial (watch-only) | Bitcoin on-chain | Hardware-signed savings |

Swap between rails in-app: Lightning ↔ Bark, top-up vaults from Lightning, withdraw Lightning to vaults.

---

## ⚡ Lightning Accounts

* **Multi-currency** balances via Strike + Coinos (USD, EUR, GBP, AUD and more)
* OAuth login (Strike) or credentials (Coinos); tokens live only in your device Keychain
* Send/receive Lightning and on-chain BTC; Liquid receive via Coinos
* Lightning addresses, payment history, withdrawal-threshold reminders
* Real-time payment notifications via a self-hosted relay
* Swap between accounts, withdraw to vaults, top-up from vaults

## ⛵ Bark Vault — non-custodial Lightning (Ark protocol)

Your sats live in **lightning capsules (VTXOs)** on Bitcoin mainnet via the [Ark protocol](https://ark-protocol.org) and [Second's Bark SDK](https://gitlab.com/ark-bitcoin/bark). Self-custodial: you can always exit to the chain without the server's permission.

* Send & receive over Lightning, receive on Ark addresses, board from on-chain
* **Capsule dashboard** with color-coded expiry at a glance:

  | | Lightning Capsule age | Meaning |
  |---|---|---|
  | 🟢 | 21+ days left | Fresh, nothing to do |
  | 🟡 | 14–20 days | Past the midpoint |
  | 🟠 | 7–13 days | Refresh window open |
  | 🔴 | < 7 days | Refresh now, reminders firing |

* **Tap-to-refresh reminders**: up to 5 escalating notifications (4d/2d/24h/12h/6h) before any capsule expires; tapping one opens the app with the refresh already running
* **Encrypted backups** (`.cbark`): iCloud Drive on iOS, folder of your choice + Google Drive on Android, verified round-trip at wallet creation
* **Emergency exit**: unilateral on-chain sweep, no server cooperation needed
* Transparent fees shown inline before every action

## 🔥 Hot Vault & 🧊 Cold Vault

* Keys generated and stored on-device, never leave it
* SegWit-first, BIP39, RBF + CPFP
* **Coin control** with UTXO visualization: label, consolidate, pick coins
* Cold Vault: watch-only + PSBT signing with **BBQr animated QR** for airgapped hardware
* Custom Electrum server support, plausible deniability

---

## 🔍 Don't trust, verify

Every release is **reproducible**:

* CI builds the unsigned bundle **twice** in a [pinned container](./Dockerfile.build) and fails on any byte difference
* Releases ship with the unsigned artifact + SHA-256 and a signed git tag: [releases](https://github.com/CypherBoxLLC/Cypher-Box/releases)
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

### macOS (Catalyst)

```bash
npx pod-install
npm start
# open ios/BlueWallet.xcworkspace, scheme BlueWallet-NoLDK, Run
```

---

## 🗺 Roadmap

* ⏳ Bark SDK 0.11.x upgrade: offline wallet open, truthful send status, stuck-payment recovery
* ⏳ iOS TestFlight → App Store release
* ⏳ Incoming on-chain transaction notifications with capsule visuals
* ⏳ Revive the e2e test suite on RN 0.77

---

## 🛡 Responsible disclosure

Found a vulnerability? Email **info@cypherbox.io** — please don't disclose publicly until it's resolved. Valid, responsible disclosures may qualify for a bounty based on severity. See [SECURITY.md](./SECURITY.md).

---

**License:** [MIT](./LICENSE) · **Upstream:** [BlueWallet](https://github.com/BlueWallet/BlueWallet) · **Bark SDK:** [Second](https://second.tech)
