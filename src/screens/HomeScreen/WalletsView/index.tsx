import { ArkWallet, CircularView, CoinosWallet, GradientButtonWithShadow, StrikeDollarWallet, StrikeWallet } from "@Cypher/components";
import RefreshWaitBanner from "@Cypher/components/RefreshWaitBanner";
import HomeNotices from "@Cypher/components/HomeNotices";
import { stepSituation, type HomeNotice } from "@Cypher/services/homeNotices";
import { Refresh } from "@Cypher/assets/images";
import { ARK_REFRESH_MIN_SATS, FEATURE_ARK_ENABLED, areBgNotificationsEnabled, blocksToDays, cancelArkPendingRound, isVtxoMidRound, sumMidRoundVtxos } from "@Cypher/services/ark";
import useAuthStore from "@Cypher/stores/authStore";
import { deriveVaultConnectivity } from "@Cypher/services/ark/chainTipFreshness";
import { arkBackupCoverage } from "@Cypher/services/ark/backupCoverage";
import screenWidth from "@Cypher/style-guide/screenWidth";
import { dispatchNavigate } from "@Cypher/helpers";
import { CarouselPageVisibilityContext } from "@Cypher/custom-hooks";
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Animated, AppState, FlatList, I18nManager, Image, NativeScrollEvent, NativeSyntheticEvent, Platform, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import SimpleToast from "react-native-simple-toast";
import loc from "../../../../loc";

interface Props {
    balance: any;
    wallet: any;
    coldStorageWallet: any;
    isLoading: boolean;
    matchedRate: any;
    currency: any;
    convertedRate: any;
    refRBSheet: any;
    refSendRBSheet: any;
    refSwapRBSheet?: any;
    setReceiveType: any;
    strikeBalance: any;
    matchedRateStrike?: number;
    strikeConvertedBalance?: number;
    currencyStrike?: string;
    homeNotice?: HomeNotice | null;
    /** Fires when the active carousel page changes. Used by BalanceView to render the page indicator (dots colored per wallet kind). */
    onPageChange?: (index: number, total: number, kinds: Array<'fiat' | 'lightning' | 'ark'>) => void;
}

// ark.second.tech server board minimum. Confirmed on-chain deposits below
// this can never board into a VTXO (see ArkOnchainRecoverSection). Mirrors
// MIN_BOARD_SATS there; kept as a local const to avoid a store read here.
const STUCK_BOARD_MIN_SATS = 50000;

// In RTL the carousel lays its pages out right-to-left, with the last tab on the left. initialScrollIndex and
// scrollToIndex take the tab index (FlatList finds the page), but scroll offsets, in scroll events and so in scrollX,
// are measured from the left on both platforms. Map them back to the tab, as BottomBar's vault pager does; without it,
// Arabic lit the wrong dot and put the shared row and the Bark nudges on the wrong card. The mapping is its own inverse.
const pageToTab = (page: number, count: number) => (I18nManager.isRTL ? count - 1 - page : page);
// the scroll offset at which this tab's card fills the screen
const tabOffset = (tab: number, count: number) => Math.max(0, pageToTab(tab, count)) * screenWidth;
// A clamped scroll-driven transition from one card's offset to another's. Animated wants an ascending inputRange, and
// in RTL the later card sits at the smaller offset, so the two ends are put in offset order.
const between = (fromOffset: number, toOffset: number, from: number, to: number) =>
    fromOffset <= toOffset
        ? { inputRange: [fromOffset, toOffset], outputRange: [from, to], extrapolate: 'clamp' as const }
        : { inputRange: [toOffset, fromOffset], outputRange: [to, from], extrapolate: 'clamp' as const };

// Imperative handle exposed to HomeScreen so the page-indicator dots in
// BalanceView can drive the carousel (tap dot 0 → fiat, dot 1 → lightning,
// etc.) without us hoisting the entire snap-carousel ref tree upward.
export type WalletsViewHandle = {
    snapTo: (index: number) => void;
};

const WalletsView = forwardRef<WalletsViewHandle, Props>(function WalletsView({
    balance,
    wallet,
    coldStorageWallet,
    isLoading,
    matchedRate,
    currency,
    convertedRate,
    refRBSheet,
    refSendRBSheet,
    refSwapRBSheet,
    setReceiveType,
    strikeBalance,
    matchedRateStrike = 0,
    strikeConvertedBalance = 0,
    currencyStrike = 'USD',
    homeNotice = null,
    onPageChange,
}, ref) {
    const {
        allBTCWallets,
        setWalletTab,
        isAuth,
        isStrikeAuth,
        isArkAuth,
        arkWallet,
        arkVtxos,
        arkRefreshingVtxoIds,
        arkChainTipHeight,
        arkBgRefreshEnabled,
        arkBgRefreshLastSuccessAt,
        arkBgRefreshLastAttempt,
        arkIosBackupReminderActive,
        arkBalanceDetail,
        arkRefreshStuck,
        arkPendingRoundFirstSeen,
        setArkPendingOnchainRecoverOpen,
        arkExitFeeReserveSats,
        setArkExitFeeReserveSats,
        arkExitRecommendedReserveSats,
        // Behind the offline warning below. All three are written only on a
        // SUCCESSFUL read, which is what makes their age the signal.
        arkChainTipHeightAt,
        arkLastSyncedAt,
        arkSyncFailStreak,
    } = useAuthStore();

    /**
     * Slow clock for the offline warning.
     *
     * The warning has to be able to APPEAR with no store activity at all: the
     * failure it reports is exactly the one that stops anything being written.
     * Without a tick of its own the row would keep showing whatever it last
     * said while the vault sat unreachable. 30s matches the Capsules tab and
     * the home card, and the thresholds it feeds are minutes wide.
     */
    const [connTick, setConnTick] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setConnTick(Date.now()), 30_000);
        return () => clearInterval(t);
    }, []);

    const vaultConnectivity = useMemo(
        () =>
            deriveVaultConnectivity({
                tipFetchedAtMs: arkChainTipHeightAt,
                lastSyncedAtMs: arkLastSyncedAt,
                nowMs: connTick,
                syncFailStreak: arkSyncFailStreak,
            }),
        [arkChainTipHeightAt, arkLastSyncedAt, arkSyncFailStreak, connTick],
    );

    // Per-card vertical nudge for the Ark slide.
    //
    // Bam's spec (2026-05-10):
    //   - (Ark alone) and (Ark + CoinOS) — handled by the parent
    //     container's translateY ladder in HomeScreen/index.tsx (no-Strike
    //     combos shift the whole carousel down 10pt). No per-card work.
    //   - (Ark + Strike) — the carousel-container stays put (so the Strike
    //     slide isn't dragged), but the Ark slide should sit ~5pt HIGHER
    //     than the Strike slide so the two cards visually line up. Strike's
    //     box has more top-padding than Ark's; we close that gap with a
    //     negative marginTop on the Ark wrapper.
    //   - (CoinOS + Strike + Ark, all-three) — Ark stays put. The carousel
    //     container is unchanged for this combo and the per-card offset is
    //     0, so swiping between cards doesn't visually jump.
    //
    // Single negative-or-zero offset, applied ONLY when (Strike + Ark) is
    // the active combo without CoinOS.
    const arkCardExtraOffsetPt =
        isStrikeAuth && isArkAuth && !isAuth ? 5 : 0;

    /**
     * The Bark notices below the shared Send/Receive row live here (rather
     * than only in ArkWallet) because the shared row is absolutely positioned
     * over ArkWallet's natural alert area, and anything inside the card would
     * sit BEHIND the buttons. Same notices and copy as ArkWallet's list.
     */
    /**
     * iOS-only: surface the Ark backup-snapshot reminder when the user
     * created the wallet via the manual share+confirm path and hasn't yet
     * confirmed iCloud Drive is on for Cypher Box. The same flag is shown
     * as a full action card in Settings → Ark Backup; here on the home
     * carousel it is one of the notice icons, so users notice it outside
     * the settings detour. Tap → opens the Ark settings tab where the
     * dismiss + re-export actions live.
     */
    const iosBackupReminderVisible = Platform.OS === 'ios' && isArkAuth && arkIosBackupReminderActive;

    // Days until the soonest-expiring spendable, non-locked VTXO ages out.
    // Mirrors the computation in ArkWallet/index.tsx so the shared-row
    // status surface speaks the same UX language as the in-card status
    // when only Ark is present.
    const soonestDaysLeft = useMemo(() => {
        if (!arkVtxos || arkChainTipHeight == null) return null;
        let minBlocks = Infinity;
        for (const v of arkVtxos) {
            if (v.expiryHeight === 0) continue;
            // Mid-round VTXOs carry their PRE-refresh expiry, so counting them
            // shows an alarming "expires soon" while a refresh is already in
            // flight extending it. Locked alone missed delegated refreshes.
            if (isVtxoMidRound(v, arkRefreshingVtxoIds)) continue;
            const blocks = v.expiryHeight - arkChainTipHeight;
            // Skip already-expired VTXOs (they stay in the store so the
            // Capsules tab can render them) — "refresh soon" is wrong
            // advice for funds that are already unrecoverable.
            if (blocks <= 0) continue;
            if (blocks < minBlocks) minBlocks = blocks;
        }
        if (!isFinite(minBlocks)) return null;
        return Math.max(0, blocksToDays(minBlocks));
    }, [arkVtxos, arkChainTipHeight]);

    const expiryWarning = soonestDaysLeft !== null && soonestDaysLeft < 7
        ? String(loc.formatString(loc.cypherbox.home_lists.wallets_view.oldest_capsule_expires, { days: Math.round(soonestDaysLeft) }))
        : null;

    // Dust capsules: below the PER-INPUT refresh floor (ARK_REFRESH_MIN_SATS,
    // 500 sats), still spendable, not expired, not already mid-sweep. Below
    // that floor a capsule cannot join a round on its own; it can only be
    // folded into a dust-only delegated batch, or spent. Returns the total too,
    // because whether batching produces a HEALTHY capsule or just a smaller
    // dust one depends on the sum, and the two cases need different advice.
    const dustCapsules = useMemo(() => {
        if (!arkVtxos || arkChainTipHeight == null) return { count: 0, sats: 0, ids: '' };
        // bark 0.6.1 keeps a delegated-refreshing VTXO Spendable (not Locked),
        // so a dust capsule mid-sweep still looks spendable here. Exclude the
        // client-tracked refreshing set so the "needs action" dust warning
        // doesn't fire on capsules that are already being consolidated.
        const refreshing = new Set(arkRefreshingVtxoIds ?? []);
        let count = 0;
        let sats = 0;
        const ids: string[] = [];
        for (const v of arkVtxos) {
            // ARK_REFRESH_MIN_SATS (500), not ARK_VTXO_DUST_SATS (330). The
            // refresh floor is what decides whether a capsule can be rescued on
            // its own, and it is PER INPUT: below it, a capsule cannot join a
            // round and can only be swept as part of a dust-only delegated
            // batch, or spent. The Capsules tab already draws the line there
            // (see strandedDust), so counting at 330 here left a whole band
            // invisible on Home. Observed on device 2026-08-20: two 400 sat
            // capsules on a 1d 21h fuse, flagged in Capsules, silent on Home.
            if (v.sats >= ARK_REFRESH_MIN_SATS) continue;
            if (v.state.toLowerCase() !== 'spendable') continue;
            if (v.expiryHeight === 0) continue;
            if (refreshing.has(v.id)) continue;
            const blocks = v.expiryHeight - arkChainTipHeight;
            if (blocks <= 0) continue;
            count++;
            sats += v.sats;
            ids.push(v.id);
        }
        // Which capsules, so an ignored dust notice comes back for new dust.
        return { count, sats, ids: ids.sort().join(',') };
    }, [arkVtxos, arkChainTipHeight, arkRefreshingVtxoIds]);

    // VTXOs currently mid-round (refresh / send / board in flight). The
    // headline balance EXCLUDES these (only spendable capsules count), so
    // without surfacing this the user sees their balance drop with no
    // explanation while a refresh is in progress. Testing `Locked` alone
    // reintroduced exactly that symptom for delegated refreshes, which leave
    // the VTXO Spendable. See isVtxoMidRound.
    const pendingRound = useMemo(
        () => sumMidRoundVtxos(arkVtxos, arkRefreshingVtxoIds),
        [arkVtxos, arkRefreshingVtxoIds],
    );

    // Mirrors ArkWallet: the notifications-off probe replaces the
    // v0.1.1-dropped auto-refresh branches.
    const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
    useEffect(() => {
        let cancelled = false;
        const probe = () => {
            areBgNotificationsEnabled().then((enabled) => {
                if (!cancelled) setNotificationsEnabled(enabled);
            }).catch(() => {
                if (!cancelled) setNotificationsEnabled(true);
            });
        };
        probe();
        const sub = AppState.addEventListener('change', (next) => {
            if (next === 'active') probe();
        });
        return () => { cancelled = true; sub.remove(); };
    }, []);

    // Where the Bark backup lives, for the "only on this phone" reminder at
    // the end of the chain below.
    const arkLastBackupAt = useAuthStore((s) => s.arkLastBackupAt);
    const arkLastOffDeviceBackupAt = useAuthStore((s) => s.arkLastOffDeviceBackupAt);
    const arkBackupThisPhoneOnly = arkBackupCoverage(arkLastBackupAt, arkLastOffDeviceBackupAt) === 'this-phone';

    const openArkTab = useCallback(
        (tab: number) => dispatchNavigate("CheckingAccountNew", { wallet: arkWallet, accountType: "ark", initialTab: tab }),
        [arkWallet],
    );

    /**
     * The Bark status notices for the shared row's icon slot
     * (components/HomeNotices), in the order the single-line slot used to
     * rank them. That slot showed only the first one that applied; each now
     * gets its own icon. Red ones cannot be ignored; the others come back
     * when their `situation` changes (services/homeNotices.ts).
     *
     * Same branches and copy as ArkWallet's list for the Bark-alone layout.
     * The iOS "backup not synced" branch is left out here: its flag is the
     * re-export reminder, which the slot adds itself (see sharedArkNotices).
     */
    const arkStatusNotices = useMemo((): HomeNotice[] => {
        const notices: HomeNotice[] = [];

        // OFFLINE FIRST, ahead of everything below including an in-flight
        // refresh.
        //
        // Every other notice in this list is derived from the cached chain
        // tip: how many days a capsule has left, whether it is dust, whether a
        // refresh is due. When the vault cannot be reached none of those
        // numbers are reads, they are projections off a tip that stopped
        // moving, and they keep counting down as if nothing were wrong. This
        // one says so. Back after Ignore when the vault goes offline again
        // after a successful sync.
        if (vaultConnectivity.level === 'red') {
            notices.push({
                id: 'ark-offline',
                severity: 'yellow',
                icon: 'cloud-offline-outline',
                situation: String(arkLastSyncedAt ?? 0),
                // COPY: Bam finalizes.
                text: loc.cypherbox.home_lists.wallets_view.vault_offline,
                onPress: () => openArkTab(0),
            });
        }

        // Refresh in flight: nothing more. The Ark Card itself shows the live
        // "Refreshing N capsules · X sats" line inside its balance area (see
        // Card's `refreshingInfo` prop), and the capsule numbers the notices
        // below read are in motion until the round lands.
        if (pendingRound.count > 0) {
            return notices;
        }

        // Stuck on-chain boarding funds: a confirmed deposit below the
        // server's 50k board minimum can never become a VTXO and sits trapped
        // in bark's on-chain wallet. Recover deep-links to the Capsules tab and
        // auto-opens the recover popup (address/vault picker); the second
        // action keeps the funds as the exit-fee reserve instead, which the
        // in-card path (ArkWallet) offers too. Suppressed when the user has
        // armed an on-chain exit-fee reserve: those funds are their
        // intentional CPFP reserve, not stuck money.
        {
            const stuckSats = Number(arkBalanceDetail?.onchainBoardingSats ?? 0);
            if (stuckSats > 0 && stuckSats < STUCK_BOARD_MIN_SATS && (arkExitFeeReserveSats ?? 0) <= 0) {
                notices.push({
                    id: 'ark-boarding',
                    severity: 'yellow',
                    icon: 'boat-outline',
                    situation: String(stuckSats),
                    text: String(loc.formatString(loc.cypherbox.home_lists.wallets_view.stuck_boarding, { sats: stuckSats.toLocaleString() })),
                    linkText: loc.cypherbox.home_lists.wallets_view.link_here,
                    onPress: () => {
                        // Arm the one-shot flag so the Capsules recover section
                        // auto-opens its address/vault picker on arrival.
                        setArkPendingOnchainRecoverOpen(true);
                        openArkTab(0);
                    },
                    actions: [{
                        label: loc.cypherbox.home_lists.wallets_view.leave_as_exit_fees,
                        onPress: () => {
                            setArkExitFeeReserveSats(stuckSats);
                            SimpleToast.show(loc.cypherbox.home_lists.wallets_view.kept_for_exit_fees, SimpleToast.SHORT);
                        },
                    }],
                });
            }
        }

        if (dustCapsules.count > 0) {
            // Two different situations, and only one of them has a clean fix.
            // When the dust TOTAL clears the refresh floor, a dust-only
            // delegated batch folds them into one healthy capsule for about a
            // sat, which resets both the value problem and the expiry clock.
            // Below that, batching still reduces the capsule count but the
            // result is itself dust, so spending is the honest advice. Back
            // after Ignore when the set of dust capsules changes.
            notices.push({
                id: 'ark-dust',
                severity: 'yellow',
                icon: 'sparkles-outline',
                situation: dustCapsules.ids,
                text: dustCapsules.sats >= ARK_REFRESH_MIN_SATS
                    ? loc.cypherbox.home_lists.wallets_view.dust_above_500
                    : loc.cypherbox.home_lists.wallets_view.dust_might_expire,
                linkText: loc.cypherbox.home_lists.wallets_view.link_here,
                onPress: () => openArkTab(0), // Capsules tab
            });
        }

        // Red: a capsule can expire within the week. Never ignorable.
        if (expiryWarning) {
            notices.push({
                id: 'ark-expiry',
                severity: 'red',
                icon: 'time',
                situation: '',
                text: expiryWarning,
                onPress: () => openArkTab(0),
            });
        }

        // Notifications-off replaces the v0.1.1-dropped "Auto-refresh: off"
        // branch. The capsule-expiry warning notifications are the only
        // sync-cadence safety net, so a revoked OS permission is the
        // equivalent loss of protection.
        if (notificationsEnabled === false) {
            notices.push({
                id: 'ark-notifications-off',
                severity: 'yellow',
                icon: 'notifications-off-outline',
                situation: 'off',
                text: loc.cypherbox.home_lists.wallets_view.notifications_off,
                onPress: () => openArkTab(0),
            });
        }

        // Capsules worth exiting, but the exit fee wallet is empty. Mirrors
        // ArkWallet's branch deliberately: the exit-fee reserve nudge once
        // lived in ArkWallet alone and nobody in the default layout ever saw
        // it. Back after Ignore when the reserve it asks for grows by another
        // 10k sats, not on every small move of the fee estimate.
        if ((arkExitRecommendedReserveSats ?? 0) > 0
            && (arkBalanceDetail?.onchainBoardingSats ?? 0) <= 0) {
            notices.push({
                id: 'ark-exit-fees',
                severity: 'yellow',
                icon: 'exit-outline',
                situation: stepSituation(arkExitRecommendedReserveSats ?? 0, 10_000),
                // COPY: Bam finalizes. Kept identical to ArkWallet on purpose.
                text: loc.cypherbox.home_lists.wallets_view.exit_no_fees,
                linkText: loc.cypherbox.home_lists.wallets_view.link_vault_tab,
                onPress: () => openArkTab(1), // Vault tab: the exit fee reserve card
            });
        }

        // Backups are written, but only inside the app, which a lost phone or
        // a deleted app takes with it. Stays until a copy reaches iCloud
        // Drive, Google Drive or the chosen folder (see backupCoverage.ts).
        // Back after Ignore with the next backup, which follows a receive.
        if (arkBackupThisPhoneOnly) {
            notices.push({
                id: 'ark-backup-phone-only',
                severity: 'yellow',
                icon: 'save-outline',
                situation: String(arkLastBackupAt ?? 0),
                text: Platform.OS === 'ios'
                    ? loc.cypherbox.home_lists.wallets_view.backup_this_phone_ios
                    : loc.cypherbox.home_lists.wallets_view.backup_this_phone_android,
                onPress: () => openArkTab(3), // Settings tab: the backup rows
            });
        }

        return notices;
    }, [
        arkExitRecommendedReserveSats,
        expiryWarning,
        dustCapsules,
        notificationsEnabled,
        arkBackupThisPhoneOnly,
        arkLastBackupAt,
        pendingRound,
        arkBalanceDetail,
        // Without this the offline notice never re-evaluates and keeps saying
        // whatever it said when the vault was last reachable.
        vaultConnectivity,
        arkLastSyncedAt,
        arkExitFeeReserveSats,
        openArkTab,
        setArkPendingOnchainRecoverOpen,
        setArkExitFeeReserveSats,
    ]);

    const [indexStrike, setIndexStrike] = useState(0);
    // Height of the Bark notice slot below the shared row, for the container's minHeight.
    const [sharedNoticesHeight, setSharedNoticesHeight] = useState(0);
    const [wTabs, setWTabs] = useState([]);
    const flatListRef = useRef<FlatList<any>>(null);

    useImperativeHandle(ref, () => ({
        // Implement snapTo via FlatList.scrollToIndex — same external API
        // as before (HomeScreen calls walletsViewRef.current?.snapTo(i)),
        // routed through FlatList's animated scroll. Migrated from
        // react-native-snap-carousel's snapToItem during the Fabric/New
        // Arch carousel-bleed fix; snap-carousel v4-beta hasn't supported
        // Fabric layout since 2020 and the slides were rendering with
        // wrong offsets, leaking the next slide past the right edge.
        snapTo: (i: number) => flatListRef.current?.scrollToIndex?.({ index: i, animated: true }),
    }), []);

    // Signature of the last carousel COMPOSITION (which wallets/kinds exist),
    // so the effect below can rebuild wTabs on every balance tick (to keep the
    // card closures' balances fresh) WITHOUT resetting the user's current page.
    const prevCompositionRef = useRef<string>('');

    useEffect(() => {
        if (!allBTCWallets || isLoading) return;

        // Carousel composition rules:
        //   - Custodial Lightning providers (STRIKE / COINOS) collapse into a single
        //     CircularView page when BOTH are present, since they share the
        //     "Lightning Accounts" UX. Single-custodial = its own card.
        //   - ARK is a structurally different wallet (non-custodial, separate
        //     SDK, separate balance) and ALWAYS gets its own carousel page —
        //     never collapsed into CircularView (which has no Ark support).
        //   - StrikeDollarWallet (USD shadow balance) tags along whenever Strike
        //     is connected — same as the original behavior.
        const custodialLightning = Array.from(new Set(
            (allBTCWallets as WalletName[]).filter(
                w => w === 'STRIKE' || w === 'COINOS'
            )
        )) as WalletName[];
        // Ark is feature-flagged off until Second.tech's mainnet ASP launches.
        // Even if zustand still has 'ARK' in allBTCWallets from a previous
        // session, we never render the carousel card while the flag is false.
        // Also gate on `isArkAuth`: if the user logged out of Ark but
        // allBTCWallets still has 'ARK' from a stale store entry, the
        // ArkWallet component would render its "Create an Ark Wallet"
        // CTA card on Home — Bam's request is to remove the Ark slot
        // entirely in that state and surface re-creation only via the
        // BalanceView's "+ Add wallet" affordance.
        const hasArk =
            FEATURE_ARK_ENABLED &&
            (allBTCWallets as WalletName[]).includes('ARK') &&
            isArkAuth;

        const tabs: any = [];
        // Default-landing slide. When Strike is connected its fiat balance
        // card sits at index 0, but the carousel should open on the actual
        // BTC/Lightning slide — the Strike BTC card, or the Strike↔Coinos
        // CircularView when both custodial providers are connected — not the
        // fiat balance. Computed AFTER the tabs are assembled (below) as the
        // first lightning-kind slide; falls back to 0 for Coinos-only /
        // Ark-only configs that have no fiat slide. The Animated.FlatList
        // honours this via `initialScrollIndex={indexStrike}` + getItemLayout
        // (the old snap-carousel couldn't, hence the previous land-on-fiat
        // workaround — no longer needed post-FlatList-migration).
        let defaultIndex = 0;

        const strikeDollarTab = {
            key: "strike-dollar",
            component: () => <StrikeDollarWallet currency={currencyStrike} matchedRateStrike={matchedRateStrike} />
        };

        if (custodialLightning.length > 1) {
            // Both custodial providers — fiat card left of the CircularView page.
            if (custodialLightning.includes('STRIKE')) {
                tabs.push(strikeDollarTab);
                // defaultIndex stays 0 — see comment above. Land on fiat,
                // user swipes left to reveal CircularView.
            }
            tabs.push({
                key: "lightning-circular",
                showTitle: true,
                component: () => (
                    <CircularView
                        balance={balance}
                        convertedRate={convertedRate}
                        currency={currency}
                        wallet={walletTabsMap[custodialLightning[0]].key}
                        matchedRateStrike={matchedRateStrike}
                        refRBSheet={refRBSheet}
                        refSendRBSheet={refSendRBSheet}
                        refSwapRBSheet={refSwapRBSheet}
                        setReceiveType={setReceiveType}
                        homeNotice={homeNotice}
                        hideActionButtons={useSharedButtons}
                    />
                )
            });
        } else if (custodialLightning.length === 1) {
            // Single custodial provider.
            const w = custodialLightning[0];
            if (w === 'STRIKE') {
                // Fiat card sits at index 0; Strike BTC at index 1. Carousel
                // mounts on fiat (see top-of-effect comment for why we don't
                // try to skip past it).
                tabs.push(strikeDollarTab);
            }
            tabs.push(walletTabsMap[w]);
        }

        // Ark is structurally separate — always its own page if present.
        if (hasArk) {
            tabs.push(walletTabsMap.ARK);
        }

        // Land on the first BTC/Lightning slide (Strike BTC card or the
        // Strike↔Coinos CircularView), skipping the Strike fiat card when it
        // exists. Falls back to 0 when there's no lightning slide.
        const firstLightningIdx = tabs.findIndex((t: any) => kindFromTab(t) === 'lightning');
        if (firstLightningIdx >= 0) defaultIndex = firstLightningIdx;

        // Always rebuild wTabs so the card closures capture fresh balances.
        // But only reset the page index (+ notify the indicator) when the
        // COMPOSITION actually changed — otherwise a routine balance update
        // yanked the carousel back to page 0, which desynced indexStrike from
        // the visible slide and blanked the scroll-opacity-driven shared
        // Send/Receive row until the user manually swiped. (The row reappearing
        // after a swipe was the tell: a real onScroll rewrote scrollX.)
        const compositionKey = `${custodialLightning.join(',')}|ark:${hasArk}`;
        setWTabs(tabs);
        if (compositionKey !== prevCompositionRef.current) {
            prevCompositionRef.current = compositionKey;
            setIndexStrike(defaultIndex);
            onPageChange?.(defaultIndex, tabs.length, tabs.map(kindFromTab));
            // Snap the FlatList itself to the new default page. Setting
            // No imperative snap here: the composition change also changes
            // the FlatList's `key` (see the render below), so the list
            // REMOUNTS with the new data and honours initialScrollIndex.
            // An rAF'd scrollToIndex against the remounting list raced its
            // data commit and crashed with "scrollToIndex out of range:
            // item length 0" (observed on the A14 right after this effect
            // ran). The remount is the whole fix; nothing to scroll.
        }
    }, [
        allBTCWallets, isLoading, matchedRateStrike, strikeBalance, convertedRate,
        // isArkAuth gates the Ark card (see `hasArk` above). Recovery writes
        // isArkAuth and allBTCWallets in SEPARATE store updates, and the
        // HomeScreen remount reconciles isArkAuth against disk, so this effect
        // can run with 'ARK' already in the list while isArkAuth is still
        // false, build wTabs WITHOUT the Ark card, then never rebuild when
        // isArkAuth flips true. Without it here the recovered card only appears
        // after a manual swipe / navigate-away-and-back forces a fresh build.
        isArkAuth,
    ]);

    // Maps a tab's `key` to the wallet "kind" used to color the page-indicator
    // line in BalanceView. Centralized here so the carousel and the indicator
    // can never disagree on what each slide represents.
    const kindFromTab = (tab: { key?: string }): 'fiat' | 'lightning' | 'ark' => {
        switch (tab?.key) {
            case 'strike-dollar': return 'fiat';
            case 'ark': return 'ark';
            // 'strike', 'coinos', 'lightning-circular' all read as a single
            // Lightning Account from the user's POV (custodial L2).
            default: return 'lightning';
        }
    };

    type WalletName = keyof typeof walletTabsMap;

    // Mirror the vault pattern: shared Receive/Send pair only kicks in
    // when BOTH a Lightning provider AND Ark exist (analogous to the vault
    // `bothVaultsExist` check). When only one is connected, that wallet's
    // own in-card buttons render — no shared row.
    const hasLightningWallet = (allBTCWallets as string[]).includes('STRIKE') || (allBTCWallets as string[]).includes('COINOS');
    // Same `isArkAuth` gate as the carousel `hasArk` above — without
    // it, a logged-out Ark with stale `allBTCWallets` would still flip
    // `useSharedButtons` true and route the BottomBar / shared row
    // logic as if Ark were live, breaking the layout.
    const hasArkWallet = FEATURE_ARK_ENABLED && (allBTCWallets as string[]).includes('ARK') && isArkAuth;
    const useSharedButtons = hasLightningWallet && hasArkWallet;

    // Refresh-round-in-flight signal for the wait banner below.
    //
    // A round takes up to an hour and needs the app open for the completion
    // sync to land, so this is exactly the wrong thing to show only inside the
    // Capsules tab. Same inputs the Capsules tab uses: pendingInRoundSats for
    // the round itself, and the per-round first-seen map for the countdowns.
    const arkPendingInRoundSats = Number(arkBalanceDetail?.pendingInRoundSats ?? 0);
    // Subscribed, not a getState() snapshot: a round starting or finishing has
    // to re-render this, or the banner's line count goes stale until some
    // unrelated state change happens to re-render the screen.
    const arkRoundStarts = Object.values(arkPendingRoundFirstSeen ?? {}) as number[];
    const arkRefreshInFlight = arkPendingInRoundSats > 0;
    // Strike + CoinOS + Ark all connected. The CircularView slide already
    // exposes a Strike↔CoinOS swap between its two circles, and hopping
    // between Lightning and Ark from the Ark slide is what the swap
    // affordance was offering — but Bam's spec is to drop the shared-row
    // swap entirely in this combo (both on the CircularView slide and the
    // Ark slide). Single-Lightning-rail combos (Strike+Ark or CoinOS+Ark)
    // still get the shared-row swap because they have no in-card swap.
    // Gated through `hasArkWallet` (which already requires isArkAuth)
    // so a logged-out Ark doesn't suppress the shared-row swap.
    const allThreeLightningRails =
        (allBTCWallets as string[]).includes('STRIKE') &&
        (allBTCWallets as string[]).includes('COINOS') &&
        hasArkWallet;

    const walletTabsMap = {
        // CoinOS is USD-denominated (convertedRate is the USD figure), so its
        // symbol is always "$", not the Strike account currency — same fix as
        // the Bark card below.
        COINOS: { key: 'coinos', component: () => <CoinosWallet balance={balance} convertedRate={convertedRate} currency="USD" isLoading={isLoading} matchedRate={matchedRate} refRBSheet={refRBSheet} refSendRBSheet={refSendRBSheet} setReceiveType={setReceiveType} wallet={wallet} homeNotice={homeNotice} hideActionButtons={useSharedButtons}/> },
        STRIKE: { key: 'strike', component: () => <StrikeWallet currency={currencyStrike} isLoading={isLoading} matchedRateStrike={matchedRateStrike} strikeConvertedBalance={strikeConvertedBalance} refRBSheet={refRBSheet} refSendRBSheet={refSendRBSheet} setReceiveType={setReceiveType} strikeBalance={strikeBalance} homeNotice={homeNotice} hideActionButtons={useSharedButtons}/> },
        // Ark-only users (no Lightning) keep the in-card Receive/Send pair
        // because `useSharedButtons` is false in that case. When Lightning
        // and Ark are both connected, all internal pairs are suppressed and
        // a single shared pair rendered outside the carousel takes over —
        // see the Animated.View below the <Carousel>.
        ARK: {
            key: 'ark',
            // Wrap with a marginTop View so the Strike+Ark combo can nudge
            // the Ark card 10pt down without also moving the Strike card —
            // see `arkCardExtraOffsetPt` rationale above. marginTop=0 in
            // every other combo collapses to a no-op wrapper.
            component: () => (
                <View style={{ marginTop: arkCardExtraOffsetPt }}>
                    <ArkWallet
                        convertedRate={convertedRate}
                        // Bark is USD-denominated (arkConvertedRate uses the USD
                        // oracle), so its symbol is always "$", never the Strike
                        // account currency — passing `currency` here showed a EUR
                        // symbol on a USD number for European Strike accounts, and
                        // kept it after Strike logout until relaunch.
                        currency="USD"
                        isLoading={isLoading}
                        matchedRate={matchedRate}
                        refRBSheet={refRBSheet}
                        refSendRBSheet={refSendRBSheet}
                        setReceiveType={setReceiveType}
                        homeNotice={homeNotice}
                        hideActionButtons={useSharedButtons}
                    />
                </View>
            ),
        },
    };


    // Shared Receive/Send handlers — used by the single shared pair when
    // both Lightning and Ark are connected. Both kinds route through the
    // same RBSheets the inner wallet cards used pre-shared-row, so existing
    // send/receive flows are unchanged regardless of whether the active
    // slide is lightning or ark.
    const sharedReceive = () => {
        setReceiveType?.(true);
        refRBSheet?.current?.open();
    };
    const sharedSend = () => {
        refSendRBSheet?.current?.open();
    };

    // Slide template — pure passthrough. We deliberately do NOT lock the
    // slide height here. Earlier I tried `height: SHARED_SLIDE_HEIGHT` to
    // make the fiat slide fit within a 133-tall slot (so the carousel
    // wouldn't stretch and pull the shared buttons down with it), but
    // iOS's native ScrollView clips children to its frame — so the fiat
    // card got chopped in half. Instead the carousel auto-sizes to fiat's
    // natural height and the shared button row is positioned absolutely
    // at the lightning/ark card bottom (see the Animated.View further
    // down). The empty space inside the lightning/ark slides above the
    // buttons is invisible (just card + transparent area).
    //
    // Two-View nesting (FlatList migration): the outer View is exactly
    // screenWidth so FlatList's `snapToInterval={screenWidth}` snaps each
    // slide to the page boundary. The inner 0.905 wrapper preserves the
    // visual sizing the snap-carousel `itemWidth=screenWidth` +
    // inactiveSlideScale=0.94 used to produce. Mirrors BottomBar's
    // FlatList renderItem after the same migration.
    const SHARED_SLIDE_HEIGHT = 133;
    // Per-page visibility for the balance-fill animations: FlatList keeps
    // neighbor pages mounted, so without this the eased threshold fills
    // (Card / StrikeWallet / CircleTimer via useEasedProgress) animate
    // while their page is off screen and the user never sees the sweep.
    const renderWalletItem = ({ item, index }: any) => (
        <View style={{ width: screenWidth }}>
            <View style={{ width: screenWidth * 0.905 }}>
                <CarouselPageVisibilityContext.Provider value={index === indexStrike}>
                    {item.component()}
                </CarouselPageVisibilityContext.Provider>
            </View>
        </View>
    );

    // Scroll-position-driven animation for the shared button row.
    //
    // Why scroll position and not snap events: snap-carousel only updates
    // `indexStrike` at the moment it commits to a snap (release moment),
    // not while the user is dragging. An effect keyed off `indexStrike`
    // therefore starts its animation AFTER the user lifts their finger,
    // by which point the cards have already moved. Bam saw the row pop in
    // ~220ms after the swipe finished.
    //
    // The fix is to bind the row's translateX/opacity directly to the
    // carousel's continuous scroll offset, so the row tracks the cards
    // frame-for-frame during the drag itself.
    //
    // snap-carousel v4 cooperates: when we pass an Animated.event whose
    // `_argMapping` writes into a shared `scrollX`, its `_setScrollHandler`
    // (Carousel.tsx ~L304) detects our argMapping and reuses our value as
    // its internal `_scrollPos`. Both the carousel's own animations and
    // our row read from the same native-driven value — no JS-thread hops,
    // no lag.
    // Seed scrollX to match the carousel's restored page on mount. Without
    // this, scrollX starts at 0 (fiat-offset) even when the FlatList is
    // restored to lightning via initialScrollIndex, causing the
    // native-driven translateX/opacity to lag the actual scroll position.
    const scrollX = useRef(new Animated.Value(tabOffset(indexStrike, wTabs.length))).current;
    const scrollHandler = useRef(
        Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: true }
        )
    ).current;

    // Resync scrollX on focus restore. Symptom this fixes: navigating away
    // from HomeScreen and back, then tapping the shared Receive/Send/Swap
    // row, did nothing. Swiping to another wallet card and back made the
    // taps work again.
    //
    // Cause: the row's translateX/opacity are driven by scrollX via
    // Animated.event with useNativeDriver:true. On a normal swipe, native
    // onScroll updates scrollX, native render moves the row, JS layout
    // tracks. On focus restore, the FlatList's initialScrollIndex jumps
    // the carousel visually but under RN 0.77 Fabric this jump doesn't
    // always fire a native onScroll, so scrollX drifts out of sync with
    // the actual page. The native transform then puts the row at one
    // pixel position while RN's JS-thread hit-testing thinks it's at
    // another — taps land on empty space.
    //
    // The first manual swipe fires real native onScroll events that
    // rewrite scrollX, which is why the workaround (swipe away and back)
    // works.
    useFocusEffect(useCallback(() => {
        scrollX.setValue(tabOffset(indexStrike, wTabs.length));
    }, [indexStrike, wTabs.length, scrollX]));

    // Find the fiat slide and the lightning slide in `wTabs`. The
    // interpolation is anchored on the fiat → lightning transition; ark is
    // intentionally outside the inputRange so once scrollX passes the
    // lightning offset, the row stays clamped at `translateX:0, opacity:1`
    // (i.e. fixed for lightning ↔ ark swipes).
    //
    // For Coinos+Ark configs (no Strike → no fiat slide), there's no
    // transition at all — the row is always visible. We still build a
    // valid interpolation (degenerate ranges throw) by feeding sentinel
    // values and constant outputRanges.
    const fiatIdx = wTabs.findIndex((t: any) => kindFromTab(t) === 'fiat');
    const lightningIdx = wTabs.findIndex((t: any) => kindFromTab(t) === 'lightning');
    const hasFiatTransition = fiatIdx >= 0 && lightningIdx >= 0 && lightningIdx > fiatIdx;
    const fiatOffset = hasFiatTransition ? tabOffset(fiatIdx, wTabs.length) : 0;
    const lightningOffset = hasFiatTransition ? tabOffset(lightningIdx, wTabs.length) : screenWidth;
    // where the lightning card sits while fiat is centered: one screen to the right, or to the left in RTL, where the
    // pages run the other way
    const lightningSideX = I18nManager.isRTL ? -screenWidth : screenWidth;

    // When fiat is centered (scrollX = fiatOffset): row sits at
    // lightningSideX, off the edge — same place the lightning
    // card sits at that moment. As scrollX moves toward
    // lightningOffset, both card and row glide in to 0 in
    // lockstep. Past lightning (toward ark), `extrapolate:'clamp'`
    // pins the row at 0.
    const buttonsTranslateX = scrollX.interpolate(
        between(fiatOffset, lightningOffset, hasFiatTransition ? lightningSideX : 0, 0),
    );
    const buttonsOpacity = scrollX.interpolate(
        between(fiatOffset, lightningOffset, hasFiatTransition ? 0 : 1, 1),
    );

    // Ark-anchored opacity for the Ark-specific notices that sit below
    // the shared Send/Receive row (the notice icon slot). Previously these
    // rendered conditionally
    // on `kindFromTab(wTabs[indexStrike]) === 'ark'`, which only flipped
    // at the snap end — so they'd ABRUPTLY appear/disappear as the user
    // slid into/out of the Ark card. Now driven by scrollX so they
    // smoothly fade in as the Ark card enters view and fade out as it
    // leaves. Anchored on the previous-slide → Ark transition; clamped
    // outside so the row sits fully invisible past the leftward edge of
    // the Ark slide.
    const arkIdxForFade = wTabs.findIndex((t: any) => kindFromTab(t) === 'ark');
    const arkOffsetForFade = arkIdxForFade >= 0 ? tabOffset(arkIdxForFade, wTabs.length) : 0;
    const prevArkOffsetForFade = arkIdxForFade > 0
        ? tabOffset(arkIdxForFade - 1, wTabs.length)
        : arkOffsetForFade;
    const arkReminderOpacity = scrollX.interpolate(
        arkIdxForFade > 0
            ? between(prevArkOffsetForFade, arkOffsetForFade, 0, 1)
            : { inputRange: [arkOffsetForFade, arkOffsetForFade + 1], outputRange: [1, 1], extrapolate: 'clamp' },
    );

    if (__DEV__) console.log('allBTCWallets: ', allBTCWallets, wTabs)
    // BUTTON_ROW_HEIGHT ≈ GradientButtonWithShadow's rendered height (47).
    // Used both to position the row vertically and to reserve layout space
    // beneath the carousel for configs without a fiat slide (Coinos+Ark)
    // where the carousel auto-sizes to the short lightning/ark card.
    const BUTTON_ROW_HEIGHT = 47;
    // Single custodial Lightning (Coinos XOR Strike) + Ark renders as 2 plain
    // boxes, not the circular 2-custodial shape, so the gap reserved below the
    // card is excess for this combo. Pull the shared Receive/Send row up to hug
    // the card bottom here only. minHeight below stays on BUTTONS_TOP_BASE so
    // ONLY the buttons rise — the vault block underneath keeps its position.
    const custodialCount =
        ((allBTCWallets as string[]).includes('STRIKE') ? 1 : 0) +
        ((allBTCWallets as string[]).includes('COINOS') ? 1 : 0);
    const oneCustodialPlusArk = custodialCount === 1 && hasArkWallet;
    const BUTTONS_TOP_BASE = SHARED_SLIDE_HEIGHT + 20; // 153 — row 20pt below the card
    // One custodial provider + Ark renders 2 plain boxes, and the row used to be
    // pulled up to +12 to hug the card bottom. Measured on device that landed the
    // row 7pt under the card (card 287-420, row 427), tight enough to read as
    // stuck to the buttons. +23 puts ~18pt between them.
    // CoinOS + Strike + Ark: the two carousel pages are different heights (the
    // Strike/Coinos CircularView is 156, the Ark card 133), so one row position
    // cannot sit the same distance under both. Measured on device with the cluster
    // lifted: Ark card bottom 417, CircularView labels ~412. +8 over the base puts
    // ~18pt under the Ark card, matching the one-custodial combo, and a little more
    // under the taller circular page.
    const allThreeWallets = custodialCount === 2 && hasArkWallet;
    // iOS values were measured on an iPhone; Android composes the carousel at a
    // different height, so it keeps exactly the expression it shipped with in
    // 0.1.10. Do not collapse these without measuring on an Android device.
    const BUTTONS_TOP = Platform.OS === 'ios'
        ? (oneCustodialPlusArk ? SHARED_SLIDE_HEIGHT + 23 : allThreeWallets ? BUTTONS_TOP_BASE + 8 : BUTTONS_TOP_BASE)
        : (oneCustodialPlusArk ? SHARED_SLIDE_HEIGHT + 12 : BUTTONS_TOP_BASE);

    // Cancels the wedged round(s) to unlock the VTXOs; the next sync
    // re-detects if still stuck. Near expiry, refreshing is stuck AND the
    // funds are running out, so it routes to the "move your funds out" screen
    // rather than the in-place cancel-and-retry.
    const recoverStuckRefresh = () => {
        const stuck = useAuthStore.getState().arkRefreshStuck;
        if (!stuck) return;
        if (stuck.nearExpiry) {
            dispatchNavigate('ArkStuckCapsuleScreen', {});
            return;
        }
        (async () => {
            for (const roundId of stuck.stuckRoundIds) {
                try {
                    await cancelArkPendingRound(roundId);
                } catch {
                    // cancelArkPendingRound logs the inner BarkError
                }
            }
            useAuthStore.getState().setArkRefreshStuck(null);
        })();
    };

    // Everything the shared row's notice slot shows, on the Bark page. A stuck
    // round, then a round in flight, keep the slot to themselves as before:
    // stuck is the escalation of the round in flight, so the two never show
    // together, and while a round runs the numbers the status notices read are
    // in motion. Otherwise the iOS re-export reminder, then the status notices.
    const sharedArkNotices: HomeNotice[] = arkRefreshStuck
        ? [{
            // Red: never ignorable. A wedged round can strand funds.
            id: 'ark-refresh-stuck',
            severity: 'red',
            icon: 'alert-circle',
            situation: '',
            text: String(arkRefreshStuck.nearExpiry
                ? loc.formatString(loc.cypherbox.home_lists.wallets_view.refresh_stuck_near_expiry, { sats: arkRefreshStuck.stuckSats.toLocaleString() })
                : loc.formatString(loc.cypherbox.home_lists.wallets_view.refresh_stuck, { sats: arkRefreshStuck.stuckSats.toLocaleString() })),
            onPress: recoverStuckRefresh,
        }]
        : arkRefreshInFlight
            ? [{
                // The same wait banner the Capsules tab shows, `compact`. Its
                // stuck state routes to the Capsules tab, where Cancel lives.
                // Back after Ignore with the next round.
                id: 'ark-refresh-wait',
                severity: 'yellow',
                icon: 'hourglass-outline',
                situation: String(arkRoundStarts.length > 0 ? Math.min(...arkRoundStarts) : 0),
                accessibilityLabel: loc.cypherbox.ark?.refresh_banner?.come_back,
                content: (
                    <RefreshWaitBanner
                        compact
                        roundStarts={arkRoundStarts}
                        cancelling={false}
                        onCancel={() => openArkTab(0)}
                    />
                ),
            }]
            : [
                ...(iosBackupReminderVisible
                    ? [{
                        // Funds-safety nudge: the user can lose funds if they
                        // uninstall before re-exporting. Back after Ignore with
                        // the next backup, which follows a receive.
                        id: 'ark-backup-sync',
                        severity: 'yellow' as const,
                        icon: 'cloud-upload-outline',
                        situation: String(arkLastBackupAt ?? 0),
                        text: loc.cypherbox.home_lists.wallets_view.reexport_backup,
                        onPress: () => openArkTab(3), // Settings tab: dismiss + re-export
                    }]
                    : []),
                ...arkStatusNotices,
            ];

    // The notice slot's share of the container. 32pt holds the icon row, as it
    // held the one-line notice before, so nothing moves while messages are
    // closed. An open message (or a second row of icons) reserves its measured
    // height plus the slot's offset below the base, so it pushes BottomBar
    // down rather than covering Top-up/Withdraw.
    const sharedNoticesReserve = sharedNoticesHeight > 32
        ? sharedNoticesHeight + 8 + (BUTTONS_TOP - BUTTONS_TOP_BASE)
        : 32;

    return (
        <View style={{
            width: screenWidth,
            // When shared buttons are on, ensure the WalletsView container
            // is at least tall enough to hold the absolutely-positioned
            // button row below the carousel. For configs with the fiat
            // slide (Strike+Ark), the carousel auto-sizes to fiat (~230pt)
            // which is already taller than this minHeight, so this is a
            // no-op there. For Coinos+Ark (no fiat slide), the carousel
            // is only 133pt and without this minHeight the buttons would
            // render outside WalletsView's measured bounds, overlapping
            // BottomBar. minHeight = card + gap + buttons = 133+10+47=190.
            // Always reserve the ~32pt below the button row for the notice
            // icon slot, whether or not any notice shows. Without this, the
            // slot collapses to 0 when the wallet is in the healthy state
            // and the section below the carousel (vault recover row / Hot
            // Vault tile) jumps up against the buttons.
            // An open notice message grows it (sharedNoticesReserve).
            // Don't gate on which slide is active — keeping the container
            // size stable across swipes avoids layout jitter when the
            // user pages between Ark and Lightning.
            ...(useSharedButtons ? { minHeight: BUTTONS_TOP_BASE + BUTTON_ROW_HEIGHT + sharedNoticesReserve } : {}),
        }}>
            <Animated.FlatList
                ref={flatListRef}
                // Remount the list whenever the page COMPOSITION changes
                // (login/logout adds or removes pages). A mounted FlatList
                // whose data grows while initialScrollIndex points past page
                // 0 hits the classic virtualizer bug: the render window
                // anchors against the old content and the list draws ZERO
                // cells (verified via uiautomator on the A14 after a Strike
                // login grew the carousel 2 -> 3 pages: the scroller kept
                // its full size but had no children, so swiping was a no-op
                // on 0-wide content). The key string only changes when the
                // tab keys change (wTabs is rebuilt every balance tick with
                // identical keys), so routine ticks never remount; a fresh
                // mount sees the final data + getItemLayout and honours
                // initialScrollIndex correctly.
                key={`wallet-carousel-${wTabs.map((t: any) => t.key).join('|')}`}
                data={wTabs}
                keyExtractor={(_: any, i: number) => `wallet-tab-${i}`}
                renderItem={renderWalletItem}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                // FlatList equivalent of snap-carousel's slot sizing. Each
                // page is exactly screenWidth (set in renderWalletItem's
                // outer wrapper); snapToInterval makes the scroller commit
                // to that boundary. disableIntervalMomentum prevents the
                // user from skipping a page on a fast flick, matching the
                // page-by-page semantics of the old Carousel.
                snapToInterval={screenWidth}
                decelerationRate="fast"
                disableIntervalMomentum
                initialScrollIndex={indexStrike}
                getItemLayout={(_: any, i: number) => ({
                    length: screenWidth,
                    offset: screenWidth * i,
                    index: i,
                })}
                // Safety net for initialScrollIndex / snapTo racing layout:
                // fall back to a raw offset scroll (always valid with fixed
                // page widths) instead of silently leaving the list blank.
                onScrollToIndexFailed={(info: { index: number }) => {
                    flatListRef.current?.scrollToOffset?.({
                        offset: screenWidth * info.index,
                        animated: false,
                    });
                }}
                // Drive scrollX from the native-driven Animated.event so
                // the shared button row's translateX/opacity track the
                // cards frame-for-frame during the drag — the same
                // continuous-scroll trick we relied on with snap-carousel,
                // now expressed in vanilla FlatList terms.
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                // FlatList lacks the snap-carousel `onBeforeSnapToItem`
                // mid-gesture commit hook; onMomentumScrollEnd is the
                // closest equivalent and fires once per page commit.
                onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                    const next = pageToTab(Math.round(e.nativeEvent.contentOffset.x / screenWidth), wTabs.length);
                    if (next === indexStrike) return;
                    setIndexStrike(next);
                    setWalletTab(next === 1);
                    onPageChange?.(next, wTabs.length, wTabs.map(kindFromTab));
                }}
            />
            {/* Shared Receive/Send pair. Lives outside the carousel so it
                doesn't translate with the cards during lightning ↔ ark
                swipes (Bam: "fixed below stike or coinos and not slidable
                to the right"). When swiping toward the fiat balance the
                row animates out via translateX/opacity (Bam: "they should
                also be dynamic if user wants to go left to the fiat
                balance").
                Only renders when both Lightning and Ark are connected —
                single-wallet users still see the in-card pair via each
                wallet component's own button row. */}
            {useSharedButtons && (
                <Animated.View
                    // pointerEvents follows the resting active slide. While
                    // the user is dragging from fiat → lightning, the row
                    // is still mostly invisible/off-screen and shouldn't
                    // intercept taps; `indexStrike` is updated on
                    // `onBeforeSnapToItem` (release moment), which is the
                    // earliest a tap could land anyway, so this stays in
                    // sync with what's visually tappable.
                    pointerEvents={kindFromTab(wTabs[indexStrike]) === 'fiat' ? 'none' : 'auto'}
                    style={{
                        // Absolute positioning so the row sits at the
                        // lightning/ark card bottom (y = 143) regardless of
                        // the carousel's actual height — which is fiat-tall
                        // (~230pt) when the fiat slide is in the carousel.
                        // Without absolute positioning the row landed at the
                        // carousel's bottom (= fiat-bottom), which Bam saw
                        // as "50pt below the lightning/ark cards." Fiat
                        // content fills the carousel's tall area; when it's
                        // active the row is animated off-screen so they
                        // don't visually collide. When lightning/ark is
                        // active their card occupies the top 128–133pt and
                        // the rest of the slide is empty space — this row
                        // sits in that empty space, just below the card.
                        position: 'absolute',
                        top: BUTTONS_TOP,
                        left: 0,
                        // `right: 40` rather than `0` because WalletsView's
                        // outer container has an explicit `width: screenWidth`
                        // while HomeScreen's parent container has
                        // `paddingHorizontal: 20`. That makes WalletsView
                        // overflow the padded content area by 20pt on the
                        // right. With `right: 0` the row inherited that
                        // overflow and the Send button extended past the
                        // screen edge. The BottomBar's TopUpWithdraw row
                        // (rendered without explicit width) naturally fits
                        // inside the padded `screenWidth - 40` content area,
                        // so we mirror that here: width = screenWidth - 40,
                        // anchored to the same left/right pixel positions.
                        right: 40,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        opacity: buttonsOpacity,
                        transform: [{ translateX: buttonsTranslateX }],
                    }}>
                    <GradientButtonWithShadow
                        title={loc.cypherbox.home_lists.wallets_view.receive}
                        onPress={sharedReceive}
                        isShadow
                        isTextShadow
                    />
                    {/* Swap icon between Receive and Send (Lightning↔Ark).
                        Suppressed entirely when all three Lightning rails
                        (Strike + CoinOS + Ark) are connected — Bam asked
                        for it gone on both the CircularView slide AND the
                        Ark slide in that combo. For Strike+Ark-only and
                        CoinOS+Ark-only configs the swap stays here, since
                        those slides have no internal swap of their own. */}
                    {!allThreeLightningRails && (
                        <TouchableOpacity
                            onPress={() => refSwapRBSheet?.current?.open()}
                            style={{ alignItems: 'center', justifyContent: 'center', width: 40, height: 40 }}
                        >
                            <Image source={Refresh} style={{ width: 18, height: 29 }} />
                        </TouchableOpacity>
                    )}
                    <GradientButtonWithShadow
                        title={loc.cypherbox.home_lists.wallets_view.send}
                        onPress={sharedSend}
                        isShadow
                        isTextShadow
                    />
                </Animated.View>
            )}
            {/* The Bark notices as a row of coloured icons (components/HomeNotices),
                in the slot below the shared Send/Receive row, with the Bark page
                only: opacity follows scrollX so they fade in and out with the
                card, and taps pass through while another page is up. An open
                message's height is reserved in minHeight above, so it pushes
                Top-up/Withdraw down instead of covering them. */}
            {useSharedButtons && (
                <Animated.View
                    pointerEvents={kindFromTab(wTabs[indexStrike]) === 'ark' ? 'auto' : 'none'}
                    style={{
                        position: 'absolute',
                        top: BUTTONS_TOP + BUTTON_ROW_HEIGHT + 8,
                        left: 0,
                        // `right: 40`, as for the button row above: WalletsView
                        // is screenWidth wide inside HomeScreen's 20pt padding.
                        right: 40,
                        opacity: arkReminderOpacity,
                    }}
                >
                    <HomeNotices
                        notices={sharedArkNotices}
                        // A message left open on the Bark page closes when the
                        // carousel moves on, and its reserved height with it.
                        closeKey={indexStrike}
                        onLayout={(e) => setSharedNoticesHeight(e.nativeEvent.layout.height)}
                    />
                </Animated.View>
            )}
        </View>
    );
});

export default WalletsView;
