# Security policy

## Reporting a vulnerability

Email **info@cypherbox.io** with details. Please don't open a public GitHub
issue for an unpatched vulnerability; we'll coordinate disclosure.

Expected response: initial reply within 5 business days, then weekly progress
updates until resolved. We don't currently run a paid bounty program.

Safe harbour: we will not pursue legal action against good-faith research
that respects user funds and data and discloses responsibly.

## Scope

In scope: code in this repository, the Play Store release of Cypher Box
(`io.cypherbox.btc`), and the push-notification relay at
`notifications.cypherbox.io`.

Out of scope: BlueWallet upstream (report to BlueWallet directly), Strike,
CoinOS, Second.tech, Google Drive, and other third-party services we depend
on but do not operate.

## Verifying a published Android release

Cypher Box ships on Google Play as an AAB. Google re-signs with **Play App
Signing**, so every served APK carries Google's app-signing certificate (NOT
a key we hold). There are two independent things to check.

### 1. Signature: app-signing certificate SHA-256

```
25:5C:92:A4:55:9E:96:28:D2:97:F5:BE:EA:8B:F8:A8:7E:EF:BE:77:B5:9E:69:18:5B:DE:76:16:B6:4F:36:BA
```

Pull the installed APK off a device that has the Play build and verify:

```sh
adb shell pm path io.cypherbox.btc | head -n1 | sed 's/^package://' \
  | xargs -I{} adb pull {} cypherbox.apk
apksigner verify --print-certs cypherbox.apk | grep -i 'SHA-256 digest'
```

The SHA-256 digest printed must equal the value above. A mismatch means the
APK was not served by Play under our developer account.

### 2. Reproducibility: rebuild from source

`walletscrutiny/build.sh` rebuilds the unsigned release AAB from the
matching git tag inside a pinned Docker image, derives a universal APK, and
compares it against the Play binary, ignoring signature blocks and zip
compression. See [`walletscrutiny/README.md`](walletscrutiny/README.md).

Three configuration inputs are compiled into the binary at build time: the
Second.tech bark access token (`src/services/ark/secrets.ts`), the
push-relay API key (`blue_modules/secrets.ts`), and the Google Drive web
client ID (`.env`). Fresh clones build with committed `.example`
placeholders, so the toolchain's determinism is fully verifiable with no
secret in the tree (`make repro-verify`). A byte-match against the Play
binary additionally requires the production values for those three
constants, which is the current open item for a full walletscrutiny
verdict; see [`BUILD.md`](BUILD.md) §7 and §9.

An auditor who wants a *functional* mainnet Ark build can insert their own
Second.tech access token into `src/services/ark/secrets.ts` before building
(the file documents how to obtain one).
