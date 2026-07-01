import { ArkWallet, CircularView, CoinosWallet, GradientButtonWithShadow, StrikeDollarWallet, StrikeWallet } from "@Cypher/components";
import { Text } from "@Cypher/component-library";
import { Refresh } from "@Cypher/assets/images";
import { ARK_VTXO_DUST_SATS, FEATURE_ARK_ENABLED, areBgNotificationsEnabled, blocksToDays } from "@Cypher/services/ark";
import useAuthStore from "@Cypher/stores/authStore";
import screenWidth from "@Cypher/style-guide/screenWidth";
import { colors } from "@Cypher/style-guide";
import { dispatchNavigate } from "@Cypher/helpers";
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Animated, AppState, FlatList, Image, NativeScrollEvent, NativeSyntheticEvent, Platform, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

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
    homeMessage?: string | null;
    /** Fires when the active carousel page changes. Used by BalanceView to render the page indicator (dots colored per wallet kind). */
    onPageChange?: (index: number, total: number, kinds: Array<'fiat' | 'lightning' | 'ark'>) => void;
}

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
    homeMessage = null,
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
        arkChainTipHeight,
        arkBgRefreshEnabled,
        arkBgRefreshLastSuccessAt,
        arkBgRefreshLastAttempt,
        arkIosBackupReminderActive,
    } = useAuthStore();

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
     * Status line shown below the shared Send/Receive row when the user has
     * opted into background refresh. Lives here (rather than only in
     * ArkWallet) because the shared row is absolutely positioned over
     * ArkWallet's natural alert area, and a banner inside the card would
     * sit BEHIND the buttons. Mirrors ArkWallet's bgRefreshStatus shape so
     * the two surfaces speak the same UX language.
     */
    /**
     * iOS-only: surface the Ark backup-snapshot reminder when the user
     * created the wallet via the manual share+confirm path and hasn't yet
     * confirmed iCloud Drive is on for Cypher Box. The same flag is shown
     * as a full action card in Settings → Ark Backup; here on the home
     * carousel we only render a compact tap-target so users notice it
     * outside the settings detour. Tap → opens the Ark settings tab where
     * the dismiss + re-export actions live.
     *
     * Takes precedence over bgRefreshStatus in the same absolute slot:
     * the bg-refresh status is informational ("last refresh 5m ago"), the
     * backup reminder is a funds-safety nudge — only one fits cleanly in
     * the slot below the shared Send/Receive row, so the higher-stakes
     * one wins. bg-refresh status keeps showing on Android (where the
     * iOS reminder is never active) and on iOS users who've dismissed.
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
            if (v.state.toLowerCase() === 'locked') continue;
            const blocks = v.expiryHeight - arkChainTipHeight;
            if (blocks < minBlocks) minBlocks = blocks;
        }
        if (!isFinite(minBlocks)) return null;
        return Math.max(0, blocksToDays(minBlocks));
    }, [arkVtxos, arkChainTipHeight]);

    const expiryWarning = soonestDaysLeft !== null && soonestDaysLeft < 7
        ? `Oldest capsule expires in ${Math.round(soonestDaysLeft)}d — refresh soon`
        : null;

    // Count of dust capsules (≤ ARK_VTXO_DUST_SATS = 330 sats) that are
    // still spendable and haven't expired. These can't be refreshed
    // individually (refresh fee > capsule value) — only batch refresh on
    // the Capsules tab consolidates them into above-dust outputs.
    const dustCapsuleCount = useMemo(() => {
        if (!arkVtxos || arkChainTipHeight == null) return 0;
        let count = 0;
        for (const v of arkVtxos) {
            if (v.sats > ARK_VTXO_DUST_SATS) continue;
            if (v.state.toLowerCase() !== 'spendable') continue;
            if (v.expiryHeight === 0) continue;
            const blocks = v.expiryHeight - arkChainTipHeight;
            if (blocks <= 0) continue;
            count++;
        }
        return count;
    }, [arkVtxos, arkChainTipHeight]);

    // VTXOs currently mid-round (state === 'locked' — refresh / send / board
    // in flight). The headline balance EXCLUDES these (only spendable
    // capsules count), so without surfacing this the user sees their
    // balance drop with no explanation while a refresh is in progress.
    const pendingRound = useMemo(() => {
        if (!arkVtxos) return { count: 0, sats: 0 };
        let count = 0;
        let sats = 0;
        for (const v of arkVtxos) {
            if (v.state.toLowerCase() !== 'locked') continue;
            count++;
            sats += v.sats;
        }
        return { count, sats };
    }, [arkVtxos]);

    /**
     * Unified status line for the shared Send/Receive row's status slot.
     * Priority chain (top wins, all red except the all-clear "Auto-refresh:
     * on" in green). Mirrors the same shape as ArkWallet's bgRefreshStatus
     * — same priorities, same wording — so a user switching between the
     * single-Ark layout (in-card status from ArkWallet) and the multi-
     * wallet layout (shared-row status from here) sees consistent copy.
     *
     * Status can optionally carry:
     *   - linkText: a substring of `text` to render underlined as a tap-
     *     target hint (e.g. "here" on the dust-batch nudge).
     *   - tapTab: optional initial tab index to deep-link to when the
     *     user taps the pill. Defaults to the Account tab (0); the dust
     *     warning passes 1 (Capsules) to land on the batch-refresh UI.
     */
    // Mirrors ArkWallet's bgRefreshStatus, plus the same notifications-off
    // probe replaces the v0.1.1-dropped auto-refresh branches.
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

    const bgRefreshStatus = useMemo(() => {
        // Refresh in flight: short-circuit to all-clear. The Ark Card
        // itself surfaces the live "Refreshing N capsules · X sats" line
        // inside its balance area (see Card's `refreshingInfo` prop) so
        // a duplicate message in the shared-row status pill would be
        // redundant.
        if (pendingRound.count > 0) {
            return null;
        }

        // (Removed v0.1.1) Auto-refresh failure branch — see ArkWallet
        // for the rationale. FGS_DATA_SYNC dropped, no auto-refresh
        // subsystem to fail.

        if (dustCapsuleCount > 0) {
            return {
                text: 'Attention: you have dust ark capsules that cannot be refreshed and might expire. Batch refresh them here.',
                linkText: 'here',
                tapTab: 0, // Capsules tab (Ark's first tab, post-reorder)
                error: true,
            };
        }

        if (expiryWarning) {
            return { text: expiryWarning, error: true };
        }

        // Notifications-off branch replaces the v0.1.1-dropped
        // "Auto-refresh: off" branch. The 5 capsule-expiry warning
        // notifications are now the only sync-cadence safety net, so a
        // revoked OS permission is the equivalent loss of protection.
        if (notificationsEnabled === false) {
            return {
                text: 'Notifications off. Capsules can expire without warning. Enable in Settings.',
                error: true,
            };
        }

        if (Platform.OS === 'ios' && arkIosBackupReminderActive) {
            return {
                text: 'Backup not synced — enable iCloud Drive in iOS Settings',
                error: true,
            };
        }

        return null;
    }, [
        expiryWarning,
        dustCapsuleCount,
        notificationsEnabled,
        arkIosBackupReminderActive,
        pendingRound,
    ]);

    const [indexStrike, setIndexStrike] = useState(0);
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
        const custodialLightning = (allBTCWallets as WalletName[]).filter(
            w => w === 'STRIKE' || w === 'COINOS'
        );
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
        // The carousel's `firstItem` prop is only respected on the Carousel
        // component's *initial mount*. Because we render the Carousel before
        // wTabs is populated (it starts as []), the Carousel mounts with
        // firstItem=0 and ignores any later bump — so even if we set
        // defaultIndex=1 here, the visible slide stays at index 0 on first
        // login, while our state + the page indicator claimed index 1. That
        // mismatch is the bug Bam saw: indicator on the middle line, but the
        // fiat card actually showing.
        //
        // Easiest fix that keeps the existing render order: align the state
        // with what the carousel actually shows — start on index 0 (fiat
        // when Strike is connected, CircularView's left neighbour when both
        // custodial providers are connected). Swiping left advances to the
        // BTC card, exactly the same gesture as before; only the *initial*
        // landing slide changes. The indicator now correctly points at the
        // left line on first login and tracks swipes from there.
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
                        homeMessage={homeMessage}
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

        setIndexStrike(defaultIndex);
        setWTabs(tabs);
        onPageChange?.(defaultIndex, tabs.length, tabs.map(kindFromTab));
    }, [allBTCWallets, isLoading, matchedRateStrike, strikeBalance, convertedRate]);

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
        COINOS: { key: 'coinos', component: () => <CoinosWallet balance={balance} convertedRate={convertedRate} currency={currency} isLoading={isLoading} matchedRate={matchedRate} refRBSheet={refRBSheet} refSendRBSheet={refSendRBSheet} setReceiveType={setReceiveType} wallet={wallet} homeMessage={homeMessage} hideActionButtons={useSharedButtons}/> },
        STRIKE: { key: 'strike', component: () => <StrikeWallet currency={currencyStrike} isLoading={isLoading} matchedRateStrike={matchedRateStrike} strikeConvertedBalance={strikeConvertedBalance} refRBSheet={refRBSheet} refSendRBSheet={refSendRBSheet} setReceiveType={setReceiveType} strikeBalance={strikeBalance} homeMessage={homeMessage} hideActionButtons={useSharedButtons}/> },
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
                        currency={currency}
                        isLoading={isLoading}
                        matchedRate={matchedRate}
                        refRBSheet={refRBSheet}
                        refSendRBSheet={refSendRBSheet}
                        setReceiveType={setReceiveType}
                        homeMessage={homeMessage}
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
    const renderWalletItem = ({ item }: any) => (
        <View style={{ width: screenWidth }}>
            <View style={{ width: screenWidth * 0.905 }}>
                {item.component()}
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
    const scrollX = useRef(new Animated.Value(indexStrike * screenWidth)).current;
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
        scrollX.setValue(indexStrike * screenWidth);
    }, [indexStrike, scrollX]));

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
    const fiatOffset = hasFiatTransition ? fiatIdx * screenWidth : 0;
    const lightningOffset = hasFiatTransition ? lightningIdx * screenWidth : screenWidth;

    const buttonsTranslateX = scrollX.interpolate({
        inputRange: [fiatOffset, lightningOffset],
        // When fiat is centered (scrollX = fiatOffset): row sits at
        // +screenWidth, off the right edge — same place the lightning
        // card sits at that moment. As scrollX grows toward
        // lightningOffset, both card and row glide leftward to 0 in
        // lockstep. Past lightning (toward ark), `extrapolate:'clamp'`
        // pins the row at 0.
        outputRange: hasFiatTransition ? [screenWidth, 0] : [0, 0],
        extrapolate: 'clamp',
    });
    const buttonsOpacity = scrollX.interpolate({
        inputRange: [fiatOffset, lightningOffset],
        outputRange: hasFiatTransition ? [0, 1] : [1, 1],
        extrapolate: 'clamp',
    });

    // Ark-anchored opacity for the Ark-specific reminders/warnings that
    // sit below the shared Send/Receive row (iOS backup pill,
    // bgRefreshStatus banner). Previously these rendered conditionally
    // on `kindFromTab(wTabs[indexStrike]) === 'ark'`, which only flipped
    // at the snap end — so they'd ABRUPTLY appear/disappear as the user
    // slid into/out of the Ark card. Now driven by scrollX so they
    // smoothly fade in as the Ark card enters view and fade out as it
    // leaves. Anchored on the previous-slide → Ark transition; clamped
    // outside so the row sits fully invisible past the leftward edge of
    // the Ark slide.
    const arkIdxForFade = wTabs.findIndex((t: any) => kindFromTab(t) === 'ark');
    const arkOffsetForFade = arkIdxForFade >= 0 ? arkIdxForFade * screenWidth : 0;
    const prevArkOffsetForFade = arkIdxForFade > 0
        ? (arkIdxForFade - 1) * screenWidth
        : arkOffsetForFade;
    const arkReminderOpacity = scrollX.interpolate({
        inputRange: arkIdxForFade > 0
            ? [prevArkOffsetForFade, arkOffsetForFade]
            : [arkOffsetForFade, arkOffsetForFade + 1],
        outputRange: arkIdxForFade > 0 ? [0, 1] : [1, 1],
        extrapolate: 'clamp',
    });

    const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const next = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
        if (next !== indexStrike) {
            setIndexStrike(next);
            setWalletTab(next === 1);
        }
    };

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
    const BUTTONS_TOP = oneCustodialPlusArk ? SHARED_SLIDE_HEIGHT + 12 : BUTTONS_TOP_BASE; // combo: row sits ~12pt below the card (some breathing room, less than the 20pt base)
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
            // Always reserve the ~32pt below the button row for the bg-
            // refresh status slot, regardless of whether bgRefreshStatus
            // is currently truthy. Without this, the slot collapses to 0
            // when the wallet is in the healthy state (bgRefreshStatus
            // returns null) and the section below the carousel (vault
            // recover row / Hot Vault tile) jumps up against the buttons.
            // The 56pt iOS-backup-reminder slot still wins when active.
            // Don't gate on which slide is active — keeping the container
            // size stable across swipes avoids layout jitter when the
            // user pages between Ark and Lightning.
            ...(useSharedButtons ? { minHeight: BUTTONS_TOP_BASE + BUTTON_ROW_HEIGHT + (iosBackupReminderVisible ? 56 : 32) } : {}),
        }}>
            <Animated.FlatList
                ref={flatListRef}
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
                    const next = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
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
                        title="Receive"
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
                        title="Send"
                        onPress={sharedSend}
                        isShadow
                        isTextShadow
                    />
                </Animated.View>
            )}
            {/* iOS backup-snapshot reminder — funds-safety nudge for users
                who satisfied the create-flow gate via manual share+confirm
                without iCloud Drive verified. Takes the same absolute slot
                as bgRefreshStatus and wins priority when both apply: the
                user can lose funds if they uninstall before re-exporting,
                whereas the bg-refresh status is informational. Tap → Ark
                settings tab, where the dismiss + re-export actions live. */}
            {useSharedButtons && iosBackupReminderVisible && (
                <Animated.View
                    pointerEvents={kindFromTab(wTabs[indexStrike]) === 'ark' ? 'auto' : 'none'}
                    style={{
                        position: 'absolute',
                        top: BUTTONS_TOP + BUTTON_ROW_HEIGHT + 8,
                        left: 16,
                        right: 16,
                        // Drive visibility from scrollX so the pill fades in/out
                        // as the Ark card slides into/out of view (was an
                        // abrupt mount on indexStrike change before).
                        opacity: arkReminderOpacity,
                    }}
                >
                    <TouchableOpacity
                        onPress={() => dispatchNavigate("CheckingAccountNew", { wallet: arkWallet, accountType: "ark", initialTab: 3 })}
                        activeOpacity={0.7}
                        style={{
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            borderRadius: 8,
                            backgroundColor: 'rgba(251, 146, 60, 0.10)',
                            borderWidth: 1,
                            borderColor: 'rgba(251, 146, 60, 0.45)',
                        }}
                    >
                        <Text bold style={{ fontSize: 12, color: '#FB923C', textAlign: 'center' }}>
                            ⚠ Re-export Bark backup after every receive. Tap to manage.
                        </Text>
                    </TouchableOpacity>
                </Animated.View>
            )}

            {/* Background-refresh status banner — sits BELOW the absolutely-
                positioned shared Send/Receive row. Only shown when:
                  - shared buttons are active (the banner-in-card path
                    doesn't apply — see ArkWallet/index.tsx)
                  - the user has opted into bg refresh (bgRefreshStatus
                    non-null)
                  - the active carousel slide is Ark (banner is Ark-
                    specific status; suppress on Lightning / fiat slides)
                  - the iOS backup reminder isn't already occupying this
                    slot (priority: funds-safety nudge over info text)
                Tap → opens the Ark Capsules screen so the user can drill
                into the bg-refresh settings or manually retry. */}
            {useSharedButtons && !iosBackupReminderVisible && bgRefreshStatus && (() => {
                const statusColor = bgRefreshStatus.error ? colors.redLight : colors.green;
                const linkText = (bgRefreshStatus as any).linkText as string | undefined;
                const tapTab = (bgRefreshStatus as any).tapTab as number | undefined;
                let body: React.ReactNode = bgRefreshStatus.text;
                if (linkText) {
                    const idx = bgRefreshStatus.text.indexOf(linkText);
                    if (idx >= 0) {
                        const before = bgRefreshStatus.text.slice(0, idx);
                        const after = bgRefreshStatus.text.slice(idx + linkText.length);
                        body = (
                            <>
                                {before}
                                <Text
                                    bold
                                    style={{ color: statusColor, textDecorationLine: 'underline' }}
                                >
                                    {linkText}
                                </Text>
                                {after}
                            </>
                        );
                    }
                }
                return (
                    <Animated.View
                        // Stays mounted regardless of which slide is active;
                        // opacity is driven by scrollX so the banner fades in
                        // as the Ark slide enters view and fades out as it
                        // leaves. pointerEvents disabled when off-Ark so taps
                        // pass through to whatever's underneath.
                        pointerEvents={kindFromTab(wTabs[indexStrike]) === 'ark' ? 'auto' : 'none'}
                        style={{
                            position: 'absolute',
                            top: BUTTONS_TOP + BUTTON_ROW_HEIGHT + 8,
                            left: 0,
                            right: 40,
                            alignItems: 'center',
                            opacity: arkReminderOpacity,
                        }}
                    >
                        <TouchableOpacity
                            onPress={() => dispatchNavigate("CheckingAccountNew", { wallet: arkWallet, accountType: "ark", initialTab: tapTab ?? 0 })}
                            activeOpacity={0.7}
                        >
                            <Text
                                h4
                                style={{
                                    color: statusColor,
                                    textAlign: 'center',
                                    paddingHorizontal: 12,
                                }}
                            >
                                {body}
                            </Text>
                        </TouchableOpacity>
                    </Animated.View>
                );
            })()}
        </View>
    );
});

export default WalletsView;
