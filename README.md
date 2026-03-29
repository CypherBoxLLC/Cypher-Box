# Cypher Box - A Fun Way to Play Bitcoin

**Website:** [cypherbox.io](https://cypherbox.io) | **Community:** [Telegram](https://t.me/BitcoinUserSupport) | **Email:** info@cypherbox.io

Forked from [BlueWallet](https://github.com/BlueWallet/BlueWallet) Release 6.5.1, tailored for onboarding newbies to advanced self-custody.

Built with React Native, Electrum, and powered by **Coinos.io + Strike APIs**

---

# FEATURES

## Lightning Accounts
* **Multi-currency** — Coinos.io + Strike.me (USD, EUR, GBP, AUD + more)
* Login via OAuth (Strike) or credentials (Coinos)
* Send and receive via Lightning Network
* Send and receive on-chain BTC
* Receive Liquid assets via Coinos
* Create and manage Lightning addresses
* Payment history with withdrawal threshold reminders
* Swap between Lightning accounts
* Withdraw to Vault, top-up from Vault
* Authentication tokens are user-accessible only (Keychain-stored)

## Hot Vault
* Private keys never leave your device
* SegWit-first, Bip39, Replace-By-Fee, Child-Pay-For-Parent support
* Coin control (label UTXOs, consolidate)
* Top-up Lightning Accounts
* Send to Cold Vault

## Cold Vault (Watch-Only)
* Private keys never leave your device
* SegWit-first, Bip39, RBF + CPFP support
* Coin control
* PSBT signing with BBQr animated QR support
* Send to Hot Vault

## Privacy & Security
* Plausible deniability
* UTXO visualization
* Custom Electrum server connection

---

# BUILD & RUN

> See the `engines` field in `package.json` for minimum Node/npm versions. Use even-numbered (LTS) versions.

```bash
git clone https://github.com/CypherBoxLLC/Cypher-Box.git
cd Cypher-Box
npm install
```

### Android

1. Open `android/` in Android Studio
2. Launch an AVD emulator or connect a physical device
3. `npx react-native run-android`

### iOS

```bash
npx pod-install
npm start
# in another terminal:
npx react-native run-ios
```

> **Debug on iOS Simulator:** Product → Destination Architectures → Show Both → choose Rosetta-compatible simulator.

### macOS (Catalyst)

```bash
npx pod-install
npm start
# open ios/BlueWallet.xcworkspace
# select scheme BlueWallet-NoLDK, click Run
```

---

# UPCOMING

* CI/CD pipeline
* Push notifications for Strike accounts
* Lightning Account settings screen

---

# RESPONSIBLE DISCLOSURE

Found a bug or vulnerability?
* Email: **info@cypherbox.io**
* Do not publicly disclose until resolved
* Valid disclosures may qualify for a bounty reward

---

**License:** [MIT](./LICENSE)  
**BlueWallet repo:** [github.com/BlueWallet/BlueWallet](https://github.com/BlueWallet/BlueWallet)