import { Text } from "@Cypher/component-library";
import { Card } from "@Cypher/components";
import { dispatchNavigate } from "@Cypher/helpers";
import { generateMnemonic as barkGenerateMnemonic } from "@secondts/bark-react-native";
import {
    ARK_VTXO_DUST_SATS,
    blocksToDays,
    cancelArkPendingRound,
    estimateArkOnchainRecover,
    fetchArkMinBoardSats,
    recoverArkOnchainBoard,
} from "@Cypher/services/ark";
import { getCapsuleColorBand } from "@Cypher/helpers/arkCapsuleColor";
import { btc } from "@Cypher/helpers/bitcoinUnits";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import React, { useContext, useMemo } from "react";
import { Alert, Image, Platform, TouchableOpacity, View } from "react-native";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import styles from "./styles";

interface Props {
    isLoading: boolean;
    matchedRate: any;
    currency: any;
    convertedRate: any;
    refRBSheet: any;
    refSendRBSheet: any;
    setReceiveType: any;
    homeMessage?: string | null;
    hideActionButtons?: boolean;
}

/**
 * ArkWallet — experimental non-custodial Lightning provider (Second.tech / Ark protocol).
 * UI parity with CoinosWallet / StrikeWallet. Backing SDK is wired later.
 *
 * ⚠️ Key differences from custodial providers:
 *   - No login credentials. Wallet is created locally (own seed or hot-vault seed).
 *   - VTXO state is NOT recoverable from seed alone (Bark limitation).
 *   - Single ASP operator (Second.tech) sees payment graph.
 * These caveats surface in CreateArkScreen + the "⚠ Experimental" banner below.
 */
export default function ArkWallet({
    isLoading,
    matchedRate,
    currency,
    convertedRate,
    refRBSheet,
    refSendRBSheet,
    setReceiveType,
    homeMessage,
    hideActionButtons = false,
}: Props) {
    const {
        isArkAuth,
        isAuth,
        isStrikeAuth,
        arkWallet,
        arkBalance,
        withdrawArkThreshold,
        reserveArkAmount,
        arkVtxos,
        arkChainTipHeight,
        arkBgRefreshEnabled,
        arkBgRefreshLastSuccessAt,
        arkBgRefreshLastAttempt,
        arkIosBackupReminderActive,
        arkRefreshStuck,
        setArkRefreshStuck,
        arkBalanceDetail,
        walletID,
    } = useAuthStore();

    // Wallets list — used to resolve the active Hot Vault (an
    // HDSegwitBech32Wallet keyed by `walletID`) for the F3 "Recover" flow,
    // which drains a stuck on-chain boarding deposit back to a fresh Hot
    // Vault change address. Same source HomeScreen uses to find the vault.
    const { wallets } = useContext(BlueStorageContext);

    // Recovery handler for "stuck refresh" — fired when the user taps the
    // banner that surfaces when expired-on-chain VTXOs are still Locked in
    // rounds the SDK reports as ongoing=true. Calls cancelPendingRound for
    // each stuck round (unlocks the input VTXOs so the user can retry), then
    // clears the banner. The next sync cycle (which compares fresh
    // expiryHeight to fresh tip) re-detects from on-chain truth, so a banner
    // re-shows automatically if any round is still stuck after cancellation.
    const handleStuckRecovery = React.useCallback(async () => {
        if (!arkRefreshStuck) return;
        for (const roundId of arkRefreshStuck.stuckRoundIds) {
            try {
                await cancelArkPendingRound(roundId);
            } catch {
                // cancelArkPendingRound already console.warns the inner
                // BarkError detail (roundId + tag + inner errorMessage).
                // We swallow per-round failures so one bad round doesn't
                // block cancellation of the others.
            }
        }
        setArkRefreshStuck(null);
    }, [arkRefreshStuck, setArkRefreshStuck]);

    // Live server minimum board amount, for classifying the un-boarded
    // on-chain (boarding) balance below.
    const [minBoardSats, setMinBoardSats] = React.useState(50000);
    React.useEffect(() => {
        let cancelled = false;
        fetchArkMinBoardSats().then((min) => {
            if (!cancelled && typeof min === 'number' && min > 0) setMinBoardSats(min);
        });
        return () => { cancelled = true; };
    }, []);

    // F3 recover state. `recovering` disables the row + relabels it while the
    // drain tx is being built/broadcast. `boardingHiddenAfterRecover` hides
    // the row optimistically the instant a recover succeeds, since the funds
    // are leaving — the next balance write (each useArkSync tick replaces the
    // object) is the source of truth and the effect below drops the optimistic
    // hide so the row reflects reality again (stays gone if the drain cleared
    // it, reappears honestly if a change UTXO remained).
    const [recovering, setRecovering] = React.useState(false);
    const [boardingHiddenAfterRecover, setBoardingHiddenAfterRecover] = React.useState(false);
    React.useEffect(() => {
        setBoardingHiddenAfterRecover(false);
    }, [arkBalanceDetail]);

    // Un-boarded on-chain "boarding" funds → a status row in the card.
    //   confirmed < min  → STUCK (can never board; recover) [amber]
    //   confirmed >= min → boarding in progress [green]
    //   only unconfirmed → still confirming [green]
    // Null = nothing to show (happy path). See .claude/ARK_STUCK_UTXO_UX_SPEC.md.
    // The STUCK (below-min) row is tappable -> handleRecoverBoard (F3).
    const boardingView = useMemo(() => {
        // Optimistically suppressed right after a successful recover, until the
        // next sync writes the real (cleared) balance.
        if (boardingHiddenAfterRecover) return null;
        const confirmed = arkBalanceDetail?.onchainBoardingSats ?? 0;
        const confirming = arkBalanceDetail?.onchainConfirmingSats ?? 0;
        if (confirmed <= 0 && confirming <= 0) return null;
        if (confirmed > 0 && confirmed < minBoardSats) {
            return {
                sats: confirmed, color: '#FFD54F', stuck: true,
                label: `Boarding (on-chain): ${confirmed} sats. Too small to board (min ${minBoardSats} sats).`,
            };
        }
        if (confirmed >= minBoardSats) {
            return {
                sats: confirmed, color: colors.green, stuck: false,
                label: `Boarding (on-chain): ${confirmed} sats. Joining the next round.`,
            };
        }
        return {
            sats: confirming, color: colors.green, stuck: false,
            label: `Boarding (on-chain): ${confirming} sats. Confirming.`,
        };
    }, [arkBalanceDetail, minBoardSats, boardingHiddenAfterRecover]);

    /**
     * F3 — drain a stuck on-chain boarding deposit back to the Hot Vault.
     *
     * Shown only for the STUCK_BELOW_MIN row (a sub-50k deposit the ASP will
     * never board). Resolves a fresh Hot Vault change address (the on-chain
     * wallet the funds came from for in-app top-ups), confirms amount + fee in
     * a modal, then calls the recover service. The bark SDK's OnchainWallet has
     * no utxos()/drain(), so the destination is a Hot Vault address rather than
     * the esplora-resolved original sender (see ARK_STUCK_UTXO_UX_SPEC.md).
     */
    const handleRecoverBoard = React.useCallback(async () => {
        if (recovering) return;

        // Resolve the active Hot Vault (HDSegwitBech32Wallet) by walletID.
        const hotVault: any = (wallets || []).find(
            (w: any) => typeof w?.getID === 'function' && w.getID() === walletID,
        );
        if (!hotVault || typeof hotVault._getInternalAddressByIndex !== 'function') {
            Alert.alert('No Hot Vault found', 'Open or create your Hot Vault first, then try again.');
            return;
        }

        let est;
        try {
            est = await estimateArkOnchainRecover(arkBalanceDetail?.onchainBoardingSats ?? 0);
        } catch {
            Alert.alert(
                'Recovery unavailable',
                'Could not read the on-chain balance right now. Check your connection and try again.',
            );
            return;
        }

        if (est.confirmedSats <= 0) {
            // Already boarded / left in the meantime — nothing to do.
            setBoardingHiddenAfterRecover(true);
            return;
        }
        if (!est.economical) {
            Alert.alert(
                'Too small to recover',
                'The network fee would be larger than the stuck amount, so recovering it on-chain would cost more than it returns.',
            );
            return;
        }

        // Fresh Hot Vault change address (no Electrum round-trip needed).
        let destAddress: string;
        try {
            destAddress = hotVault._getInternalAddressByIndex(hotVault.getNextFreeChangeAddressIndex());
        } catch {
            Alert.alert('No Hot Vault address', 'Could not derive a Hot Vault address to recover to.');
            return;
        }
        if (!destAddress) {
            Alert.alert('No Hot Vault address', 'Could not derive a Hot Vault address to recover to.');
            return;
        }

        Alert.alert(
            'Recover stuck funds',
            `Send ${est.recoverableSats} sats back to your Hot Vault? This is an on-chain transaction. The network fee is about ${est.feeSats} sats.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Recover',
                    onPress: async () => {
                        setRecovering(true);
                        try {
                            const res = await recoverArkOnchainBoard(destAddress, est.confirmedSats, est.feeRateSatPerVb);
                            setBoardingHiddenAfterRecover(true);
                            if (res.status === 'already-cleared') {
                                Alert.alert('Nothing to recover', 'These funds already cleared.');
                            } else {
                                Alert.alert(
                                    'Recovery sent',
                                    `${res.sentSats} sats are on the way to your Hot Vault. They will appear there as a pending transaction.`,
                                );
                            }
                        } catch (e: any) {
                            Alert.alert(
                                'Recovery failed',
                                String(e?.message || '') || 'The recovery transaction could not be sent. Your funds are unchanged.',
                            );
                        } finally {
                            setRecovering(false);
                        }
                    },
                },
            ],
        );
    }, [recovering, wallets, walletID, arkBalanceDetail]);

    // Strike + CoinOS + Ark: this combination pulls the Ark card up out
    // of position. Bump it down 10pt for this specific 3-Lightning combo
    // (was 18pt — overshoot per Bam, matches the Strike+Ark adjustment in
    // StrikeWallet). Other combos are untouched.
    const allThreeLightning = isAuth && isStrikeAuth && isArkAuth;

    // Non-zero means there's an in-flight round (refresh / send / board).
    //
    // We DERIVE this from the Locked VTXO amounts rather than using
    // `arkBalanceDetail.pendingInRoundSats` directly, because the SDK's
    // raw field sums both sides of the round (input + expected output ≈
    // 2× the real amount). With the headline balance now including the
    // Locked-VTXO amount, showing the raw 2× number in the subtitle
    // confused users — they saw e.g. "9980 sats" on the card and
    // "19911 sats pending" just below, and reasonably thought we were
    // double-counting.
    //
    // Summing Locked VTXOs from `arkVtxos` gives the exact post-fee
    // retained amount that's currently tied up in the round. When no
    // round is pending, this is 0 and the subtitle is hidden.
    const pendingRoundSats = useMemo(() => {
        return arkVtxos.reduce(
            (sum, v) => (v.state.toLowerCase() === 'locked' ? sum + v.sats : sum),
            0,
        );
    }, [arkVtxos]);

    // Count of locked VTXOs (mid-round). Paired with pendingRoundSats
    // so the status banner can render "Refreshing N capsules · X sats"
    // and tell the user why their headline balance dropped.
    const pendingRoundCount = useMemo(() => {
        return arkVtxos.reduce(
            (n, v) => (v.state.toLowerCase() === 'locked' ? n + 1 : n),
            0,
        );
    }, [arkVtxos]);

    // Surface a nudge when the soonest-expiring VTXO is under a week out, so
    // users don't need to dig into the capsules tab to notice. VTXOs with
    // expiryHeight === 0 (arkoor) inherit parent expiry — we can't compute a
    // date for those, so they're skipped here.
    const soonestDaysLeft = useMemo(() => {
        if (arkChainTipHeight === null || arkVtxos.length === 0) return null;
        let minBlocks = Infinity;
        for (const v of arkVtxos) {
            // Skip arkoor (no own expiry) and Locked (mid-round — expiry
            // countdown is meaningless until the round finalises).
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

    /**
     * Solid-coloured capsule slot data for the in-Card row. One pill per
     * spendable/locked VTXO; colour reflects expiry band (green/yellow/
     * orange/red) per `getCapsuleColorBand`; refreshing flag mirrors
     * locked-state so the slot pulses on the Card's existing pulse
     * animation. Sorted most-urgent first (smallest daysLeft) so the
     * Card's 5-slot cap surfaces the capsules that need attention. VTXOs
     * with expiryHeight === 0 (arkoor inherit) get a healthy daysLeft
     * default of 30 so they don't dominate the urgency sort with a
     * misleading 0.
     */
    const arkCapsuleSlots = useMemo(() => {
        if (arkChainTipHeight === null) return undefined;
        return arkVtxos
            .filter((v) => v.state.toLowerCase() !== 'spent')
            .map((v) => {
                const daysLeft = v.expiryHeight > 0
                    ? Math.max(0, blocksToDays(v.expiryHeight - arkChainTipHeight))
                    : 30;
                return {
                    color: getCapsuleColorBand(daysLeft).color,
                    refreshing: v.state.toLowerCase() === 'locked',
                    daysLeft,
                };
            })
            .sort((a, b) => a.daysLeft - b.daysLeft)
            .map(({ color, refreshing }) => ({ color, refreshing }));
    }, [arkVtxos, arkChainTipHeight]);

    /**
     * Count of dust capsules that haven't expired yet. A "dust capsule" is
     * a spendable VTXO whose sats value is at or below ARK_VTXO_DUST_SATS
     * (330). Bark's refresh fee is greater than the capsule's value, so
     * dust capsules CAN'T be refreshed individually — they need batch
     * refresh (consolidate several dust VTXOs into one above-dust output).
     *
     * Drives a dedicated home-card warning so the user knows they can't
     * just hit "refresh" — they have to go to the Capsules tab and batch
     * them. Independent from `expiryWarning` because dust capsules need
     * the batch action regardless of how soon they expire.
     */
    const dustCapsuleCount = useMemo(() => {
        if (!arkVtxos || arkChainTipHeight == null) return 0;
        let count = 0;
        for (const v of arkVtxos) {
            if (v.sats > ARK_VTXO_DUST_SATS) continue;
            if (v.state.toLowerCase() !== 'spendable') continue;
            if (v.expiryHeight === 0) continue;
            const blocks = v.expiryHeight - arkChainTipHeight;
            if (blocks <= 0) continue; // already expired — different kind of problem
            count++;
        }
        return count;
    }, [arkVtxos, arkChainTipHeight]);

    /**
     * Single status line surfaced under the Ark balance.
     *
     * Always returns a value (was previously null when bg-refresh was off,
     * forcing a separate expiryWarning render below). Now this slot owns
     * the entire "what does the user need to know?" priority chain so
     * everything funnels through one renderer.
     *
     * Priority (top wins, green for healthy states, red for warnings):
     *   1. Refresh in flight — return null (no pill). The Card surfaces
     *      "Refreshing N capsules · X sats" inside its balance area via
     *      the `refreshingInfo` prop, so a duplicate message in this
     *      pill would be redundant. Returning null here also suppresses
     *      the stale failure-record branch (finalize only writes 'success'
     *      after the round commits — up to 1h on mainnet — so the prior
     *      failure would otherwise linger under the in-card live status).
     *   2. Auto-refresh attempt errored — capsules at risk, user back on hook
     *   3. Dust capsules present — sub-fee VTXOs need batch consolidation
     *   4. A VTXO is within a week of expiry — funds at risk imminently
     *   5. Auto-refresh toggle is off — capsules WILL eventually expire
     *      without manual refresh; soft warning so the user notices
     *   6. iOS backup reminder active — iCloud Drive not synced, off-device
     *      backup missing (only a flag on iOS; Android handles backup via
     *      Drive / SAF which never flips this state)
     *   7. All clear — return null. The homescreen stays quiet when
     *      there's nothing the user needs to act on.
     *
     * The standalone expiryWarning render below this hook used to handle
     * priority 4 separately; that block is now removed since this hook
     * subsumes it.
     */
    const bgRefreshStatus = useMemo(() => {
        // 1. Refresh / send / board in flight. Short-circuits the rest of
        //    the chain because the Card itself now renders a prominent
        //    pulsing "Refreshing N capsules · X sats" line inside the
        //    balance area (see Card's `refreshingInfo` prop), so duplicating
        //    it in the pill below would be redundant. We ALSO want to
        //    suppress the failure-record branch in this state: `finalize`
        //    only writes `outcome: 'success'` after the round commits
        //    server-side (up to 1h on mainnet), so a stale "failed at
        //    HH:MM" from a prior attempt would otherwise linger underneath
        //    the in-card live status for an hour. Returning all-clear here
        //    means the pill confirms the system is healthy while the card
        //    shows the active operation.
        if (pendingRoundCount > 0) {
            return null;
        }

        // 2. Auto-refresh errored — only when nothing is currently in
        //    flight, otherwise the active refresh above takes precedence.
        if (arkBgRefreshEnabled && arkBgRefreshLastAttempt?.outcome === 'error') {
            const d = new Date(arkBgRefreshLastAttempt.at);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return {
                text: `Auto-refresh failed at ${hh}:${mm} — tap to retry`,
                error: true,
            };
        }

        // 3. Dust capsules present — can't be refreshed individually
        //    (refresh fee > value). Needs batch refresh on the Capsules
        //    tab. Render "here" as an underlined link to invite the tap.
        if (dustCapsuleCount > 0) {
            return {
                text: 'Attention: you have dust ark capsules that cannot be refreshed and might expire. Batch refresh them here.',
                linkText: 'here',
                tapTab: 0, // Capsules tab (Ark's first tab, post-reorder)
                error: true,
            };
        }

        // 4. Non-dust capsule near expiry (oldest spendable VTXO < 7d)
        if (expiryWarning) {
            return { text: expiryWarning, error: true };
        }

        // 5. Auto-refresh toggle off
        if (!arkBgRefreshEnabled) {
            return {
                text: 'Auto-refresh: off — capsules will expire without manual refresh',
                error: true,
            };
        }

        // 6. iOS backup not synced (iCloud Drive off for Cypher Box, or
        //    user created via the manual share+confirm path without yet
        //    enabling iCloud Drive). Android never sets this flag.
        if (Platform.OS === 'ios' && arkIosBackupReminderActive) {
            return {
                text: 'Backup not synced — enable iCloud Drive in iOS Settings',
                error: true,
            };
        }

        // 7. All clear — no pill. Bam's call: the homescreen stays quiet
        //    when there's nothing the user needs to act on. The Card's
        //    own balance line + the in-card refreshing animation (when
        //    a round is in flight) are signal enough.
        return null;
    }, [
        arkBgRefreshEnabled,
        arkBgRefreshLastAttempt,
        expiryWarning,
        dustCapsuleCount,
        arkIosBackupReminderActive,
        pendingRoundCount,
        pendingRoundSats,
    ]);

    // IMPORTANT: the parent's `convertedRate` prop is globally computed from
    // the CoinOS balance (HomeScreen/index.tsx:683 — `setConvertedRate(
    // finalRate * response.balance)` where response is the CoinOS /user
    // call). Passing it straight into the Ark card displayed CoinOS's fiat
    // balance on the Ark tile — wrong number, misleading to users.
    //
    // Derive the Ark-scoped fiat locally: arkBalance (sats) × matchedRate
    // (USD-per-BTC) × btc(1) (= 1e-8) → USD value of the Ark balance.
    //
    // `matchedRate` is now stored as USD-per-BTC (set by handleUser via
    // setMatchedRate(getFiatRate('USD')) — see fix(coinos): use BlueWallet
    // USD rate as single source). An earlier iteration of this memo
    // assumed USD-per-sat and multiplied without btc(1); after the rate
    // unit flipped to USD-per-BTC, that produced a fiat figure 1e8× too
    // large — a 1.07K-sat balance read as $867M. Keep the btc(1) factor.
    const arkConvertedRate = useMemo(() => {
        const rate = Number(matchedRate) || 0;
        if (!arkBalance || rate === 0) return 0;
        return arkBalance * rate * btc(1);
    }, [arkBalance, matchedRate]);

    const receiveClickHandler = (type: boolean) => {
        // Ark supports both Lightning IN and on-chain board. For mockup, route
        // through the existing shared receive sheet (setReceiveType pipes into
        // the caller's RBSheet).
        if (type) {
            setReceiveType(type);
            refRBSheet.current.open();
        } else {
            dispatchNavigate("CheckingAccountNew", {
                wallet: arkWallet,
                matchedRate,
                accountType: "ark",
            });
        }
    };

    const sendClickHandler = (_walletType: boolean) => {
        refSendRBSheet.current.open();
    };

    const arkMenuClickHandler = (initialTab?: number) => {
        dispatchNavigate("CheckingAccountNew", {
            wallet: arkWallet,
            matchedRate,
            accountType: "ark",
            balance: arkBalance,
            // Forward the Ark-derived fiat, not the parent's `convertedRate`
            // (which is CoinOS-scoped). Keeps the Account tab's balance
            // header consistent with the home-screen card.
            converted: arkConvertedRate,
            currency,
            reserveAmount: reserveArkAmount,
            withdrawThreshold: withdrawArkThreshold,
            // Tab index when the caller wants to deep-link past the
            // default Account view. The dust-capsule warning passes 1 to
            // jump straight to the Capsules tab where the batch-refresh
            // action lives.
            initialTab,
        });
    };

    const createArkWalletClickHandler = () => {
        // Skip the CreateArkScreen intro and go straight to the seed reveal.
        const mnemonic = barkGenerateMnemonic();
        dispatchNavigate("ArkSeedPhraseScreen", { mnemonic });
    };

    return (
        <>
            {isArkAuth && (
                <View style={allThreeLightning ? { transform: [{ translateY: 10 }] } : undefined}>
                    <Card
                        wallet="ARK"
                        title="Bark Vault"
                        balance={arkBalance}
                        // See `arkConvertedRate` above — the parent's
                        // `convertedRate` prop is the CoinOS figure, not ours.
                        convertedRate={arkConvertedRate}
                        reserveAmount={reserveArkAmount}
                        withdrawThreshold={withdrawArkThreshold}
                        onPress={() => arkMenuClickHandler()}
                        isShowButtons
                        hideActionButtons={hideActionButtons}
                        matchedRate={matchedRate}
                        currency={currency}
                        receiveClickHandler={receiveClickHandler}
                        sendClickHandler={sendClickHandler}
                        // In-card pulsing refreshing line. Replaces the
                        // zero-balance line when all VTXOs are locked in a
                        // round, or renders beneath the live balance when
                        // some VTXOs remain spendable. Same pulse cadence
                        // as the per-capsule transient animation, so the
                        // visual ties the card to the Capsules tab when
                        // the user taps through.
                        refreshingInfo={pendingRoundCount > 0
                            ? { count: pendingRoundCount, sats: pendingRoundSats }
                            : null}
                        arkCapsuleSlots={arkCapsuleSlots}
                    />
                    {/* When shared buttons are active (`hideActionButtons`),
                        skip this minHeight-40 reserve so the shared row can
                        sit flush below the card. Otherwise it left a 40px
                        gap that Bam called "way below". The expiry warning
                        and pending-round nudges are also suppressed in
                        shared-mode — Bam can surface them elsewhere later. */}
                    {!hideActionButtons && (
                        <View style={{ minHeight: 40, justifyContent: "center" }}>
                            {!isLoading && homeMessage && (
                                <Text h4 style={styles.alert}>
                                    {homeMessage}
                                </Text>
                            )}
                            {/* Stuck-refresh banner — renders ABOVE the
                                bgRefreshStatus pill and takes visual
                                priority because "your funds are at risk
                                of a stuck round" outweighs the auto-
                                refresh / backup nudges that pill carries.
                                Detection happens in useArkSync: any Locked
                                VTXO with expiryHeight <= tip + at least
                                one round still ongoing=true. Tap fires
                                cancelPendingRound per round; the next
                                sync re-detects from on-chain truth, so a
                                still-stuck condition pops the banner back. */}
                            {!isLoading && arkRefreshStuck && (
                                <TouchableOpacity
                                    onPress={handleStuckRecovery}
                                    activeOpacity={0.7}
                                    accessibilityRole="button"
                                    accessibilityLabel="Recover stuck refresh"
                                >
                                    <Text
                                        h4
                                        style={[
                                            styles.alert,
                                            { color: colors.redLight, textDecorationLine: 'underline' },
                                        ]}
                                    >
                                        Refresh stuck · {arkRefreshStuck.stuckSats} sats — tap to recover
                                    </Text>
                                </TouchableOpacity>
                            )}
                            {!isLoading && boardingView && (
                                boardingView.stuck ? (
                                    <TouchableOpacity
                                        onPress={handleRecoverBoard}
                                        disabled={recovering}
                                        activeOpacity={0.7}
                                        accessibilityRole="button"
                                        accessibilityLabel="Recover stuck on-chain funds to your Hot Vault"
                                    >
                                        <Text h4 style={[styles.alert, { color: boardingView.color }]}>
                                            {boardingView.label}{' '}
                                            <Text
                                                bold
                                                style={{ color: boardingView.color, textDecorationLine: 'underline' }}
                                            >
                                                {recovering ? 'Recovering…' : 'Recover'}
                                            </Text>
                                        </Text>
                                    </TouchableOpacity>
                                ) : (
                                    <Text h4 style={[styles.alert, { color: boardingView.color }]}>
                                        {boardingView.label}
                                    </Text>
                                )
                            )}
                            {!isLoading && !arkRefreshStuck && bgRefreshStatus && (() => {
                                const statusColor = bgRefreshStatus.error ? colors.redLight : colors.green;
                                // Build the rendered text. When the status
                                // declares a `linkText` substring (e.g. "here"
                                // for the dust-batch nudge), split the message
                                // and render that substring with underline so
                                // the user reads it as a tap target. The whole
                                // pill is tappable either way.
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
                                    <TouchableOpacity onPress={() => arkMenuClickHandler(tapTab)} activeOpacity={0.7}>
                                        <Text
                                            h4
                                            style={[
                                                styles.alert,
                                                { color: statusColor },
                                            ]}
                                        >
                                            {body}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })()}
                            {/* Standalone expiryWarning render removed —
                                bgRefreshStatus above now folds capsule-
                                expiry into the same priority chain that
                                handles auto-refresh / backup status, so
                                only one status line ever renders here. */}
                            {/* Standalone "refreshing - in flight" line
                                removed — bgRefreshStatus above now folds
                                pending-round count + sats into the same
                                priority chain so the user sees a single
                                clear status. The headline balance still
                                excludes locked VTXOs; the status line now
                                explains why ("Refreshing N capsules · X
                                sats" in green). */}
                        </View>
                    )}
                    {/*
                      When `hideActionButtons` is true (HomeScreen with shared
                      Receive/Send row), the bg-refresh banner is rendered by
                      WalletsView instead — positioned BELOW the absolutely-
                      anchored shared row instead of behind it.
                    */}
                </View>
            )}

            {!isArkAuth && (
                <View>
                    {/*
                      Yellow-outline-only CTA. Mirrors the visual language of the
                      Hot Vault box (SavingVault), which uses a 1.5px coloured
                      border on a transparent body — communicating "self-custody"
                      vs. the gradient-filled custodial cards.
                    */}
                    <TouchableOpacity
                        style={styles.createView}
                        onPress={createArkWalletClickHandler}
                        activeOpacity={0.8}
                    >
                        <View style={styles.middle}>
                            <Image
                                style={styles.arrow}
                                resizeMode="contain"
                                source={require("../../../img/arrow-right.png")}
                            />
                            <Text h2 style={styles.shadow} center>
                                Create an Ark Wallet
                            </Text>
                        </View>
                    </TouchableOpacity>
                    <View style={styles.createAccount}>
                        <Text bold style={styles.text}>
                            Non-custodial Lightning via Ark
                        </Text>
                        <TouchableOpacity onPress={createArkWalletClickHandler}>
                            <Text bold style={styles.login}>
                                ⚠ Experimental — tap to learn more
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </>
    );
}
