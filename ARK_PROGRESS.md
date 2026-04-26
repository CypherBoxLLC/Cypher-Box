# Ark / Bark SDK Integration — Progress Tracker

**Branch:** `rn-upgrade` (preserved snapshot: `Bam-RN` on origin)
**SDK:** `@secondts/bark-react-native@0.4.1` (Second.tech, UniFFI Rust-core binding)
**Plan source:** `/Users/kaliko/Documents/Ark implementaion.rtf` + plan in assistant-generated integration doc

This file is the single source of truth for Ark integration state. Update it after every meaningful change so any other agent can pick up where the last left off.

---

## ▶ STATUS: RESUMED — DEV BUILDS ONLY (2026-04-25)

**Re-enabled for iteration. Production builds remain gated.**

[config.ts](src/services/ark/config.ts) now sets `FEATURE_ARK_ENABLED = __DEV__`, so Metro / debug builds show the full Ark surface (home tile, login CTA, send/receive sheets, boot restore hook, 30s sync) while release / TestFlight / App Store builds ship with Ark entirely hidden. This lets us keep building out Phase 5+ against `ark.signet.2nd.dev` without any risk of signet UI leaking into a production channel.

### What's unblocked
- Dev-loop iteration on Send / fees / emergency exit / notifications against signet.
- Re-testing create → restore → receive on the current signet server to confirm nothing rotted during the pause.
- Encrypted backup/restore work (Phase 2) — still mandatory before a production flip.

### Still blocked (on Second.tech)
- Mainnet captaind at `ark.mainnet.2nd.dev` is not live yet. Any TestFlight build that pays with a real wallet remains impossible until then.
- Watch [Second blog](https://blog.second.tech/) and [changelog](https://second.tech/docs/changelog) for the mainnet launch. Latest pre-mainnet signal was v0.1.0 dropping the "beta" tag on 2026-04-04.

### Good news from Bark devs (2026-04-25)
- **Backwards compat**: Bark maintains SQLite migration files and CI tests since 0.1.0-beta7/8. Our raw .cbark datadir backups are safer than we assumed — a Bark version bump won't silently break them.
- **Recovery mailbox**: Since 0.1.0, received VTXOs are posted to an ASP-hosted mailbox. Client-side recovery not yet implemented, but the infrastructure is live. Seed-only recovery is coming; .cbark backup is still mandatory for now but will eventually become belt-and-suspenders.

### To flip to production
1. Confirm `ark.mainnet.2nd.dev` resolves and responds (last checked DNS `000`).
2. Flip `FEATURE_ARK_ENABLED = true` (unconditional, not `__DEV__`) in [config.ts](src/services/ark/config.ts).
3. Revisit `ARK_NETWORK` / `ARK_SERVER_URL` / `ESPLORA_URL` — pick a rollout strategy (always mainnet vs. keep signet for dev builds).
4. Phase 2 encrypted backup/restore MUST be green before this step; seed alone cannot recover balance on Bark.

### What stayed while paused
- **Code** — all services, hooks, screens kept intact. No scaffolding was deleted.
- **Native SDK** — `@secondts/bark-react-native@0.3.3` pods / jniLibs still linked; no build churn.
- **On-disk state on dev installs** — datadir + Keychain mnemonic from previous signet wallets are **not** scrubbed when the flag flips. Boot restore will try to reopen them; if they fail (network mismatch, corrupt state) CreateArkScreen surfaces the Reset escape hatch. Fresh install still works if you want a clean slate.

---

## Status at-a-glance

| Phase | Status | Notes |
|-------|--------|-------|
| 0. Foundations | **DONE** | SDK installed, pods linked, Android prechecks pass, config + datadir services scaffolded |
| 1. Seed create + keychain | **DONE (for signet)** | Real `Wallet.create` + `Wallet.open` wired; Keychain persistence + boot-time auto-restore + dev-only Reset escape hatch. Hot-vault reuse + lazy uniffi + transient mnemonic are `__DEV__` leftovers, fine for signet. |
| 2. Encrypted backup/restore | **PARTIAL (Phase 2A done)** | Manual encrypted `.cbark` export service done (`backup.ts`). Auto-backup and iCloud sync deferred. Seed-alone recovery confirmed NOT possible — datadir backup is mandatory. |
| 3. Balance + VTXOs + History | **DONE** | `wallet.balance()` + `wallet.allVtxos()` + 30s sync + chain tip + `wallet.movements()` all wired. ArkCapsules + ArkHistory tabs live. |
| 4. Receive | **DONE (for signet)** | Ark address / bolt11 / on-chain board address — three-option `ArkReceiveScreen` + sats-only `ArkInvoiceScreen`. Lazy `OnchainWallet` spawn alongside the Ark wallet. |
| 5. Send | **PARTIAL** | Service (`send.ts`) + `ArkSendScreen` scaffolded. Destination classification + fee estimation + execute wired in service layer. UI fee-confirm flow needs end-to-end signet test. |
| 6. Fees | **PARTIAL** | `estimateArkSendFee()` + `estimateArkRefreshFee()` done in service layer. Not yet exposed in a standalone fee UI. |
| 7. Emergency exit | NOT STARTED | SDK has the machinery, expose UI |
| 8. Notifications | NOT STARTED | Local + background sync; stream via `Wallet.notifications()` |
| 9. Hardening | PARTIAL | Feature-flag kill-switch landed. Auto-backup, backup/restore CI, signet→mainnet rollout still pending. |

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

## Open items / next session pickup

1. **Wire the backup UI** — `writeArkBackupToTempFile` + `react-native-share` export button on Capsules tab or Settings. One-tap "Back up wallet state" CTA.
2. **Auto-backup** — trigger `buildArkBackupBlob` after every successful VTXO state change (post-receive, post-send, post-refresh) and write to `DocumentDirectoryPath` so the file survives app restarts. Eliminates the manual-backup UX problem.
3. **End-to-end send test on signet** — fund a signet wallet, do an Ark→Ark send, verify fee estimation + execute + history update.
4. **Hot-vault seed reuse** (Phase 1 TODO) — real keychain read + `createArkWallet(hotVaultMnemonic)` + warn modal.
5. **Phase 7 emergency exit** — expose `wallet.exitAll()` / `wallet.claimExits()` behind a destructive-action modal.
6. **Contact Second.tech** — request stable `Wallet.export()` / `Wallet.import()` API (draft message prepared).
