import { create, GetState, SetState } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "./index";
import type { ArkBalanceSummary, ArkLightningReceiveView, ArkVtxoView } from "@Cypher/services/ark";

/**
 * Stuck-refresh detection state.
 *
 * Set by useArkSync when at least one VTXO is `state=Locked` AND its
 * `expiryHeight <= tip` (i.e. expired on-chain) AND the SDK still reports
 * at least one round with `ongoing=true`. The SDK's `progressPendingRounds()`
 * normally drives stuck rounds to terminal state, but if the ASP went silent
 * mid-round the SDK can sit at `ongoing=true` indefinitely with no client-
 * side timeout. The on-chain VTXO expiry is our reliable signal that the
 * round is past saving and the user should be offered manual cancellation.
 *
 * Recovery: call `cancelArkPendingRound(id)` for each entry in
 * `stuckRoundIds`, then sync. Cancellation unlocks the input VTXOs so the
 * user can retry. Per Erik (Bark team): the server may refuse if the round
 * has already finalised — in that case the next sync ingests the result.
 */
export type ArkRefreshStuckInfo = {
    /** Round IDs the SDK currently reports as `ongoing=true`. */
    stuckRoundIds: number[];
    /** Sum of `Locked` VTXOs whose `expiryHeight <= tip`. The sats at risk. */
    stuckSats: number;
    /** Chain tip at detection time — for "X blocks past expiry" messaging. */
    detectedAtTip: number;
    /**
     * True when the stuck round's Locked VTXOs are inside the swap-out
     * window (12h of their pre-refresh expiry). Set by useArkSync alongside
     * the stuck detection. Flips the recovery UX from "cancel & retry" to
     * "move your funds out": the home-card banner, the Capsules banner, and
     * the swap-out expiry notifications all route to ArkStuckCapsuleScreen
     * instead of the in-place cancel-and-retry when this is true. Optional
     * so state persisted before this field migrates cleanly (treated as
     * false / not-near-expiry).
     */
    nearExpiry?: boolean;
};

export type AuthStateType = {
    user: null | any;
    token: string | null;
    withdrawThreshold: any | null;
    isAuth: boolean | undefined;
    walletID: string | undefined;
    reserveAmount: number;
    coldStorageWalletID: string | undefined;
    vaultTab: boolean;
    // userCreds removed — credentials now stored in secure keychain
    setVaultTab: (state: boolean) => void;
    setReserveAmount: (state: number) => void;
    setAuth: (state: boolean | undefined) => void;
    setWalletID: (state: string | undefined) => void;
    setColdStorageWalletID: (state: string | undefined) => void;
    setToken: (token: string) => void;
    setUser: (state: any) => void;
    setWithdrawThreshold: (state: any) => void;
    clearAuth: () => void;
    clearStrikeAuth: () => void;

    //strike
    strikeMe: any | null;
    walletTab: boolean;
    isStrikeAuth: boolean;
    strikeUser: any | null;
    strikeCurrency: string; // User's Strike account currency (USD, EUR, GBP, AUD, etc.)
    allBTCWallets: string[];
    strikeToken: string | null;
    reserveStrikeAmount: number;
    withdrawStrikeThreshold: any | null;
    matchedRateStrike: number;
    setMatchedRateStrike: (state: number) => void;
    setStrikeMe: (state: any) => void;
    setStrikeUser: (state: any) => void;
    setStrikeCurrency: (state: string) => void;
    setAllBTCWallets: (state: string[]) => void;
    setWalletTab: (state: boolean) => void;
    setStrikeToken: (token: string) => void;
    setReserveStrikeAmount: (state: number) => void;
    setWithdrawStrikeThreshold: (state: any) => void;
    setStrikeAuth: (state: boolean | undefined) => void;

    // first-time tracking
    FirstTimeLightning: boolean;
    FirstTimeCoinOS: boolean;
    FirstTimeArk: boolean;
    hasSeenCustodialWarning: boolean;
    setFirstTimeLightning: (state: boolean) => void;
    setFirstTimeCoinOS: (state: boolean) => void;
    setFirstTimeArk: (state: boolean) => void;
    setHasSeenCustodialWarning: (state: boolean) => void;

    // Hot Vault Keychain backup tracking.
    // Record<walletID, true> — only set after a successful Keychain save.
    // Persisted via zustand `persist` so we can render the "✓ Backed up" state
    // without hitting Keychain (and triggering biometric) on every mount.
    // NOTE: the zustand flag is a UI hint, not ground truth. Ground truth is
    // the Keychain entry itself — which we only read on explicit recovery.
    hotVaultKeychainBackups: Record<string, boolean>;
    setHotVaultKeychainBackup: (walletID: string, backedUp: boolean) => void;

    // Ark (experimental — Second.tech)
    // Non-custodial; no token/credential. We persist a lightweight descriptor:
    //   arkWallet: { id, createdAt, useHotVaultSeed }  — actual secret lives in native/Keychain
    //   arkBalance, thresholds, thresholds behave like Strike/CoinOS for UX parity
    isArkAuth: boolean;
    arkWallet: any | null;
    arkBalance: number;
    // Full Balance breakdown from Bark SDK, in plain number sats (bigints
    // stripped at the service boundary). Null until first successful fetch.
    arkBalanceDetail: ArkBalanceSummary | null;
    // Live VTXO list from wallet.allVtxos(), projected to a plain-number
    // view. Spendable-only subset drives the capsule UI.
    arkVtxos: ArkVtxoView[];
    /**
     * VTXO ids the client submitted for a delegated refresh and is waiting to
     * finalise. bark 0.6.0 no longer marks a mid-refresh VTXO `Locked` (it
     * stays `Spendable` so the user can still spend it), so the client tracks
     * these ids itself to drive the per-capsule "Refreshing" animation. Pruned
     * each sync by useArkSync (id gone from the wallet, or pendingInRoundSats
     * back to 0).
     */
    arkRefreshingVtxoIds: string[];
    /**
     * Set when at least one ongoing round has been pending for longer than
     * `2 × roundIntervalSecs` (time-based detection). Drives the "Recover
     * stuck refresh" banner in ArkWallet. `null` means no stuck round
     * detected this sync cycle. See {@link ArkRefreshStuckInfo} for full
     * rationale + history of the earlier (incorrect) expiryHeight-based
     * trigger.
     */
    arkRefreshStuck: ArkRefreshStuckInfo | null;
    /**
     * Per-round wall-clock timestamps (epoch ms) for stuck-refresh detection.
     * Map of stringified `roundId` (u32) → ms when the round was first seen
     * in `pendingRoundStates()`. Persisted via the existing zustand persist
     * middleware so a round stuck across an app cold-restart still trips the
     * `2 × roundIntervalSecs` threshold instead of restarting the clock.
     * Pruned each sync to drop roundIds no longer pending — never grows
     * unbounded.
     */
    arkPendingRoundFirstSeen: Record<string, number>;
    /**
     * Map of `vtxoId → scheduled-for expiry epoch ms` for VTXOs that have
     * OS-level expiry-warning notifications queued via
     * `scheduleVtxoExpiryWarnings`. Persisted so the sync sweep doesn't
     * re-schedule on every 30s tick (which would be wasteful and could
     * race with the OS scheduler).
     *
     * On every sync after the vtxos write:
     *   - New VTXO with on-chain expiry but no entry here → schedule + add
     *   - Entry here whose VTXO no longer spendable → cancel + remove
     *
     * The value (expiry ms) is what we scheduled FOR, so a future cleanup
     * pass can detect and clear stale entries even if a VTXO disappears
     * outside the sync flow.
     */
    arkScheduledExpiryNotifs: Record<string, number>;
    /**
     * Map of `vtxoId → scheduled-for expiry epoch ms` for Locked VTXOs that
     * have the stuck-refresh SWAP-OUT notifications (12h/6h/3h) queued via
     * `scheduleVtxoStuckSwapWarnings`. Separate from
     * `arkScheduledExpiryNotifs` (the refresh-flavoured warnings) because
     * these fire only while a round is stuck AND the funds are near expiry,
     * and their tap routes to ArkStuckCapsuleScreen ("move your funds out")
     * rather than arming an auto-refresh. Persisted so the sync sweep doesn't
     * re-schedule every tick; reconciled the same way (add when stuck+near,
     * cancel when the VTXO unlocks / stops being stuck / stops being near).
     */
    arkScheduledStuckSwapNotifs: Record<string, number>;
    /**
     * Version of the expiry-warning schedule reflected in the OS notification
     * queue. Bumped when the schedule changes (e.g. moving from 24h+6h to
     * 4d/2d/24h/12h/6h). On the first sync after upgrade, useArkSync compares
     * persisted vs current; if behind AND the toggle is on, it force-calls
     * scheduleVtxoExpiryWarnings on every spendable VTXO so OS-level alarms
     * catch up with the new schedule, then sets the persisted version.
     * Pre-this-field: implicit 0 (24h+6h or legacy warn2h). Current: 1.
     */
    arkExpiryNotifsScheduleVersion: number;
    /**
     * Pending Lightning receives from `wallet.pendingLightningReceives()`.
     *
     * Why this is separate from arkVtxos: between the moment a counterparty
     * pays a Lightning invoice and the moment the resulting VTXO materialises
     * in `allVtxos()` there's a multi-minute gap (the claim has to ride the
     * next Ark round). During that gap the SDK reports the movement as
     * "successful" in history but the spendable balance stays at 0 — users
     * see the receive confirmed yet no capsule and no balance change. This
     * list is the bridge: anything in here with `hasHtlcVtxos === true`
     * is money that has arrived but hasn't yet condensed into a VTXO. The UI
     * renders these as ghost capsules ("Claiming via round…") so the user
     * has a visual signal that something is in flight.
     */
    arkPendingLnReceives: ArkLightningReceiveView[];
    // Current chain tip height (from esplora). Needed to convert VTXO
    // expiryHeight → blocks-until-expiry for the depletion ring.
    /**
     * Address the vault's Vault tab should display, per walletID.
     *
     * Empty means "use a fresh next-free address", which is the default and
     * what the tab did unconditionally before. Keyed by wallet so the hot and
     * cold vaults are independent, and so a selection cannot follow the user
     * onto a different wallet.
     */
    vaultDisplayAddress: Record<string, string>;
    arkChainTipHeight: number | null;
    // Epoch ms the tip above was read. The tip is PERSISTED, so a cold launch
    // offline rehydrates one that may be days old, and
    // `expiryHeight - staleTip` then OVERSTATES a capsule's remaining runway by
    // exactly that staleness. That is the unsafe direction on the exit's one
    // hard exclusion, so anything reasoning about runway must check this first.
    // Stamped automatically by setArkChainTipHeight; never set it by hand.
    arkChainTipHeightAt: number | null;
    // Timestamp (ms) of the last successful balance+vtxo sync. Used to
    // decide whether to block the UI on a fresh fetch or serve cached.
    arkLastSyncedAt: number | null;
    /**
     * Timestamp (ms) of the last successful encrypted datadir export to a
     * .cbark file. Drives the recoverability badges on the Capsules tab:
     * a Pubkey/Spendable VTXO is only ACTUALLY recoverable if a backup
     * was made AFTER the VTXO appeared.
     *
     * `null` = never backed up. Cleared on reset / disconnect so a stale
     * timestamp from a previous wallet doesn't grant false confidence to
     * the next one.
     */
    arkLastBackupAt: number | null;
    /**
     * Round-cadence in seconds, from the ASP's static config (wallet.arkInfo()).
     * Mainnet ≈ 3600, signet ≈ 300. Used to surface an upper-bound ETA on
     * "Refreshing…" labels — we can't show a real countdown because the SDK
     * doesn't expose `nextRoundAt`. Null until first successful fetch.
     */
    arkRoundIntervalSecs: number | null;
    /**
     * CSV delay in blocks a unilateral exit output must sit out before it can
     * be claimed (`ArkInfo.vtxoExitDelta`, observed 144 on mainnet). Cached
     * from the same one-shot arkInfo fetch as `arkRoundIntervalSecs`.
     *
     * Cached rather than fetched on demand because the exit path must never
     * call the ASP: the user pressed the trustless button precisely because the
     * server may be gone. Exit triage needs this to work out whether a capsule
     * has the runway to clear its timelock before it expires, and a null makes
     * it assume the worst plausible delta rather than skip the check.
     */
    arkVtxoExitDeltaBlocks: number | null;
    /**
     * `ArkInfo.maxVtxoExitDepth` (observed 100). Past this the server refuses
     * to cosign further out-of-round spends of a capsule, so exit or refresh
     * are the only moves left with it. Surfaced as a disclosure during exit
     * triage; it never excludes a capsule, since being un-spendable through the
     * server is an argument FOR exiting it.
     */
    arkMaxVtxoExitDepth: number | null;
    /**
     * Block height by which the tightest capsule in an in-flight exit must have
     * cleared its timelock. Written when the exit starts.
     *
     * The exit drive prices its CPFP bids from how much runway is left, and the
     * runway shrinks every block over an exit that runs for days. Persisting the
     * DEADLINE rather than the urgency band lets the drive re-derive the band
     * each tick against the current tip, with no extra wallet read and no stale
     * band. Null means unknown, which the pricing treats as most urgent.
     */
    arkExitFeeDeadlineHeight: number | null;
    /**
     * Unilateral-exit state — set when user taps "Emergency Exit" in
     * Settings. While true, `useArkSync` switches modes: it stops issuing
     * normal sync/refresh calls (they'd race the exit machinery) and instead
     * drives `progressArkExits` + `syncArkExits` per tick, then calls
     * `claimArkExitsToAddress` once VTXOs ripen past the CSV timelock.
     *
     * Cleared after the auto-claim succeeds and `resetArkWalletState` runs.
     */
    arkExitInProgress: boolean;
    /**
     * Where the user wants the on-chain funds to land after the timelock.
     * Captured at exit-start so the auto-claim loop has the address without
     * reprompting the user. Bitcoin address (mainnet bech32 / legacy / etc).
     */
    arkExitDestinationAddress: string | null;
    /**
     * Timestamp (ms) of `startArkEmergencyExit` success. Drives the
     * "started X hours ago" UI hint and the post-claim safety check
     * (don't auto-claim on a stale exit-in-progress flag from a crash).
     */
    arkExitStartedAt: number | null;
    /**
     * When the current exit first had ANY claimable capsule, epoch ms.
     *
     * Drives the claim batching window: each claim is its own on-chain
     * transaction with its own fee, so sweeping five capsules one at a time
     * costs five fees where one would do. Persisted rather than held in a ref
     * because the exit outlives the process by a day or more.
     */
    arkExitClaimBatchSince: number | null;
    /**
     * Spendable sats captured at the moment the exit was started. Display
     * fallback for the "X sats pending exit" panel: the SDK's live counters
     * read 0 mid-broadcast (see useArkSync exit block) and any live read
     * needs an open wallet handle, so this persisted snapshot is what keeps
     * the amount visible across reloads. Null when no exit is in flight.
     */
    arkExitStartedSats: number | null;
    /**
     * True once the in-flight exit has actually swept (drained) funds to the
     * destination at least once. The vault auto-delete (useArkSync) gates on
     * this: "0 pending / 0 claimable" means "exit complete" ONLY if we've
     * drained — otherwise it's the empty/never-materialised state (e.g. start
     * produced no pending exit txs) and deleting would wipe a wallet whose
     * funds never left. Reset on exit start and on teardown.
     */
    arkExitDrained: boolean;
    /**
     * Armed on-chain fee reserve, in sats. The bark on-chain (BDK) wallet pays
     * the unilateral-exit CPFP fees; this is the amount the user has committed
     * to keep on-chain for that purpose. While > 0 the auto-board pipeline
     * (`sync.ts`) leaves this many sats on-chain instead of boarding every
     * confirmed deposit straight back into a VTXO, otherwise funds sent to
     * cover exit fees would be boarded away the moment they land. 0 = no
     * reserve armed (default; auto-board behaves exactly as before). Set when
     * the user opens the "Fund exit fees" flow; reset on wallet teardown.
     */
    arkExitFeeReserveSats: number;
    /**
     * Last computed exit-cost estimate (computeExitFeeReserveSats). Persisted
     * ONLY so the sync loop's auto-board can see it: the estimate is computed
     * on the exit settings screen, but auto-board runs headless and would
     * otherwise hold just what the user armed and board the rest away.
     */
    arkExitRecommendedReserveSats: number | null;
    arkUseHotVaultSeed: boolean;
    withdrawArkThreshold: any | null;
    reserveArkAmount: number;
    setArkAuth: (state: boolean) => void;
    setArkWallet: (state: any) => void;
    setArkBalance: (state: number) => void;
    setArkBalanceDetail: (state: ArkBalanceSummary | null) => void;
    setArkVtxos: (state: ArkVtxoView[]) => void;
    setArkRefreshingVtxoIds: (ids: string[]) => void;
    setArkRefreshStuck: (state: ArkRefreshStuckInfo | null) => void;
    setArkPendingRoundFirstSeen: (state: Record<string, number>) => void;
    setArkScheduledExpiryNotifs: (state: Record<string, number>) => void;
    setArkScheduledStuckSwapNotifs: (state: Record<string, number>) => void;
    setArkExpiryNotifsScheduleVersion: (state: number) => void;
    setArkPendingLnReceives: (state: ArkLightningReceiveView[]) => void;
    setVaultDisplayAddress: (walletID: string, address: string | null) => void;
    setArkChainTipHeight: (state: number | null) => void;
    setArkLastSyncedAt: (state: number | null) => void;
    setArkLastBackupAt: (state: number | null) => void;
    setArkRoundIntervalSecs: (state: number | null) => void;
    setArkExitFeeDeadlineHeight: (state: number | null) => void;
    setArkExitParams: (state: {
        vtxoExitDeltaBlocks: number | null;
        maxVtxoExitDepth: number | null;
    }) => void;
    setArkExitInProgress: (state: boolean) => void;
    setArkExitDestinationAddress: (state: string | null) => void;
    setArkExitStartedAt: (state: number | null) => void;
    setArkExitClaimBatchSince: (state: number | null) => void;
    setArkExitDrained: (state: boolean) => void;
    setArkExitStartedSats: (state: number | null) => void;
    setArkExitFeeReserveSats: (state: number) => void;
    setArkExitRecommendedReserveSats: (state: number | null) => void;
    setArkUseHotVaultSeed: (state: boolean) => void;
    setWithdrawArkThreshold: (state: any) => void;
    setReserveArkAmount: (state: number) => void;

    // Reminders + foreground auto-refresh (opt-in). Gates the five
    // scheduled expiry warnings and the sync-tick urgency sweep — see
    // src/services/ark/backgroundRefresh.ts for the policy.
    arkBgRefreshEnabled: boolean;
    /** Timestamp (ms) of the last successful background round. Drives 12h rate limit + UI status copy. */
    arkBgRefreshLastSuccessAt: number | null;
    /** Outcome of the most recent attempt (success OR otherwise). UI surfaces failures only. */
    arkBgRefreshLastAttempt: {
        at: number;
        outcome: string;
        elapsedMs: number;
        errorMsg: string | null;
    } | null;
    /** Counts only `error` outcomes. Resets to 0 on success. Drives the "couldn't auto-refresh" notification at 2. */
    arkBgRefreshConsecutiveFailures: number;
    /**
     * Consecutive FAILED refresh-round submissions across EVERY path
     * (Capsules tab, notification tap, background sweep) — maintained by
     * refreshArkVtxos() in services/ark/refresh.ts: a submission that
     * reaches the SDK and throws increments it, a success resets it to 0.
     * Distinct from arkBgRefreshConsecutiveFailures, which counts only
     * background-orchestrator outcomes. Persisted because the failure
     * streaks that lose funds span days and app restarts (support case
     * 2026-07-11: 12+ failed refreshes over 3 days against a <2-day
     * expiry clock, no escalation). Drives the refresh-failing-near-
     * expiry Alert in useArkSync.
     */
    arkRefreshFailStreak: number;
    /**
     * Epoch ms when the refresh-failing-near-expiry Alert was last shown.
     * Gates re-showing so the escalation fires once per re-show window
     * instead of on every sync tick while the streak persists.
     */
    arkRefreshFailAlertAt: number | null;
    /** Set when a post-refresh cloud-backup upload deferred (Phase 4). Surfaces a banner on next foreground. */
    arkBgRefreshDeferredBackup: boolean;
    /** Last fire time of the <24h-to-expiry notification. Used to suppress repeat fires within a 12h window. */
    arkBgRefreshLastWarn24hAt: number | null;
    /** Last fire time of the <2h-to-expiry notification. Used to suppress repeat fires within a 1h window. */
    arkBgRefreshLastWarn2hAt: number | null;
    /** Last fire time of the stuck-refresh notification. Suppresses repeat fires within stuckWarnDedupeWindowMs. */
    arkBgRefreshLastStuckWarnAt: number | null;
    /** User-configurable upper bound on the fee a background refresh round can auto-pay (sats). Default 5000. */
    arkBgRefreshMaxFeeSats: number;
    /**
     * One-shot signal from the notification tap handler to the Capsules
     * tab. Set when a user taps a VTXO expiry-warning notification (cold,
     * background, or foreground). ArkCapsules consumes it on mount: it
     * hydrates the wallet if needed and auto-fires `refreshIds` against
     * all imminent VTXOs, then clears the flag. Persisted by zustand so
     * a crash between tap and consumption still triggers refresh on
     * next mount, which is the safer failure mode.
     */
    arkPendingTapRefresh: boolean;

    /**
     * One-shot flag: set when the homepage "stuck on-chain funds" banner is
     * tapped, consumed by ArkOnchainRecoverSection on the Capsules screen to
     * auto-open its recover modal. Same short-lived pattern as
     * arkPendingTapRefresh.
     */
    arkPendingOnchainRecoverOpen: boolean;

    /**
     * Per-VTXO state for the "Arkoor receive" prompt feature.
     *
     * Map of vtxoId → { status, observedAt, dismissedAt? }. Tracks which
     * arkoor VTXOs we've already shown the popup for (so we don't re-prompt
     * on every reload) and when the user dismissed each one (drives the
     * 24h-before-expiry push fallback).
     *
     * Statuses:
     *   - 'pending'   — first time we observed this arkoor, popup not yet shown
     *                   or shown but not yet acknowledged. Hook picks first
     *                   pending one and fires Alert.alert.
     *   - 'dismissed' — user picked "Use immediately". Schedule 24h+2h push
     *                   based on observedAt + ARK_ARKOOR_ASSUMED_DAYS.
     *   - 'refreshed' — user picked "Refresh now". Refresh was kicked off;
     *                   when the VTXO transitions to a round VTXO the entry
     *                   becomes irrelevant (existing useArkSync schedules
     *                   warnings on the new round VTXO automatically).
     *
     * Persisted so a kill-and-relaunch doesn't re-prompt for a vtxo the user
     * already saw. Entries are cleaned up by the hook when the underlying
     * vtxo disappears from arkVtxos.all (spent / refreshed-and-replaced /
     * exited).
     */
    arkArkoorPromptState: Record<string, {
        status: 'pending' | 'dismissed' | 'refreshed';
        observedAt: number;
        dismissedAt?: number;
        /**
         * "Spend immediately" grace: epoch-ms until which auto-refresh must
         * leave this vtxo alone. Set to now + SPEND_GRACE_MS when the user taps
         * "Use immediately" so the choice actually holds, then lapses so the
         * vtxo can auto-refresh again well before expiry. Absent on entries
         * from before this field / on non-"use-immediately" dismissals; those
         * are NOT grace-deferred. Manual (user-tapped) refresh ignores this.
         */
        deferUntil?: number;
        /**
         * Sats from the Bark movement event's `effectiveBalanceSats`.
         * Stored at push time so the popup can render the amount even
         * when the vtxo has already been Locked into a refresh round
         * and is no longer in `arkVtxos` (which only contains Spendable).
         * Optional for back-compat with entries persisted before this
         * field existed.
         */
        sats?: number;
    }>;
    /**
     * @deprecated The "always show the popup" decision was made after
     * direct user feedback ("what toggle do you mean") — if users don't
     * notice the control, they're not making an informed off-decision,
     * so the toggle was UX-noise rather than agency. Field retained for
     * persistence-store back-compat; new code treats the popup as always
     * on. Remove from the schema in a future migration cycle.
     */
    arkArkoorPromptEnabled: boolean;

    /**
     * iOS-only: true when the user satisfied the create-flow backup gate via
     * manual share+confirm (the only honest iOS path — Documents writes
     * auto-sync to iCloud Drive only if the user has enabled iCloud Drive
     * for Cypher Box, which we cannot probe). The flag stays on until the
     * user explicitly tells us iCloud Drive sync is enabled, after which
     * the auto-tick has a verifiable off-device channel and the snapshot
     * reminder no longer applies. Drives the post-create reminder + a
     * persistent banner reminding the user to re-export from
     * Settings → Ark Backup after every Lightning receive.
     */
    arkIosBackupReminderActive: boolean;
    setArkBgRefreshEnabled: (state: boolean) => void;
    setArkBgRefreshLastSuccessAt: (state: number | null) => void;
    setArkBgRefreshLastAttempt: (
        state: {
            at: number;
            outcome: string;
            elapsedMs: number;
            errorMsg: string | null;
        } | null,
    ) => void;
    setArkBgRefreshConsecutiveFailures: (state: number) => void;
    setArkRefreshFailStreak: (state: number) => void;
    setArkRefreshFailAlertAt: (state: number | null) => void;
    setArkBgRefreshDeferredBackup: (state: boolean) => void;
    setArkBgRefreshLastWarn24hAt: (state: number | null) => void;
    setArkBgRefreshLastWarn2hAt: (state: number | null) => void;
    setArkBgRefreshLastStuckWarnAt: (state: number | null) => void;
    setArkBgRefreshMaxFeeSats: (state: number) => void;
    setArkPendingTapRefresh: (state: boolean) => void;
    setArkPendingOnchainRecoverOpen: (state: boolean) => void;
    setArkIosBackupReminderActive: (state: boolean) => void;
    setArkArkoorPromptState: (
        state: Record<string, {
            status: 'pending' | 'dismissed' | 'refreshed';
            observedAt: number;
            dismissedAt?: number;
            deferUntil?: number;
            sats?: number;
        }>,
    ) => void;
    setArkArkoorPromptEnabled: (state: boolean) => void;

    clearArkAuth: () => void;

    // 2FA state
    twoFARequired: boolean;
    twoFAVerified: boolean;
    setTwoFARequired: (state: boolean) => void;
    setTwoFAVerified: (state: boolean) => void;
};

const createAuthStore = (
    set: SetState<AuthStateType>,
    get: GetState<AuthStateType>
): AuthStateType => ({
    user: null,
    token: null,
    allBTCWallets: [],
    withdrawThreshold: 500000,
    reserveAmount: 100000,
    isAuth: undefined,
    walletID: undefined,
    vaultTab: false,
    // userCreds removed — stored in keychain
    coldStorageWalletID: undefined,
    matchedRateStrike: 0,
    FirstTimeLightning: true,
    FirstTimeCoinOS: true,
    FirstTimeArk: true,
    hasSeenCustodialWarning: false,
    hotVaultKeychainBackups: {},

    // Ark (experimental) defaults
    isArkAuth: false,
    arkWallet: null,
    arkBalance: 0,
    arkBalanceDetail: null,
    arkVtxos: [],
    arkRefreshingVtxoIds: [],
    arkRefreshStuck: null,
    arkPendingRoundFirstSeen: {},
    arkScheduledExpiryNotifs: {},
    arkScheduledStuckSwapNotifs: {},
    arkExpiryNotifsScheduleVersion: 0,
    arkPendingLnReceives: [],
    vaultDisplayAddress: {},
    arkChainTipHeight: null,
    arkChainTipHeightAt: null,
    arkLastSyncedAt: null,
    arkLastBackupAt: null,
    arkRoundIntervalSecs: null,
    arkVtxoExitDeltaBlocks: null,
    arkMaxVtxoExitDepth: null,
    arkExitFeeDeadlineHeight: null,
    arkExitInProgress: false,
    arkExitDestinationAddress: null,
    arkExitStartedAt: null,
    arkExitClaimBatchSince: null,
    arkExitDrained: false,
    arkExitStartedSats: null,
    arkExitFeeReserveSats: 0,
    arkExitRecommendedReserveSats: null,
    arkUseHotVaultSeed: false,
    withdrawArkThreshold: 500000,
    reserveArkAmount: 100000,
    // Default ON so newly-created wallets get the auto-refresh
    // safety net without an extra opt-in step. The actual scheduler
    // is armed at wallet-create time (ArkSeedPhraseScreen.handleContinue
    // calls setArkBackgroundRefreshEnabled), and the user can flip
    // this off via the Capsules tab toggle. Existing wallets created
    // before this default flipped retain whatever value persisted to
    // disk under their previous preference.
    arkBgRefreshEnabled: true,
    arkBgRefreshLastSuccessAt: null,
    arkBgRefreshLastAttempt: null,
    arkBgRefreshConsecutiveFailures: 0,
    arkRefreshFailStreak: 0,
    arkRefreshFailAlertAt: null,
    arkBgRefreshDeferredBackup: false,
    arkBgRefreshLastWarn24hAt: null,
    arkBgRefreshLastWarn2hAt: null,
    arkBgRefreshLastStuckWarnAt: null,
    arkBgRefreshMaxFeeSats: 5000,
    arkPendingTapRefresh: false,
    arkPendingOnchainRecoverOpen: false,
    arkIosBackupReminderActive: false,
    arkArkoorPromptState: {},
    arkArkoorPromptEnabled: true,
    // 2FA state
    twoFARequired: false,
    twoFAVerified: false,
    setMatchedRateStrike: (state: number) => set({ matchedRateStrike: state }),
    setAllBTCWallets: (state: string[]) => set({ allBTCWallets: state }),
    setAuth: (state: boolean | undefined) => set({ isAuth: state }),
    setVaultTab: (state: boolean) => set({ vaultTab: state }),
    setToken: (token: string) => set({ token: token }),
    setUser: (state: any) => set({ user: state }),
    setWalletID: (state: string | undefined) => set({walletID: state}),
    setColdStorageWalletID: (state: string | undefined) => set({coldStorageWalletID: state}),
    setReserveAmount: (state: any) => set({ reserveAmount: state }),
    setWithdrawThreshold: (state: any) => set({ withdrawThreshold: state }),
    setFirstTimeLightning: (state: boolean) => set({ FirstTimeLightning: state }),
    setFirstTimeCoinOS: (state: boolean) => set({ FirstTimeCoinOS: state }),
    setFirstTimeArk: (state: boolean) => set({ FirstTimeArk: state }),
    setHasSeenCustodialWarning: (state: boolean) => set({ hasSeenCustodialWarning: state }),
    setHotVaultKeychainBackup: (walletID: string, backedUp: boolean) =>
        set(state => {
            const next = { ...state.hotVaultKeychainBackups };
            if (backedUp) {
                next[walletID] = true;
            } else {
                delete next[walletID];
            }
            return { hotVaultKeychainBackups: next };
        }),
    // Ark setters
    setArkAuth: (state: boolean) => set({ isArkAuth: state }),
    setArkWallet: (state: any) => set({ arkWallet: state }),
    setArkBalance: (state: number) => set({ arkBalance: state }),
    setArkBalanceDetail: (state: ArkBalanceSummary | null) => set({ arkBalanceDetail: state }),
    setArkVtxos: (state: ArkVtxoView[]) => set({ arkVtxos: state }),
    setArkRefreshingVtxoIds: (ids: string[]) => set({ arkRefreshingVtxoIds: ids }),
    setArkRefreshStuck: (state: ArkRefreshStuckInfo | null) => set({ arkRefreshStuck: state }),
    setArkPendingRoundFirstSeen: (state: Record<string, number>) => set({ arkPendingRoundFirstSeen: state }),
    setArkScheduledExpiryNotifs: (state: Record<string, number>) => set({ arkScheduledExpiryNotifs: state }),
    setArkScheduledStuckSwapNotifs: (state: Record<string, number>) => set({ arkScheduledStuckSwapNotifs: state }),
    setArkExpiryNotifsScheduleVersion: (state: number) => set({ arkExpiryNotifsScheduleVersion: state }),
    setArkPendingLnReceives: (state: ArkLightningReceiveView[]) => set({ arkPendingLnReceives: state }),
    setVaultDisplayAddress: (walletID: string, address: string | null) =>
        set((state: any) => {
            const next = { ...(state.vaultDisplayAddress ?? {}) };
            // A null clears the pin and returns the tab to a fresh address.
            if (address) next[walletID] = address;
            else delete next[walletID];
            return { vaultDisplayAddress: next };
        }),
    // Stamps the read time with the value, so the two can never drift apart.
    setArkChainTipHeight: (state: number | null) =>
        set({ arkChainTipHeight: state, arkChainTipHeightAt: state == null ? null : Date.now() }),
    setArkLastSyncedAt: (state: number | null) => set({ arkLastSyncedAt: state }),
    setArkLastBackupAt: (state: number | null) => set({ arkLastBackupAt: state }),
    setArkRoundIntervalSecs: (state: number | null) => set({ arkRoundIntervalSecs: state }),
    setArkExitFeeDeadlineHeight: (state: number | null) => set({ arkExitFeeDeadlineHeight: state }),
    setArkExitParams: (state) => set({
        arkVtxoExitDeltaBlocks: state.vtxoExitDeltaBlocks,
        arkMaxVtxoExitDepth: state.maxVtxoExitDepth,
    }),
    setArkExitInProgress: (state: boolean) => set({ arkExitInProgress: state }),
    setArkExitDestinationAddress: (state: string | null) => set({ arkExitDestinationAddress: state }),
    setArkExitStartedAt: (state: number | null) => set({ arkExitStartedAt: state }),
    setArkExitClaimBatchSince: (state: number | null) => set({ arkExitClaimBatchSince: state }),
    setArkExitDrained: (state: boolean) => set({ arkExitDrained: state }),
    setArkExitStartedSats: (state: number | null) => set({ arkExitStartedSats: state }),
    setArkExitFeeReserveSats: (state: number) => set({ arkExitFeeReserveSats: state }),
    setArkExitRecommendedReserveSats: (state: number | null) =>
        set({ arkExitRecommendedReserveSats: state }),
    setArkUseHotVaultSeed: (state: boolean) => set({ arkUseHotVaultSeed: state }),
    setWithdrawArkThreshold: (state: any) => set({ withdrawArkThreshold: state }),
    setReserveArkAmount: (state: number) => set({ reserveArkAmount: state }),
    setArkBgRefreshEnabled: (state: boolean) => set({ arkBgRefreshEnabled: state }),
    setArkBgRefreshLastSuccessAt: (state: number | null) => set({ arkBgRefreshLastSuccessAt: state }),
    setArkBgRefreshLastAttempt: (state) => set({ arkBgRefreshLastAttempt: state }),
    setArkBgRefreshConsecutiveFailures: (state: number) => set({ arkBgRefreshConsecutiveFailures: state }),
    setArkRefreshFailStreak: (state: number) => set({ arkRefreshFailStreak: state }),
    setArkRefreshFailAlertAt: (state: number | null) => set({ arkRefreshFailAlertAt: state }),
    setArkBgRefreshDeferredBackup: (state: boolean) => set({ arkBgRefreshDeferredBackup: state }),
    setArkBgRefreshLastWarn24hAt: (state: number | null) => set({ arkBgRefreshLastWarn24hAt: state }),
    setArkBgRefreshLastWarn2hAt: (state: number | null) => set({ arkBgRefreshLastWarn2hAt: state }),
    setArkBgRefreshLastStuckWarnAt: (state: number | null) => set({ arkBgRefreshLastStuckWarnAt: state }),
    setArkBgRefreshMaxFeeSats: (state: number) => set({ arkBgRefreshMaxFeeSats: state }),
    setArkPendingTapRefresh: (state: boolean) => set({ arkPendingTapRefresh: state }),
    setArkPendingOnchainRecoverOpen: (state: boolean) => set({ arkPendingOnchainRecoverOpen: state }),
    setArkIosBackupReminderActive: (state: boolean) => set({ arkIosBackupReminderActive: state }),
    setArkArkoorPromptState: (state) => set({ arkArkoorPromptState: state }),
    setArkArkoorPromptEnabled: (state: boolean) => set({ arkArkoorPromptEnabled: state }),
    clearArkAuth: () =>
        set({
            isArkAuth: false,
            arkWallet: null,
            arkBalance: 0,
            arkBalanceDetail: null,
            arkVtxos: [],
            arkRefreshingVtxoIds: [],
            arkRefreshStuck: null,
            arkPendingRoundFirstSeen: {},
            arkScheduledExpiryNotifs: {},
            arkScheduledStuckSwapNotifs: {},
            arkExpiryNotifsScheduleVersion: 0,
            arkPendingLnReceives: [],
            arkChainTipHeight: null,
            arkChainTipHeightAt: null,
            arkLastSyncedAt: null,
            arkLastBackupAt: null,
            arkRoundIntervalSecs: null,
            // arkVtxoExitDeltaBlocks / arkMaxVtxoExitDepth are deliberately NOT
            // reset. They are the server's protocol constants, not wallet
            // state, and exit triage falls back to a worst-case delta whenever
            // they are null. Clearing them here would leave a freshly recovered
            // wallet triaging against that worst case until the next arkInfo
            // fetch lands, which excludes capsules that had the runway all
            // along. Same reasoning as arkBgRefreshEnabled below.
            arkExitFeeDeadlineHeight: null,
            arkExitInProgress: false,
            arkExitStartedAt: null,
            arkExitClaimBatchSince: null,
            arkExitDrained: false,
            arkExitStartedSats: null,
            arkUseHotVaultSeed: false,
            // arkExitDestinationAddress and arkExitFeeReserveSats are
            // deliberately NOT reset here. Both are user-chosen exit-funding
            // settings, and clearArkAuth is not only a logout: the boot path
            // calls it on a `no-datadir` restore result
            // (useArkRestoreOnBoot.ts:99), so a transient read on a device that
            // does have a vault silently discarded both.
            //
            // Observed on device 2026-08-16. The reserve went to 0, which flips
            // sync.ts out of the "hold funds on-chain" branch and into
            // boardAll(), i.e. boarding away the very sats set aside to pay for
            // a unilateral exit. And the nulled destination let
            // useArkExitDestinationBackfill (which only fills when unset)
            // substitute a fresh Hot Vault address, so a live exit was
            // redirected away from the address the user had chosen.
            //
            // Same reasoning as the kept thresholds below and as
            // arkArkoorPromptEnabled.
            allBTCWallets: get().allBTCWallets.filter(wallet => wallet !== 'ARK'),
            // Keep thresholds — don't reset on logout

            // Background-refresh bookkeeping is wallet-scoped: clear on
            // disconnect so the next wallet doesn't inherit a previous
            // wallet's success timestamp / failure count.
            //
            // arkBgRefreshEnabled is intentionally NOT reset here. It is a
            // user preference (on by default), so it is kept across wallet
            // changes, the same treatment as arkArkoorPromptEnabled below.
            // Forcing it false on every disconnect silently disabled
            // background refresh after any recover/reconnect: the wallet-open
            // backfill (ensureBackgroundArkSeed) only mirrors the background-
            // readable seed while the flag is true, so a persisted false
            // starved the maintenance task of its seed. An explicit opt-out
            // (the toggle) still sets the flag false and deletes the seed,
            // and that choice is now preserved across a reconnect too.
            arkBgRefreshLastSuccessAt: null,
            arkBgRefreshLastAttempt: null,
            arkBgRefreshConsecutiveFailures: 0,
            arkRefreshFailStreak: 0,
            arkRefreshFailAlertAt: null,
            arkBgRefreshDeferredBackup: false,
            arkBgRefreshLastWarn24hAt: null,
            arkBgRefreshLastWarn2hAt: null,
            arkBgRefreshLastStuckWarnAt: null,
            arkPendingTapRefresh: false,
            arkPendingOnchainRecoverOpen: false,
            arkIosBackupReminderActive: false,
            // Per-VTXO Arkoor-prompt state is wallet-scoped — clear on
            // disconnect so the next wallet doesn't inherit prior prompts.
            // arkArkoorPromptEnabled is a user preference, kept across
            // wallet changes (matches the withdrawArkThreshold pattern).
            arkArkoorPromptState: {},
        }),
    // 2FA setters
    setTwoFARequired: (state: boolean) => set({ twoFARequired: state }),
    setTwoFAVerified: (state: boolean) => set({ twoFAVerified: state }),
    clearAuth: () =>
        set({
            vaultTab: false,
            isAuth: undefined,
            user: null,
            token: null,
            allBTCWallets: get().allBTCWallets.filter(wallet => wallet !== 'COINOS'),
            // Keep withdrawThreshold and reserveAmount — don't reset on logout
        }),
    //strike
    strikeMe: null,
    strikeUser: null,
    strikeCurrency: 'USD',
    walletTab: false,
    strikeToken: null,
    isStrikeAuth: false,
    reserveStrikeAmount: 100000,
    withdrawStrikeThreshold: 1000000,
    setStrikeMe: (state: any) => set({ strikeMe: state }),
    setStrikeUser: (state: any) => set({ strikeUser: state }),
    setStrikeCurrency: (state: string) => set({ strikeCurrency: state }),
    setWalletTab: (state: boolean) => set({ walletTab: state }),
    setStrikeToken: (token: string) => set({ strikeToken: token }),
    setStrikeAuth: (state: boolean | undefined) => set({ isStrikeAuth: state }),
    setReserveStrikeAmount: (state: number) => set({ reserveStrikeAmount: state }),
    setWithdrawStrikeThreshold: (state: any) => set({ withdrawStrikeThreshold: state }),
    clearStrikeAuth: () =>
        set({
            strikeMe: null,
            strikeUser: null,
            strikeCurrency: 'USD',
            walletTab: false,
            strikeToken: null,
            matchedRateStrike: 0,
            allBTCWallets: get().allBTCWallets.filter(wallet => wallet !== 'STRIKE'),
            isStrikeAuth: undefined,
            // Keep reserveStrikeAmount and withdrawStrikeThreshold — don't reset on logout
        }),
});

const useAuthStore = create<AuthStateType>()(
    persist(createAuthStore, {
        name: 'Auth',
        storage: createJSONStorage(() => zustandStorage),
        // v1: invalidate the persisted Strike OAuth token + auth slice so
        // any token captured by the prior console.log/Bugsnag-breadcrumb
        // leak is flushed on first launch of the patched build. Users
        // re-OAuth Strike on next open. Mirrors `clearStrikeAuth` (kept
        // fields: reserveStrikeAmount, withdrawStrikeThreshold — user
        // preferences, not auth state).
        version: 1,
        migrate: (persistedState, version) => {
            const state = (persistedState ?? {}) as Record<string, unknown>;
            if (version < 1) {
                return {
                    ...state,
                    strikeToken: null,
                    strikeMe: null,
                    strikeUser: null,
                    strikeCurrency: 'USD',
                    walletTab: false,
                    matchedRateStrike: 0,
                    isStrikeAuth: undefined,
                    allBTCWallets: Array.isArray(state.allBTCWallets)
                        ? (state.allBTCWallets as string[]).filter(w => w !== 'STRIKE')
                        : [],
                };
            }
            return state;
        },
    })
);

export default useAuthStore;
