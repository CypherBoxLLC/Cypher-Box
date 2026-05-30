# Ark / Bark SDK Integration — Progress Tracker

**Branch:** `CB-Ark` (active dev branch; `rn-upgrade` / `Bam-RN` were the pre-merge snapshots, kept on origin for reference)
**SDK:** `@secondts/bark-react-native@0.4.1` (Second.tech, UniFFI Rust-core binding)
**Plan source:** `/Users/kaliko/Documents/Ark implementaion.rtf` + plan in assistant-generated integration doc

This file is the single source of truth for Ark integration state. Update it after every meaningful change so any other agent can pick up where the last left off.

---

## ▶ STATUS: MAINNET, UNCONDITIONAL (2026-05-27)

**Cypher Box runs Ark on Bitcoin mainnet. There is no signet code path and there never will be one.** Do not add one "for testing." We test on mainnet with small amounts.

Why this is in big text at the top: most of this document's pre-May history is written as if signet were the dev target and mainnet were a future flip. That mental model is dead. Ark is non-custodial, Second.tech doesn't geo-restrict the EU, and the production plan is Strike + Ark (no CoinOS). So Ark needs to be visible in every channel — Metro, archive, TestFlight, App Store — pointed at the live ASP.

### Live config ([src/services/ark/config.ts](src/services/ark/config.ts))

| Setting | Value |
|---|---|
| `FEATURE_ARK_ENABLED` | `true` (unconditional; not `__DEV__`) |
| `ARK_NETWORK` | `Network.Bitcoin` |
| `ARK_SERVER_URL` | `https://ark.second.tech` |
| `ESPLORA_URL` | `https://blockstream.info/api` |
| ASP auth | `BARK_ACCESS_TOKEN` from gitignored `src/services/ark/secrets.ts` |
| `ARK_VTXO_DUST_SATS` | `330` (mirrors Bitcoin standard dust) |
| `ARK_REFRESH_MIN_SATS` | `500` (empirical ASP minimum for round participation) |

### Do not
- Add a `signet` branch to `ARK_NETWORK` selection logic.
- Reintroduce `ark.signet.2nd.dev` or `esplora.signet.2nd.dev` as URLs anywhere in the codebase.
- Wrap Ark behind `__DEV__` again. The kill-switch exists as a boolean for emergency-disable, not as a per-environment gate.
- Suggest "let's test this on signet first." We don't.

### Implications for backups & recovery
- Datadirs on disk hold **real funds**. Treat reset / delete operations as destructive in every code path — no silent wipes, every wipe confirmed by the user.
- Seed-alone recovery still does NOT restore VTXOs (Bark limitation — see Phase 2 notes below). Encrypted `.cbark` backups (iCloud Drive on iOS, SAF folder + Google Drive on Android) are the only path back to a wallet's balance. Wallet creation hard-fails if the chosen backup channel can't verify the written blob round-trips.

### Bark SDK back-compat (carried forward from 2026-04-25, still accurate)
- Second.tech maintains SQLite migration files and back-compat CI since `0.1.0-beta7/8`. A Bark version bump won't silently break existing `.cbark` files — but our backup/restore CI gap (open item below) means we should still round-trip-test before adopting a new minor.
- Recovery mailbox: ASP-side infra has been live since `0.1.0`. Client-side recovery is on Second.tech's roadmap; once shipped, `.cbark` demotes from mandatory to belt-and-suspenders.

---

## Status at-a-glance

_(refreshed 2026-05-27)_

| Phase | Status | Notes |
|-------|--------|-------|
| 0. Foundations | **DONE** | SDK installed, pods linked, Android prechecks pass, config + datadir services scaffolded |
| 1. Seed create + keychain | **DONE** | Real `Wallet.create` + `Wallet.open` wired; Keychain persistence + boot-time auto-restore + production-visible Reset / in-context recovery from stale datadir. Hot-vault seed reuse still TODO. |
| 2. Encrypted backup/restore | **DONE** | Multi-wallet, fingerprint-keyed `.cbark` files; native AES (off-thread); auto-backup-on-change with throttle; iOS Files-app + iCloud Drive sync; Android SAF user-chosen folder + Google Drive channels; restore-from-folder before file picker; verified backup on wallet create (hard-fails create if backup can't be verified). Seed-only recovery still NOT possible — datadir backup remains mandatory. |
| 3. Balance + VTXOs + History | **DONE** | `wallet.balance()` + `wallet.allVtxos()` + 30s sync + chain tip + `wallet.movements()` all wired. Structural refresh classifier; per-kind details; refreshes hidden by default; exit-destination backfill from Hot Vault reserved slot. Headline balance now spendable-only (filters expired dust). |
| 4. Receive | **DONE** | In-sheet Ark sub-menu (Lightning / Bitcoin / Ark) replacing the standalone screen. Pending-LN-receive row surfaces between payment and VTXO materialisation. Bolt11 invoice unchanged. |
| 5. Send | **DONE** | Service + screen + cross-screen rewrite landed. Dust pre-flight guards, Send-Max one-tap, Consolidate banner, dust-change downgraded from blocker to warning. Fiat preview falls back to BlueWallet rate when source isn't Strike. End-to-end send tested implicitly through bg-refresh + LN-receive flows on mainnet. |
| 6. Fees | **DONE (functional)** | `estimateArkSendFee()` + `estimateArkRefreshFee()` exposed inline in Send + Refresh flows. User-facing Fees section in [ark-integration.md](ark-integration.md) rewritten to Second.tech's actual schedule. Per-round fee ceiling on auto-refresh skips rounds above the user's cap. No standalone Fees screen — fees live in the action sheets where they're spent. |
| 7. Emergency exit | **DONE** | [src/services/ark/exit.ts](src/services/ark/exit.ts) + Vault-tab Emergency Exit entry + explainer screen. Exit destination backfilled from Hot Vault reserved slot. Per-wallet iOS iCloud backup writes still flow alongside the exit path. |
| 8. Notifications + background refresh | **DONE** | Background VTXO refresh shipped (PR #91 merged into CB-Ark). Native wake via Android `AlarmManager` (swapped out of WorkManager) and iOS BG tasks; opt-in relay push (`wss://notifications.cypherbox.io:3003`); per-row spinning refresh icon flips to cancel-X; "Cancelling" intermediate state; auto-refresh on LN receive with dust consolidation; boot rearm; battery-optimisation onboarding. Latest fix excludes expired VTXOs from the refresh sweep and locks down their row UI. |
| 9. Hardening | **PARTIAL** | `FEATURE_ARK_ENABLED` is now unconditional `true` — kill-switch retained as a boolean for emergency disable, not a per-environment gate. Backup/restore CI + `crypto-js` removal still pending. Activity log + structured telemetry now landed and feed the triage loop. RELAY_API_KEY pulled out of source into a gitignored secrets file. `BARK_ACCESS_TOKEN` likewise. |

---

## Phase 0 — DONE

### 0.1 SDK install
- Added to `package.json`: `"@secondts/bark-react-native": "0.3.3"` (pinned **exact**, no caret — per RTF spike warning about schema instability).
- Brought in peer dep `uniffi-bindgen-react-native@0.30.0-1` (exact).
- Install verified via `npm install` (2 packages added).

### 0.2 Native plumbing
- **iOS**: `pod install` succeeded under `RCT_NEW_ARCH_ENABLED=1 LANG=en_US.UTF-8`. `BarkReactNative` + `uniffi-bindgen-react-native` pods installed. Auto-linking via RN autolink. xcframework at `node_modules/@secondts/bark-react-native/build/RnBark.xcframework`.
- **Android**: jniLibs present for `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`. Root Gradle config already meets requirements (`minSdk=24`, `compileSdk=35`, `ndk=26.1.10909125`, `newArchEnabled=true`). Autolinking handled by RN CLI; no settings.gradle edit needed. App-level `android:allowBackup="false"` is already set in `android/app/src/main/AndroidManifest.xml:28` — so no separate backup rules needed for the datadir folder.
- **Not done yet**: actual on-device build. First real build run will surface any linker/codegen issues. Do this before Phase 1.

### 0.3 Config service
- File: [src/services/ark/config.ts](src/services/ark/config.ts)
- Exports:
  - `FEATURE_ARK_ENABLED` — currently `__DEV__`. Gate all Ark UI/logic behind this until signet→mainnet rollout.
  - `ARK_NETWORK: Network` — `Signet` in dev, `Bitcoin` in prod.
  - `ARK_SERVER_URL` — `https://ark.signet.2nd.dev` (dev) / `https://ark.mainnet.2nd.dev` (prod). **Prod URL is a guess** — confirm before mainnet rollout (Second.tech docs / status page).
  - `ESPLORA_URL` — `https://esplora.signet.2nd.dev` (dev) / `https://blockstream.info/api` (prod).
  - `createArkConfig(overrides?)` → `Config` built via the generated factory with all optional bitcoind fields set to `undefined`. Accepts overrides for advanced-settings path in a future phase.

### 0.4 Datadir helper
- File: [src/services/ark/datadir.ts](src/services/ark/datadir.ts)
- `ARK_DATADIR = ${DocumentDirectoryPath}/bark`
- `ensureArkDatadir()` → idempotent; `RNFS.mkdir` with:
  - `NSURLIsExcludedFromBackupKey: true` — keeps iCloud from auto-backing up VTXO state (we do our own encrypted backup in Phase 2).
  - `NSFileProtectionKey: 'NSFileProtectionCompleteUntilFirstUserAuthentication'` — matches the Keychain `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY` posture used for the Ark seed.

### 0.5 Barrel export
- File: [src/services/ark/index.ts](src/services/ark/index.ts) — re-exports config + datadir API.

### Verification
- `npx tsc --noEmit -p tsconfig.json` — no new errors introduced in `src/services/ark/`. (Pre-existing repo-wide TS errors remain untouched.)

---

## Existing mockup UI (from before Phase 0)

These files were already on disk as part of the earlier Ark UI mockup work. They currently call `setTimeout` mocks where real SDK calls go. Phase 1 replaces those.

- [src/screens/Account/CreateArkScreen/index.tsx](src/screens/Account/CreateArkScreen/index.tsx) — entry screen with "Use Hot Vault seed" toggle + "Create Ark wallet" CTA. Mocks `Wallet.create` with `setTimeout(600)`.
- [src/screens/Account/ArkSeedPhraseScreen/index.tsx](src/screens/Account/ArkSeedPhraseScreen/index.tsx) — 12-word reveal + "Save to Keychain" toggle. Already uses `bip39` + `react-native-keychain`.
- [src/components/ArkWallet/index.tsx](src/components/ArkWallet/index.tsx) — wallet card on home.
- [src/screens/Strike/CheckingAccountNew/ArkCapsules.tsx](src/screens/Strike/CheckingAccountNew/ArkCapsules.tsx) — capsule breakdown (placeholder balances).
- [Navigation.js](Navigation.js) — already registers `CreateArkScreen` + `ArkSeedPhraseScreen`.

---

## Key API surface (from the installed 0.3.3 type defs)

All the following live in `@secondts/bark-react-native` and are what Phase 1+ will wire up.

### Top-level
```ts
function generateMnemonic(): string;
function validateMnemonic(mnemonic: string): boolean;
function validateArkAddress(address: string): boolean;
function extractTxFromPsbt(psbtBase64: string): string;
enum Network { Bitcoin = 0, Testnet = 1, Signet = 2, Regtest = 3 }
```

### Config factory
```ts
Config.create({ serverAddress, esploraAddress, network, /* + ~10 optional bitcoind/timing fields */ }): Config
```

### Wallet (Ark side)
```ts
class Wallet {
  static create(mnemonic, config, datadir, forceRescan): Promise<Wallet>;
  static open(mnemonic, config, datadir): Promise<Wallet>;
  static createWithOnchain(mnemonic, config, datadir, onchainWallet, forceRescan): Promise<Wallet>;
  static openWithOnchain(mnemonic, config, datadir, onchainWallet): Promise<Wallet>;

  balance(): Promise<Balance>;        // includes on-chain + VTXO + pending breakdown
  allVtxos(): Promise<Vtxo[]>;
  arkInfo(): Promise<ArkInfo | undefined>;
  allExitsClaimableAtHeight(): Promise<number | undefined>;
  boardAll(onchainWallet): Promise<...>;
  boardAmount(onchainWallet, amountSats): Promise<...>;
  // send / receive / movements / exit / notifications — see full def
  notifications(): // stream of WalletNotification (MovementCreated | MovementUpdated | ChannelLagging)
}
```

### OnchainWallet (BDK-backed, or custom via callbacks)
```ts
class OnchainWallet {
  static default_(mnemonic, config, datadir): Promise<OnchainWalletInterface>;
  static custom(callbacks: CustomOnchainWalletCallbacks): OnchainWalletInterface;
  balance(): Promise<OnchainBalance>;
  newAddress(): Promise<string>;
  send(addr, amountSats, feeRateSatPerVb): Promise<string /* txid */>;
  sync(): Promise<bigint>;
}
```

### Wallet notifications (Phase 8)
`WalletNotification` is a tagged union: `MovementCreated`, `MovementUpdated`, `ChannelLagging`. Stream is obtained via `wallet.notifications()` and drained with `next_notification()` in a loop. Each call creates an independent stream.

### Full TS defs
`node_modules/@secondts/bark-react-native/lib/typescript/module/src/generated/bark.d.ts` (4066 lines). Read before guessing API shape.

---

## Gotchas / open items to carry forward

1. **Prod ASP URL is a guess** — `https://ark.mainnet.2nd.dev` is inferred from the signet pattern. Confirm via Second.tech docs before flipping the feature flag for mainnet.
2. **`Wallet.create` vs `createWithOnchain`** — decide in Phase 1 whether the Ark wallet should own its own BDK onchain sub-wallet (via `createWithOnchain` + `OnchainWallet.default_`) or whether we'll pass a custom onchain wallet that reuses the existing Cypher Box hot-vault UTXOs. The RTF plan leans toward separate — Bark's BDK wallet is isolated, easier to reason about. Revisit if users complain about "why do I have two on-chain balances".
3. **Schema stability — UPDATED (2026-04-25, Bark dev response):**
   - Second.tech confirmed backwards compatibility since `0.1.0-beta7/beta8`. Schema changes use SQLite migration files; server ↔ client compatibility tested in their CI.
   - Our raw-datadir .cbark backup approach is therefore less fragile than originally feared. Still worth the CI backup→restore test on every version bump (Phase 9), but a bump is not a silently-breaking event.
   - The `"Updating bark or captaind may corrupt your wallet"` README warning appears to be pre-migration-system legacy text.
4. **Recovery from seed — PARTIAL (recovery mailbox infrastructure in place, client code coming):**
   - Second.tech confirmed: since `0.1.0`, when you receive a VTXO it is posted to an ASP-hosted "recovery mailbox" so the future self can recover without the local database.
   - The **client-side recovery code is not yet implemented** — `forceRescan: true` still produces an empty wallet today (confirmed by our testing).
   - **Impact on us now:** No change. Phase 2 backup is still mandatory for mainnet because the recovery path isn't usable yet.
   - **Impact in the future:** Once Second.tech ships the client recovery code, `recoverArkWalletFromKeychain()` with `forceRescan: true` will actually restore VTXOs from the mailbox. At that point:
     - The "⚠ Back up to recover" label in `ArkCapsules` becomes misleading — VTXOs received after 0.1.0 will be mailbox-recoverable even without a .cbark backup.
     - The `RecoverArkScreen` seed-input path becomes the primary non-destructive recovery flow.
     - The .cbark backup demotes to "belt-and-suspenders" rather than "only path to funds".
   - **TODO when recovery ships:** flip `recoverability` logic in ArkCapsules to check SDK version / mailbox feature flag. Likely a `hasRecoveryMailbox` field on `wallet.arkInfo()` — watch Bark changelog.
5. **First real build** — iOS and Android builds have not been run since SDK install. Do a `npm run ios` and `npm run android` before Phase 1 so any native linker issue is caught in isolation, not mixed with wallet-creation bugs.
6. **Cache-bust step** — if anything gets weird after pulling this branch on a fresh machine: `rm -rf ios/Pods ios/build && cd ios && LANG=en_US.UTF-8 RCT_NEW_ARCH_ENABLED=1 pod install && cd .. && cd android && ./gradlew clean && cd ..`.

---

## Phase 1 pickup checklist (for the next agent)

Starting point: the CreateArkScreen mock. Real flow:

1. **Replace mock in `CreateArkScreen`**:
   - Import from `@Cypher/services/ark`: `createArkConfig`, `ensureArkDatadir`, `FEATURE_ARK_ENABLED`.
   - Gate screen render on `FEATURE_ARK_ENABLED`.
   - On submit:
     ```ts
     const datadir = await ensureArkDatadir();
     const config = createArkConfig();
     await uniffiInitAsync();   // from '@secondts/bark-react-native' — run once on app boot, not per-screen
     const wallet = await Wallet.create(mnemonic, config, datadir, /*forceRescan*/ false);
     ```
   - Wire a singleton wallet accessor (e.g. `src/services/ark/walletHandle.ts`) so the rest of the app can grab the open handle without re-initializing.

2. **`uniffiInitAsync`** must be called once at app startup before any Bark call. Candidate location: App boot sequence (same place push-registration lives). Track this as a separate follow-up if the first attempt throws.

3. **ArkSeedPhraseScreen** — the mock mnemonic-transport via `route.params` must become a transient zustand field `_pendingArkMnemonic` (non-persisted) before we ship. Today it's a security foot-gun.

4. **Hot-vault-seed reuse** — the `useHotVaultSeed` toggle currently only sets a flag. Needs real reads from `RNSecureKeyStore` to grab the existing hot-vault mnemonic and pass it into `Wallet.create`. Warn the user about the shared-leak risk.

5. **Smoke test before moving on**:
   - Create an Ark wallet in a signet build.
   - Run `wallet.arkInfo()` — should return non-undefined (TOFU against the ASP).
   - Confirm `${DocumentDirectoryPath}/bark/` has SQLite files after creation.

---

## Commands cheatsheet

```bash
# Re-pin SDK (do not move off exact pin without a backup-restore test)
npm install --save-exact @secondts/bark-react-native@0.3.3

# iOS pods
cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 RCT_NEW_ARCH_ENABLED=1 pod install

# Type-check Ark files only
npx tsc --noEmit -p tsconfig.json 2>&1 | grep services/ark

# Run the app (signet-gated by FEATURE_ARK_ENABLED, currently = __DEV__)
npm run ios
npm run android
```

---

## Changelog

- **2026-04-20** — Phase 0 complete: SDK pinned at 0.3.3, iOS pods installed, Android preflight passed, `src/services/ark/{config,datadir,index}.ts` scaffolded, feature-flag `FEATURE_ARK_ENABLED=__DEV__`. No first on-device build yet.
- **2026-04-20** — Phase 1 partial:
  - Added [src/services/ark/walletHandle.ts](src/services/ark/walletHandle.ts): singleton handle + `createArkWallet`/`openArkWallet` wrappers + lazy `uniffiInitAsync` (runs on first call, memoized).
  - [CreateArkScreen](src/screens/Account/CreateArkScreen/index.tsx): swapped `bip39.generateMnemonic()` for Bark's native `generateMnemonic()` — exercises the UniFFI bridge on seed-gen.
  - [ArkSeedPhraseScreen](src/screens/Account/ArkSeedPhraseScreen/index.tsx): swapped the `setTimeout(400)` mock for a real `Wallet.create(mnemonic, config, datadir, false)`. Errors surface via `SimpleToast` and abort the flow without marking the wallet as created.
  - `WalletInterface` (not `Wallet`) is the correct return type for `Wallet.create/open` — noted.
  - Smoke test PASSED — user created a wallet via the real flow, landed on home silently (no errors).
  - Still TODO in Phase 1:
    1. Hot-vault-seed reuse path — still calls `setTimeout(600)` then fake-creates. Needs (a) real hot-vault mnemonic read from `RNSecureKeyStore`, (b) real `createArkWallet(hotVaultMnemonic)` call, (c) warn modal before proceeding.
    2. Move `uniffiInitAsync()` out of lazy-first-call into App.js boot sequence — avoids a 100-500ms delay on the first wallet creation.
    3. Move `mnemonic` off `route.params` into a transient (non-persisted) zustand field `_pendingArkMnemonic`. Minor security hardening before shipping real funds.
- **2026-04-20** — ⏸ **PAUSED pending mainnet.** Flipped `FEATURE_ARK_ENABLED = false` in [config.ts](src/services/ark/config.ts) and gated every UI entry point + the boot restore hook on it:
  - [WalletsView](src/screens/HomeScreen/WalletsView/index.tsx) — `hasArk` ANDed with the flag so the carousel card hides even if zustand still has `'ARK'` in `allBTCWallets`.
  - [ReceivedListNew](src/screens/HomeScreen/ReceivedListNew/index.tsx) + [SendListNew](src/screens/HomeScreen/SendListNew/index.tsx) — Ark grid tile row wrapped in `{FEATURE_ARK_ENABLED && (...)}`.
  - [CheckingAccountLogin](src/screens/CheckingAccountLogin/index.tsx) — "Create Ark wallet" CTA gated.
  - [useArkRestoreOnBoot](src/custom-hooks/useArkRestoreOnBoot.ts) — short-circuits before any Keychain / datadir read; calls `clearArkAuth()` so stale zustand (from before the flag flipped) doesn't leak into the UI.
  - [useArkSync](src/custom-hooks/useArkSync.ts) — no change needed; already gates on `!isArkAuth`, which the boot hook now forces to false.
  - Rationale: signet-only server (`ark.signet.2nd.dev`) means every invoice is `lntbs...`, unpayable from Strike/CoinOS. Shipping the UI in its current state is dead-end for end users.
  - Resume trigger: Second.tech mainnet captaind launch. See "To resume" section at top of this file.
- **2026-04-20** — Phase 4 (Receive) — **DONE (for signet)**:
  - New service [src/services/ark/receive.ts](src/services/ark/receive.ts): `createArkLightningInvoice(sats)` → `wallet.bolt11Invoice(BigInt)`, `getArkAddress()` → `wallet.newAddress()`, `getArkOnchainAddress()` → lazy BDK `OnchainWallet.newAddress()`.
  - [walletHandle.ts](src/services/ark/walletHandle.ts): added lazy `ensureArkOnchainHandle()` — spawns the BDK-backed `OnchainWallet.default_(mnemonic, config, datadir)` on first call, reads the mnemonic from Keychain (may prompt biometric once), caches in module scope, flushed by `clearArkWalletHandle()`.
  - New screens: [ArkReceiveScreen](src/screens/Ark/ArkReceiveScreen/index.tsx) — three-option picker (Ark address / Lightning invoice / Bitcoin on-chain); [ArkInvoiceScreen](src/screens/Ark/ArkInvoiceScreen/index.tsx) — sats-only amount entry (USD-mode rejected with a toast, no trusted rate wired). Both registered in [Navigation.js:148-149](Navigation.js).
  - [ReceivedListNew:151](src/screens/HomeScreen/ReceivedListNew/index.tsx): Ark tile now routes to `ArkReceiveScreen` instead of the CoinOS/Strike `CreateInvoice`.
  - Signet smoke test: **PASSED** — user generated a 10-sat `lntbs...` invoice end-to-end. Confirmed unpayable from mainnet (Strike) — expected, and the reason for the pause.
- **2026-04-20** — Ark state drift reconciliation (fix for zustand/disk mismatch on reload):
  - New [src/services/ark/restore.ts](src/services/ark/restore.ts) — `restoreArkWalletFromDisk()` reads datadir + Keychain, calls `openArkWallet`, returns reason code on failure (`no-datadir` / `no-keychain` / `open-failed` / `already-open`).
  - New [useArkRestoreOnBoot](src/custom-hooks/useArkRestoreOnBoot.ts) — runs once per mount, reopens silently on success, flips `isArkAuth` and ensures `'ARK'` is in `allBTCWallets`; forces zustand to `false` when disk is empty; surfaces `needs-reset` when datadir is orphaned from Keychain.
  - New [src/services/ark/reset.ts](src/services/ark/reset.ts) — `resetArkWalletState()` deletes datadir + Keychain entry + clears the in-memory handle. Exposed as a `__DEV__`-only button on [CreateArkScreen](src/screens/Account/CreateArkScreen/index.tsx) when existing on-disk state is detected.
  - [CreateArkScreen](src/screens/Account/CreateArkScreen/index.tsx) — on mount, checks `hasArkDatadir()`; if present, renders an "Existing Ark Wallet" panel (Open / Reset) instead of the create form. Eliminates the "ghost wallet" case where zustand had been cleared but disk state remained.
  - [walletHandle.ts](src/services/ark/walletHandle.ts): `createArkWallet` now tries `Wallet.open` first and falls back to `Wallet.create` on failure — makes the create CTA idempotent when a datadir is already present.
- **2026-04-20** — Phase 3 (balance + VTXOs wiring, IN PROGRESS):
  - New services:
    - [src/services/ark/balance.ts](src/services/ark/balance.ts) — `fetchArkBalance()` wraps `wallet.balance()`; converts every bigint sat amount to plain `number` at the boundary and computes `totalSats` = spendable + all pending buckets.
    - [src/services/ark/vtxos.ts](src/services/ark/vtxos.ts) — `fetchArkVtxos()` wraps `wallet.allVtxos()`; returns `{ all, spendable }` view with numbers only.
    - [src/services/ark/chainTip.ts](src/services/ark/chainTip.ts) — `fetchChainTipHeight()` via esplora REST, plus `blocksToDays()` helper (10-min block assumption) — needed to turn VTXO `expiryHeight` into days-until-expiry for the depletion ring.
  - Zustand: added `arkBalanceDetail`, `arkVtxos`, `arkChainTipHeight`, `arkLastSyncedAt` + setters + `clearArkAuth` resets. `arkBalance` (plain total sats) is still there for existing UI.
  - New hook: [src/custom-hooks/useArkSync.ts](src/custom-hooks/useArkSync.ts) — installs immediate + 30s interval + AppState 'active' listener; runs balance/vtxo/tip fetches concurrently; in-flight-guarded so overlapping calls coalesce; errors surfaced via return value, never thrown.
  - Wired in [HomeScreen](src/screens/HomeScreen/index.tsx) — `const arkSync = useArkSync()` at the top; pull-to-refresh (`onRefresh`) now also calls `arkSync.refresh()`.
  - [ArkCapsules](src/screens/Strike/CheckingAccountNew/ArkCapsules.tsx): replaced `MOCK_VTXOS` with `useAuthStore(s => s.arkVtxos)`; computes days-left from `expiryHeight - chainTipHeight`; falls back to a neutral ring + kind label when expiry is unknown (arkoor VTXOs / esplora offline).
  - Verified no new TS errors (baseline 18 errors in pre-existing code, current 18 errors — zero delta from Phase 3).
  - Phase 3 pickup for next agent:
    1. `wallet.movements()` — tx history list. Goal: render in an Ark-specific tab on `CheckingAccountNew`, following the Strike/CoinOS movements layout. Empty state covered — a fresh wallet returns `[]`.
    2. `ArkWallet` card [src/components/ArkWallet/index.tsx](src/components/ArkWallet/index.tsx) already reads `arkBalance` from the store — should "just work" once a signet deposit lands. Verify on-device before marking Phase 3 DONE.
    3. Optional: add `wallet.notifications()` stream subscription to push updates into the store instead of waiting for the 30s poll. Deferred to Phase 8.
- **2026-04-25** — SDK bump + critical walletHandle fix:
  - `@secondts/bark-react-native` bumped from `0.3.3` → `0.4.1` (patch — no breaking API changes observed).
  - **Fix**: `clearArkWalletHandle()` in [walletHandle.ts](src/services/ark/walletHandle.ts) now calls `handle.uniffiDestroy()` before nulling. Without this the Rust `Wallet` drop impl never runs, SQLite file descriptors stay open, and any subsequent `Wallet.open` / `Wallet.create` on the same datadir throws `BarkError.Database`. This was the root cause of the crash on Reset and on the Recovery screen.
- **2026-04-25** — Phase 3 DONE — tx history wired:
  - New service [src/services/ark/history.ts](src/services/ark/history.ts) — `fetchArkHistory()` wraps `wallet.movements()`, strips bigints → numbers at the boundary, classifies each movement into `ArkMovementKind` (`board` / `refresh` / `send` / `receive` / `exit` / `unknown`), derives a human-readable `label` + `statusLabel`.
  - New [src/services/ark/sync.ts](src/services/ark/sync.ts) — `syncArkWallet()` thin wrapper around `wallet.sync()` so callers don't need to grab the handle directly.
  - New [src/screens/Strike/CheckingAccountNew/ArkHistory.tsx](src/screens/Strike/CheckingAccountNew/ArkHistory.tsx) — Ark-specific history tab (replaces the Strike/CoinOS remote-paginated `History` component for `accountType === 'ark'`). Reads `wallet.movements()` on mount + pull-to-refresh; renders amount, date, kind badge. Empty state handled.
  - [CheckingAccountNew/index.tsx](src/screens/Strike/CheckingAccountNew/index.tsx): accepts new `accountType` route param; forks tab 1 (Capsules vs Threshold) and tab 2 (ArkHistory vs History) based on `isArk`. Screen title flips to "Ark Vault" for Ark.
  - [CheckingAccountNew/Account.tsx](src/screens/Strike/CheckingAccountNew/Account.tsx): accepts `isArk` prop; renders Ark-branded card + "Disconnect Second" CTA instead of the custodial Strike layout.
- **2026-04-25** — Phase 2A — encrypted datadir backup service:
  - New [src/services/ark/backup.ts](src/services/ark/backup.ts) — full encrypted backup pipeline:
    - `buildArkBackupBlob(mnemonic)` — recursively enumerates datadir files, reads each as base64, packs into a `BackupManifest`, encrypts with AES-256-CBC + PBKDF2-SHA256 (100k iter, app-fixed salt), wraps in a versioned JSON envelope. Returns the blob string.
    - `restoreArkBackupBlob(blob, mnemonic)` — decrypts + validates envelope, path-traversal-guards every entry, nukes + recreates the datadir, writes files, calls `openArkWallet`.
    - `writeArkBackupToTempFile(mnemonic)` — convenience: runs `buildArkBackupBlob` and writes to `CachesDirectory/cypher-box-ark-backup-<timestamp>.cbark` for sharing via `react-native-share`.
  - File extension `.cbark` — opaque to the OS, not auto-opened as JSON.
  - **Known limitation**: raw datadir snapshot has a hard dependency on Bark's internal storage format. Any schema change by Second.tech silently breaks existing backups. Draft message to Second.tech requesting a stable `Wallet.export()` / `Wallet.import()` API was prepared for sending.
  - `arkLastBackupAt` field + `setArkLastBackupAt` setter added to [authStore.ts](src/stores/authStore.ts) and cleared in `clearArkAuth`. Drives recoverability badges in `ArkCapsules`.
  - **TODO**: wire `buildArkBackupBlob` + `writeArkBackupToTempFile` into a UI action (backup button on the Capsules tab or Settings). Auto-backup-on-VTXO-change deferred.
- **2026-04-25** — Recovery screen + seed-only limitation confirmed:
  - New [src/services/ark/recover.ts](src/services/ark/recover.ts) — `recoverArkWalletFromKeychain()`: reads seed from Keychain, deletes existing datadir, calls `Wallet.create(mnemonic, config, datadir, forceRescan: true)`, opens the wallet. Returns `ArkRecoveryResult` with `ok` / `reason` / `cause`.
  - New [src/screens/Account/RecoverArkScreen/index.tsx](src/screens/Account/RecoverArkScreen/index.tsx) — UI entry for recovery (seed input + Keychain path). Registered in [Navigation.js](Navigation.js).
  - **Confirmed by user testing**: `forceRescan: true` does NOT recover VTXOs. The Bark ASP has no "list my VTXOs by pubkey" endpoint — VTXO commitments, presigned exit txs, and round data only exist in the local SQLite datadir. Seed-alone recovery produces an empty wallet. This is why Phase 2A backup is mandatory.
  - Seed-based recovery flow is still available as a "last resort" (recovers on-chain BDK UTXOs only, loses Ark VTXOs).
- **2026-04-25** — VTXO card UX improvements (ArkCapsules):
  - Status label shown inline next to expiry time, separated by ` — `.
  - Pre-backup state now labeled **"Irrecoverable yet"** (not "Refreshing") to make the risk legible without a backup.
  - Recoverable/irrecoverable state derived from `arkLastBackupAt` vs VTXO first-seen time; if no backup exists all cards show irrecoverable.
- **2026-04-25** — Phase 5 (Send) — service + screen scaffolded:
  - New [src/services/ark/send.ts](src/services/ark/send.ts):
    - `classifyArkDestination(dest)` — tries Ark address → Lightning invoice → Lightning offer → BOLT12 offer; returns `ArkDestinationKind` + parsed value.
    - `estimateArkSendFee(dest, amountSats)` — calls `wallet.estimateSend*` variants based on destination kind, returns `ArkSendFeeView` with feeSats + total.
    - `executeArkSend(dest, amountSats)` — dispatches `wallet.send*` variants, returns `ArkSendResult` with txid / preimage.
  - New [src/services/ark/refresh.ts](src/services/ark/refresh.ts):
    - `estimateArkRefreshFee()` — calls `wallet.estimateMaintenanceFee()`.
    - `refreshArkVtxos()` — calls `wallet.maintenance()` (moves expiring VTXOs into a new round to reset their clock).
    - `refreshArkVtxosAndSync()` — refresh + balance/vtxo re-fetch in one call.
  - New [src/services/ark/lightning.ts](src/services/ark/lightning.ts):
    - `tryClaimArkLightningReceives()` — lists pending Lightning receives, claims any that have a revealed preimage, returns `ArkLightningReceiveView[]` for toast/logging.
  - New [src/screens/Ark/ArkSendScreen](src/screens/Ark/ArkSendScreen/) — amount + destination entry, fee preview, confirm/send. Registered in [Navigation.js](Navigation.js).
  - New [src/screens/Ark/ArkTransactionDetailsScreen](src/screens/Ark/ArkTransactionDetailsScreen/) — movement detail view navigated from ArkHistory. Registered in [Navigation.js](Navigation.js).
  - **TODO for Phase 5**: end-to-end signet send test (Ark → Ark address, Ark → Lightning invoice). Fee estimation flow needs a real signet wallet with balance to validate amounts.
- **2026-04-26** — Frontend wiring: Ark surfaced throughout the app shell.
  Companion to commits `9676f59` / `9295673`, which landed the service layer + screens; this batch wires those into Home, login, onboarding, and the shared component library so Ark is a first-class wallet alongside Strike/CoinOS.
  - **Yellow theme system** — new `colors.ark` palette in [src/style-guide/colors.ts](src/style-guide/colors.ts) (12 tokens) gives Ark its own visual identity, distinct from the pink Strike/CoinOS palette.
  - **Component theming**:
    - [Card](src/components/Card/index.tsx) — `wallet === 'ARK'` renders a yellow border + "Second" text wordmark (no logo asset yet) + yellow threshold-met glow + yellow gradient bar.
    - [GradientText](src/components/GradientText/index.tsx) — new `colors_` prop lets callers override the default pink gradient (used for Ark-themed surfaces).
    - [Tabs](src/components/Tabs/index.tsx) — `accountType='ark'` swaps "Threshold" → "Capsules" and switches the active-tab gradient to yellow.
    - [LoginOption](src/components/CheckingAccount/LoginOption.tsx) — `logo` prop is now optional + new `borderColor` prop, so the Ark login tile can render a yellow-bordered Second logo without forcing a LinearGradient.
    - [GradientButtonWithShadow](src/components/GradientButtonWithShadow/index.tsx) — fixed an iOS-only white halo bug where `shadow25`'s white background was bleeding ~1–2px past the LinearGradient child's rounded corners (most visible on the Ark dark canvas, but present on every tile).
  - **Carousel + home** ([WalletsView](src/screens/HomeScreen/WalletsView/index.tsx), [HomeScreen](src/screens/HomeScreen/index.tsx), [BalanceView](src/screens/HomeScreen/BalanceView/index.tsx)):
    - Carousel composition rewritten: custodial Lightning providers (Strike/CoinOS) collapse into a single `CircularView` page when both are present; ARK is structurally separate (different SDK, different balance) and ALWAYS gets its own carousel page — never collapsed into `CircularView` (which has no Ark support).
    - Fixed a long-standing `firstItem` mismatch where the carousel mounted on index 0 but state claimed index 1 — caused the page indicator to point at the wrong slot on first login. Aligned default state to the carousel's actual first-mount slide.
    - `onPageChange` callback added to feed `BalanceView`'s new page-indicator dots (only visible when >1 wallet page).
    - `useArkRestoreOnBoot` + `useArkSync` wired in at the top of `HomeScreen` — boot reopens the wallet from datadir + Keychain; 30s sync keeps balance / vtxos / chain-tip fresh. Both barrel-exported from [src/custom-hooks/index.ts](src/custom-hooks/index.ts).
    - Pull-to-refresh (`onRefresh`) now also kicks `arkSync.refresh()` for an immediate, in-flight-guarded sync.
    - **Bug fix**: `handleUser()` was calling CoinOS `getMe()` for Ark-only users (no CoinOS auth) and tripping the catch block → "Failed to load balance" toast on every refresh. Gated the CoinOS-specific work behind `isAuth && token`; the BlueWallet fiat-rate fallback still runs for everyone (vault USD conversion + Ark card depend on it). Toast also gated so Ark-only users never see a misleading CoinOS error.
    - Multiple `translateY` adjustments in HomeScreen layout to compensate for the page-indicator height (~17pt) and the Ark-only carousel centroid shift in `react-native-snap-carousel`.
  - **Send/Receive grid tiles** ([ReceivedListNew](src/screens/HomeScreen/ReceivedListNew/index.tsx), [SendListNew](src/screens/HomeScreen/SendListNew/index.tsx)):
    - Ark grid tile (id=5) added behind `FEATURE_ARK_ENABLED`, routes to `ArkReceiveScreen` / `ArkSendScreen` (which own their own destination classification + fee preview, since the Strike `SendScreen` is hard-wired to custodial Lightning APIs).
    - `renderGridTile` now accepts a `textLabel` param so logo-less providers (Ark) can render an inline yellow "Second" wordmark in the icon slot. `width` is also configurable so Ark can sit below the 2×2 grid in its own row without affecting alignment.
    - Receive screen routes to `ArkReceiveScreen` rather than the CoinOS/Strike `CreateInvoice` because Ark has three receive options (Ark address / Lightning invoice / on-chain board address) that don't map cleanly to the existing two-option picker.
  - **Login flow** ([CheckingAccountLogin](src/screens/CheckingAccountLogin/index.tsx)):
    - Added Ark CTA (Second logo + yellow border), "Recover Ark seed" deep-link to `RecoverArkScreen`, "Learn more" → second.tech.
    - Surfaced the recover path as a sibling to the Create CTA so users with a written-down seed never have to dig into Settings on a fresh install — mirrors the hot-vault "Already have a hot vault? Recover" flow.
    - All gated behind `FEATURE_ARK_ENABLED`.
  - **Account-created flow** ([CheckingAccountCreated](src/screens/CheckingAccountCreated/index.tsx)):
    - Branched on `accountType === 'ark'`: yellow accent color, "Ark Vault Created!" title, Ark-specific explainer text + experimental seed-recovery warning, `withdrawArkThreshold` wiring (defaults to 500k sats, persisted to zustand alongside the existing Strike + Lightning thresholds).
  - **iOS build fix** ([ios/Podfile](ios/Podfile)):
    - Added `HEADER_SEARCH_PATHS` for the `BarkReactNative` pod pointing at `${PODS_TARGET_SRCROOT}/ios/generated/build/generated/ios`. The SDK's Fabric codegen output (`ShadowNodes.cpp` / `States.cpp`) includes its sibling headers via angle-bracket paths like `<react/renderer/components/RNBarkReactNativeSpec/ShadowNodes.h>`, but CocoaPods flattens public headers into `Pods/Headers/Public/BarkReactNative/`, losing the `react/renderer/...` prefix. The SDK's podspec doesn't add the generated root on the modern `install_modules_dependencies` path (RN ≥ 0.71). This works around it for now; an upstream fix would be cleaner — worth flagging to Second.tech alongside the `Wallet.export()` request.

---

- **2026-04-30** — Android perf pass (Galaxy A14, RN 0.76 / New Arch debug build):
  - **Got CB-Ark running on Android for the first time on Galaxy A14.** Two pre-existing issues blocked launch entirely:
    - `network_security_config.xml` enumerated all 65,536 IPs in `192.168.0.0/16` individually (Android's network-security-config doesn't support CIDR), causing a `bindApplication` ANR on slow phones during XML parse. Trimmed to `192.168.0.0/24` + `192.168.1.0/24` (the two common home subnets) + named entries (10.0.2.2, localhost, onion, tailscale.net, ts.net) — 522 lines instead of 65,546. Drops cleartext support for unusual subnets like `192.168.50.x`; document this if a user reports it.
    - RN 0.76 Bridgeless mode tripped a Hermes "Could not enqueue microtask because they are disabled in this runtime" exception inside `setImmediate`, which then caused `RealmReactModule.invalidateCaches()` JNI symbol miss during teardown → fatal `UnsatisfiedLinkError`. Fix in [MainApplication.java](android/app/src/main/java/io/bluewallet/bluewallet/MainApplication.java): `getReactHost()` returns `null` and `DefaultNewArchitectureEntryPoint.load(true, true, false)` to disable Bridgeless while keeping Fabric + TurboModules. Net: full New Arch on Android, minus the experimental Bridgeless reactor. Revisit when bark-react-native + the broader native module ecosystem catches up to Bridgeless.
  - **`useArkSync` auto-backup throttle** ([src/custom-hooks/useArkSync.ts](src/custom-hooks/useArkSync.ts)): `writeArkAutoBackup` was running on every 60s sync cycle even when nothing had changed, costing several seconds of JS-thread block per cycle on Galaxy A14. Added a `lastBackupSignature` ref keyed on `(balance.totalSats, vtxos.all.length, vtxos.spendable.length, tip)`; when the new tick's signature matches the previous backup, the backup is skipped with a `[Ark auto-backup] skipped — state unchanged` log. Idle wallet now only writes the backup once per session instead of every cycle.
  - **CryptoJS → react-native-aes-crypto** ([src/services/ark/backup.ts](src/services/ark/backup.ts), `package.json`): `CryptoJS.AES.encrypt` / `decrypt` / `PBKDF2` are pure-JS and ran synchronously on the JS thread; on Galaxy A14 a 348 KB plaintext encrypt held the thread for ~5+ seconds per call. Swapped to `react-native-aes-crypto`, which dispatches to native (BouncyCastle on Android, CommonCrypto on iOS) off the JS thread. PBKDF2-SHA256 with the same params produces byte-identical output, and AES-CBC with the same key/IV/plaintext is deterministic, so existing CryptoJS-encrypted `.cbark` files round-trip transparently — backups taken before this change still decrypt with the new code path. `decryptBackupBlob` is now `async`; only call site is `restoreArkBackupBlob` which was already async. `crypto-js` left in `package.json` as a safety net; can be removed once we've shipped a build of the new path.
  - **Render-loop `console.log` cleanup**:
    - [src/components/Card/index.tsx](src/components/Card/index.tsx): removed unguarded `console.log('allBTCWallets: ', ...)` from the function body — fired on every render, polluted dev logs.
    - [src/screens/Account/LoginCoinOSScreen/index.tsx](src/screens/Account/LoginCoinOSScreen/index.tsx): captcha-token log was unguarded and emitted the full ~3.5 KB hCaptcha token to the bridge on every render. Replaced with a `__DEV__`-guarded `!!token, len:` summary so we can still debug "did the captcha resolve?" without the bridge spam.
  - **Repo-level guardrails**: new top-level [CLAUDE.md](CLAUDE.md) documents the per-branch native toolchain (`main` = Gradle 7.6 + RN 0.72, `CB-Ark` = Gradle 8.10.2 + RN 0.76), the Android build hygiene checklist (arm64-only debug, codegen-first on cold builds), the Galaxy A14 freeze gotchas, and a "do not delete" list for future LLMs working in this repo.
  - **Remaining freeze on Android** is `[ArkSync] fetchBalance/Vtxos/Tip` — the bark-react-native UniFFI bindings call into Rust synchronously on the JS thread, costing 2–9s per cycle on Galaxy A14. Documented in the existing comment block at the top of [useArkSync.ts](src/custom-hooks/useArkSync.ts). Fix needs to come from upstream (Second.tech) — either async UniFFI bindings or a worker-thread wrapper. Add to the next message to Second.tech alongside the `Wallet.export()` / `Wallet.import()` ask and the iOS Podfile header-search-paths quirk.

---

## May 2026 — Phase 5 → 9 push

This block consolidates the ~95 commits between 2026-04-30 and 2026-05-19. The branch went from "Phase 5/6 partial, 7/8 not started" to "Phase 7/8 done, Phase 9 in progress." Listed roughly oldest → newest; commit hashes inline where the diff is the source of truth.

- **2026-05-04…05-12 — Phase 7 Emergency Exit shipped** (`860e134 feat(ark): Emergency Exit, backup rename, refresh ETA, UX polish`, `8956368 feat(ark): backfill exit destination from Hot Vault reserved slot`, `01c348e chore(ark): log VTXO expiryHeight and chain tip for triage`):
  - New [src/services/ark/exit.ts](src/services/ark/exit.ts) — wraps `wallet.startExit()` / `wallet.claimableExits()` / claim flow. Destructive-action modal in the Vault tab triggers it.
  - Exit destination is auto-populated from the Hot Vault reserved-slot address ([src/services/arkExitDestination.ts](src/services/arkExitDestination.ts)) so the user never types a fallback address into a panic UI.
  - Triage logging: VTXO `expiryHeight` + current chain tip logged on every sync so post-mortem of "why didn't this refresh in time" is tractable from a captured log.

- **2026-05-05…05-10 — Multi-channel backup completed** (`b358020 feat(ark+integrations): Drive backup, lightning swap registry, send/receive flows`, `06a1fa3 feat(ark/android): user-chosen folder backup channel via SAF`, `bd7be37 fix(ark): hard-fail wallet create when Drive backup can't be verified`, `b644237 feat(ark): iOS Files-app gate, snapshot reminder, iCloud Drive sync`, `8c5c090 fix(ark/ios): restore per-wallet iCloud backup writes + recovery scan`):
  - iOS: iCloud Drive sync writes the `.cbark` to the app's iCloud container; Files-app gate verifies the file is readable before the wallet is considered "backed up." Per-wallet snapshot reminder surfaces on the Ark carousel slot until the user acknowledges or rotates the backup.
  - Android: SAF picker lets the user nominate a folder (Google Drive, Dropbox, on-device) and the app writes the `.cbark` there directly. Google Drive ([src/services/ark/googleDrive.ts](src/services/ark/googleDrive.ts)) added as a first-class channel. Restore tries the SAF folder before falling back to the file picker.
  - **Hard guarantee**: wallet creation now fails closed if the chosen backup channel can't verify the written blob round-trips. Prevents the "I created a wallet and the backup silently went nowhere" footgun.

- **2026-05-08 — Multi-wallet backup** (`408d7b5 feat(ark): multi-wallet backup support with seed-fingerprint-keyed files`, `851b6ff Merge multi-wallet Ark backup feature into CB-Ark`):
  - Backup filenames now include a seed fingerprint ([src/services/ark/backupFingerprint.ts](src/services/ark/backupFingerprint.ts)), so two devices using the same iCloud account / Drive folder don't overwrite each other's `.cbark`. Restore picks the right file by fingerprint via [src/services/ark/findBackup.ts](src/services/ark/findBackup.ts).

- **2026-05-08…05-15 — Phase 8 Background Refresh shipped** (`4fa1219 feat(ark): background VTXO refresh — scheduler, native wake, notifications, relay opt-in`, `ee6f24f fix(ark/android): switch bg refresh to AlarmManager, drop WorkManager scheduler`, `a1f61fe docs(ark): document Android bg-refresh architecture and rationale`, `ef17a42 Merge pull request #91 from CypherBoxLLC/ark-bg-refresh`, `05da4a3 feat(ark/android): bg-refresh polish — boot rearm + battery onboarding`):
  - New [src/services/ark/backgroundRefresh.ts](src/services/ark/backgroundRefresh.ts), [src/services/ark/scheduler.ts](src/services/ark/scheduler.ts), [src/services/ark/backgroundNotifications.ts](src/services/ark/backgroundNotifications.ts), [src/services/ark/backgroundTelemetry.ts](src/services/ark/backgroundTelemetry.ts), [src/services/ark/movementWatcher.ts](src/services/ark/movementWatcher.ts), [src/services/ark/batteryGuidance.ts](src/services/ark/batteryGuidance.ts), [src/services/ark/cancellingState.ts](src/services/ark/cancellingState.ts).
  - **Wake path**: opt-in silent push from the relay (`wss://notifications.cypherbox.io:3003`) wakes the app when soonest VTXO crosses the 48h-to-expiry threshold; iOS `BGAppRefreshTask` + Android `AlarmManager` are the safety nets.
  - **Android AlarmManager swap**: WorkManager was deferring wakes past expiry on Galaxy A14 with battery-optimised default. Replaced with `AlarmManager.setExactAndAllowWhileIdle` + boot-rearm broadcast receiver. Architecture rationale captured in [docs/](docs/) per `a1f61fe`.
  - **Battery onboarding** (`05da4a3`, `2d3b170`, `4d9e722`, `ec66d68`, `0462792`): one-screen-per-vendor walkthrough (Samsung, Xiaomi, OnePlus, stock Android) for unblocking battery optimisation. Auto-refresh stays primary; manual still works if the user declines.
  - **LN-receive auto-refresh** (`0ebad5f`): a received Lightning payment triggers an immediate refresh + dust consolidation so the new VTXO doesn't fragment the wallet.

- **2026-05-12…05-19 — Capsules tab UX rewrite** (many commits, see `f241cb7 feat(ark): "?" help icon → ArkCapsulesInfoScreen`, `463121f ux(ark): rewrite capsule explainer in plain language with real fee numbers`, `4c27ae4 ux(ark): rename Capsules→V-capsules with lightning icon; Vault gets boat icon`, `3548352 ux(ark): move Auto-refresh + Emergency Exit + Delete Vault to the Vault tab`, `18ae8e0 feat(ark): coloured capsule slots inside the Ark Card`, `9cf69b9 feat(ark): per-row spinning refresh icon flips to cancel-X mid-refresh`, `eef5928 fix(ark): cancel triggers an immediate sync so row stops pulsing; new label`, `ea62244 fix(ark): cancel retries on lock-timeout; UI stays "Cancelling" until round settles`):
  - Two-tab restructure: **V-capsules** (lightning icon) for the capsule list, **Vault** (boat icon) for settings + Emergency Exit + Delete Vault. Auto-refresh toggle moved to Vault; V-capsules shows read-only status.
  - In-card UX: five reserved slot positions (empty ones invisible spacers), height matched to Hot Vault's visible band, coloured per VTXO, no threshold bar.
  - Per-row refresh affordance: spinning icon → cancel-X mid-flight → "Cancelling" intermediate label → settles to refreshed or restored on round resolution. `BarkError` inner detail surfaced when cancelPendingRound fails (`0c10148`). Watcher only triggers on receive subsystem to avoid cancel→re-refresh loop (`ffbab52`).
  - In-context recovery: stale-datadir detection surfaces a production-visible reset path (`0591601 feat(ark/create): production-visible reset + in-context recovery from stale datadir`) — no more dev-only escape hatch.
  - Latest fix (`caa09a7`): expired VTXOs excluded from refresh sweep, their row UI locked down (no spinning icon, no cancel-X, recoverability stripped).

- **2026-05-13…05-15 — Activity log + cross-wallet visibility** (`768d41e feat(activity): in-app cross-wallet event log with privacy-strict emit sites`, `c347a7e ui(home): iterative layout tuning, Activity dropdown, Ark seed-reveal cleanup`):
  - New in-app event log surfaces refresh attempts, exits, swap events, etc. across all wallets in one stream. Privacy-strict emit sites — no amounts in log lines, only kind + outcome + duration.
  - Home-screen Activity dropdown lets the user open the log without leaving the carousel.

- **2026-05-14…05-18 — UI infra catch-up** (`a6d8f5a chore(deps): upgrade react-native-mmkv 2.12.2 → 3.3.3 + add react-native-nitro-modules`, `1ce73d8 fix(ui): swap react-native-snap-carousel for FlatList — Fabric compat`, `01680ac fix(text-wrapper): adjustsFontSizeToFit now opt-in (default false) under Fabric`):
  - `react-native-mmkv` v3 + `react-native-nitro-modules` brings async storage off the JS thread for the high-frequency keys (auth state, Ark sync metadata). Pairs with the bg-refresh work where main-thread budget is precious.
  - `react-native-snap-carousel` removed in favour of FlatList — the former is unmaintained and triggers a layout warning storm under Fabric. Page-indicator dots reimplemented against FlatList's `viewabilityConfigCallbackPairs`.

- **2026-05-15 — Security hygiene** (`5c86909 fix(security): move RELAY_API_KEY out of source into gitignored secrets file`):
  - The relay-push API key was hard-coded in source. Pulled into a gitignored `.env`-style file with a documented fallback for local dev. CI build pipeline reads from the project's secrets store. **History was not rewritten** — the leaked key has been rotated by the relay team and the old one revoked.

- **2026-05-15 — Help / docs** (`4744ee3 docs(ark): rewrite Fees section to match Second.tech's actual schedule`, `97b7dd2 ux(ark): plain-language alert copy + adopt 'VTXO capsule' user-facing term`, `8e5bc43 docs(ark): platform-correct keychain copy in seed-phrase onboarding`):
  - User-facing terminology unified on "VTXO capsule." Fees section in [ark-integration.md](ark-integration.md) rewritten against Second.tech's public schedule (not the assumed numbers from the v0.4 spike). Keychain copy now distinguishes iOS Secure Enclave vs Android EncryptedSharedPreferences-with-StrongBox.

- **2026-05-15…05-19 — Fiat-rate plumbing audit** (`b4b91bf`, `52aafef`, `cbb4022`, `a248c9b`, `a4b9169`):
  - After a unit-flip in the BlueWallet rate source (sats-per-rate vs btc-per-rate), every site that multiplied sats × rate needed a `btc(1)` factor re-applied. Caught five sites across Ark balance, send screen, CoinOS, Strike swap preview. Single source of truth: BlueWallet's `getFiatRate` daemon fall-through, with CoinOS rate-box reading the BlueWallet value.

- **2026-05-30 — Dev toolkit: bark CLI** — Added host-side `bark` CLI (pinned to `bark-0.1.3`, the Rust crate version embedded in `@secondts/bark-react-native@0.4.1`) plus wrappers under [scripts/bark/](scripts/bark) (`decode.sh`, `vtxos.sh`, `round-status.sh`, `restore.sh`). Gives us an independent ground-truth path into VTXO / round / datadir state when the JS SDK's reported `kind` enum disagrees with the docstrings. Dev-only — not bundled, not in `package.json`. See `CLAUDE.md → "Bark CLI for Ark debugging"` for install + recipes. Phase 9 status unchanged — this is tooling, not user-facing hardening.

---

## Open items / next session pickup

_(refreshed 2026-05-27. Was 7 items; 4 of those landed in the May push — keep this list short and accurate.)_

1. **Hot-vault seed reuse** (still Phase 1 TODO from 2026-04-20) — `useHotVaultSeed` toggle on [CreateArkScreen](src/screens/Account/CreateArkScreen/index.tsx) sets a flag but never reads the hot-vault mnemonic. Wire: keychain read → `createArkWallet(hotVaultMnemonic)` → warn modal explaining shared-seed leak risk.
2. **End-to-end mainnet send test, captured** — sends have been exercised implicitly through the LN-receive + auto-refresh + dust-consolidation flows, but no recorded Ark→Ark and Ark→Lightning end-to-end. Worth doing once on mainnet with a small amount + a captured log so any future regression is bisectable. Service layer is stable; this is verification, not implementation.
3. **Backup/restore CI** — Phase 9 hardening gap. A pinned mainnet `.cbark` (small-amount test wallet) from each SDK minor should round-trip through `restoreArkBackupBlob` in CI on every PR. Catches schema drift from a Bark bump before users do. Fixture wallet should be funded with the minimum that exercises real round participation.
4. **Bark CLI–driven backup/restore round-trip tests in CI** — Phase 9 hardening, sibling to #3 but independent. Same fixture `.cbark`, but the round-trip runs through the host-side `bark` CLI ([scripts/bark/restore.sh](scripts/bark/restore.sh) → `bark vtxos --all` → expected snapshot diff) instead of the RN code path. Catches drift between the SDK (FFI binding) and the CLI (same Rust core, independent build) — when they disagree we want CI to flag it, not a user. Requires: CI Linux runner with the pinned-version `bark` binary preinstalled, the fixture seed in CI secrets, and an "expected" VTXO-snapshot JSON checked in that we regenerate intentionally on SDK bumps. Wiring is separate work; this item only tracks the task.
5. **Drop `crypto-js`** — superseded by `react-native-aes-crypto` since 2026-04-30. Left in `package.json` as a safety net pending an end-to-end build validation. Validation has now happened across iOS + Android in the May push — safe to remove.
6. **Tighten auto-backup signature** — `tip` is still in the signature; it flaps on parallel-cycle esplora calls and triggers spurious backups. Either de-dupe parallel cycles via the (currently racy) `inFlight` guard or drop `tip` from the signature.
7. **Second.tech upstream asks** — single message covering:
   - Stable `Wallet.export()` / `Wallet.import()` API so backups stop depending on internal SQLite schema.
   - Async UniFFI bindings (or worker-thread wrapper) for `wallet.sync()` / `wallet.balance()` / `wallet.allVtxos()`. Still the biggest UX cost on Galaxy A14 — 2–9s JS-thread block per sync cycle.
   - iOS Podfile `HEADER_SEARCH_PATHS` quirk for the codegen output ([ios/Podfile](ios/Podfile)). Worth documenting upstream.
   - Recovery-mailbox client API timeline (since 0.1.0 the ASP posts received VTXOs to a mailbox; client code to drain it would demote `.cbark` from mandatory to belt-and-suspenders).
8. **Production rollout readiness** — Ark is mainnet-on by default (see status banner). Outstanding pre-GA work is operational rather than a config flip:
   - Items 3 (backup CI) and 5 (drop crypto-js) should land before broad release.
   - Documented incident response: what happens if `ark.second.tech` goes down? Today the UI shows a stale balance and refresh retries — surface this state explicitly.
   - In-app surfacing of the "back up your seed AND your VTXO state" warning for non-tester users (called out in the [config.ts](src/services/ark/config.ts) preamble — still relies on Phase 2 backup flows actually being completed by the user).
