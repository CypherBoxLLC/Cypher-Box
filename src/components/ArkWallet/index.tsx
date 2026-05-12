import { Text } from "@Cypher/component-library";
import { Card } from "@Cypher/components";
import { dispatchNavigate } from "@Cypher/helpers";
import { generateMnemonic as barkGenerateMnemonic } from "@secondts/bark-react-native";
import { ARK_VTXO_DUST_SATS, blocksToDays } from "@Cypher/services/ark";
import { btc } from "@Cypher/helpers/bitcoinUnits";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import React, { useMemo } from "react";
import { Image, Platform, TouchableOpacity, View } from "react-native";
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
    } = useAuthStore();

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
                tapTab: 1, // Capsules tab
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
                        title="Ark Vault"
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
                            {!isLoading && bgRefreshStatus && (() => {
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
