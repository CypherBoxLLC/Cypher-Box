import { Text } from "@Cypher/component-library";
import { Card } from "@Cypher/components";
import { dispatchNavigate } from "@Cypher/helpers";
import { generateMnemonic as barkGenerateMnemonic } from "@secondts/bark-react-native";
import { blocksToDays } from "@Cypher/services/ark";
import { btc } from "@Cypher/helpers/bitcoinUnits";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import React, { useMemo } from "react";
import { Image, TouchableOpacity, View } from "react-native";
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
     * Status line shown when the user has opted into background refresh.
     *
     * Replaces — does not append to — the expiryWarning text, since the
     * whole point of opting in is to take that worry off the user. We
     * still surface a clear failure state if the last attempt errored,
     * because at that point the user IS back on the hook and needs to
     * know.
     *
     * Returns null when the toggle is off so the regular expiryWarning
     * path runs unchanged.
     */
    const bgRefreshStatus = useMemo(() => {
        if (!arkBgRefreshEnabled) return null;

        if (arkBgRefreshLastAttempt?.outcome === 'error') {
            const d = new Date(arkBgRefreshLastAttempt.at);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return {
                text: `Auto-refresh failed at ${hh}:${mm} — tap to retry`,
                error: true,
            };
        }

        if (arkBgRefreshLastSuccessAt === null) {
            return { text: 'Auto-refresh on — waiting for first run', error: false };
        }

        const ageMs = Date.now() - arkBgRefreshLastSuccessAt;
        const ageHrs = ageMs / (60 * 60 * 1000);
        const ageStr = ageHrs < 1
            ? `${Math.max(1, Math.round(ageMs / 60_000))}m ago`
            : `${Math.round(ageHrs)}h ago`;
        return { text: `Auto-refresh on, last refresh ${ageStr}`, error: false };
    }, [arkBgRefreshEnabled, arkBgRefreshLastSuccessAt, arkBgRefreshLastAttempt]);

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

    const arkMenuClickHandler = () => {
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
                        onPress={arkMenuClickHandler}
                        isShowButtons
                        hideActionButtons={hideActionButtons}
                        matchedRate={matchedRate}
                        currency={currency}
                        receiveClickHandler={receiveClickHandler}
                        sendClickHandler={sendClickHandler}
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
                            {!isLoading && bgRefreshStatus && (
                                <TouchableOpacity onPress={arkMenuClickHandler} activeOpacity={0.7}>
                                    <Text
                                        h4
                                        style={[
                                            styles.alert,
                                            {
                                                color: bgRefreshStatus.error
                                                    ? colors.redLight
                                                    : colors.ark.light,
                                            },
                                        ]}
                                    >
                                        {bgRefreshStatus.text}
                                    </Text>
                                </TouchableOpacity>
                            )}
                            {/* Plain expiry warning suppressed when the bg-
                                refresh banner is up — the banner above
                                already covers expiry context (next-run ETA /
                                last-run failure). */}
                            {!isLoading && !bgRefreshStatus && expiryWarning && (
                                <Text h4 style={[styles.alert, { color: colors.redLight }]}>
                                    {expiryWarning}
                                </Text>
                            )}
                            {!isLoading && pendingRoundSats > 0 && (
                                // The headline `arkBalance` already excludes
                                // these sats (Locked VTXO state, summed in
                                // `pendingRoundSats`), so this subtitle is
                                // purely informational — the user's spendable
                                // figure stays accurate while a round is mid-
                                // flight. Wording requested by Bam: "refreshing
                                // - in flight" reads cleaner than the longer
                                // "pending in a round (refresh/send in flight)"
                                // we used before. Same data either way.
                                <Text h4 style={[styles.alert, { color: colors.green }]}>
                                    {`(refreshing - in flight): ${pendingRoundSats.toLocaleString()} sats`}
                                </Text>
                            )}
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
