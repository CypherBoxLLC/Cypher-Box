import { CoinOS, CoinOSSmall, CoinOs, Electricity, Second, Strike2, StrikeFull } from "@Cypher/assets/images";
import { Text } from "@Cypher/component-library";
import { calculateBalancePercentage, calculatePercentage, dispatchNavigate } from "@Cypher/helpers";
import { formatNumber, formatSats, getStrikeCurrency } from "@Cypher/helpers/coinosHelper";
import { colors } from "@Cypher/style-guide";
import MaskedView from "@react-native-masked-view/masked-view";
import React, { useContext, useEffect, useRef } from "react";
import { Animated, Easing, Image, StyleSheet, TouchableOpacity, View } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import LinearGradient from "react-native-linear-gradient";
import GradientButtonWithShadow from "../GradientButtonWithShadow";
import styles from "./styles";
import useAuthStore from "@Cypher/stores/authStore";
import { CarouselPageVisibilityContext, useEasedProgress } from "@Cypher/custom-hooks";
import { useIsFocused } from "@react-navigation/native";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";

interface Props {
    onPress?: (value: boolean) => void;
    title?: string;
    wallet?:string;
    balance: any;
    convertedRate: any;
    matchedRate: any;
    currency: any;
    withdrawThreshold: any;
    reserveAmount: any;
    isShowButtons?: boolean;
    /** Suppress in-card Receive/Send buttons. Used when a shared row outside the carousel takes over (matches the vault top-up/withdraw pattern). */
    hideActionButtons?: boolean;
    receiveType?: boolean;
    receiveClickHandler?(value: boolean): void;
    sendClickHandler?(value: boolean): void;
    /**
     * In-flight refresh-round info shown inside the balance area with a
     * pulsing fade so the user can see WHY their visible balance is lower
     * than they expect (locked VTXOs mid-round). When `balance > 0`, the
     * refreshing line renders BELOW the normal "X sats ~ $Y.YY" line.
     * When `balance === 0`, it REPLACES the "0 sats ~ $0.00" line so the
     * user doesn't see a confusing zero balance while a round is locking
     * everything they have.
     */
    refreshingInfo?: { count: number; sats: number } | null;
    /**
     * Optional row of coloured capsule slots rendered inside the Ark
     * Card (mirrors the empty-slot row in Hot Vault's box). Each slot
     * is a solid-colored pill — colour = expiry band, no chunking, no
     * size scaling. `refreshing: true` slots pulse on the same
     * fade-animation as the in-card "Refreshing N capsules" text so
     * the visual lineage is obvious.
     *
     * Callers pre-sort by urgency (most urgent first); Card renders up
     * to 5 in order and pads the rest of the row with empty outline
     * slots so the box visual stays consistent regardless of VTXO count.
     */
    arkCapsuleSlots?: { color: string; refreshing: boolean }[];
    /**
     * Suppress the balance / "X sats ~ $Y.YY" line entirely. Used by the
     * "Ark Vault Created!" educational screen, which shows a Card preview
     * with decorative capsule slots but no numbers (the wallet is empty,
     * displaying "0 sats ~ $0.00" is noise). Default false — every
     * existing live caller renders the balance as before.
     */
    hideBalance?: boolean;
}

export default function Card({ onPress,
    wallet,
    title = 'Lightning Account',
    balance,
    convertedRate,
    withdrawThreshold,
    reserveAmount,
    matchedRate,
    currency,
    isShowButtons = false,
    hideActionButtons = false,
    receiveType = false,
    receiveClickHandler,
    sendClickHandler,
    refreshingInfo = null,
    arkCapsuleSlots,
    hideBalance = false,
}: Props) {
    const {coldStorageWalletID, walletID, allBTCWallets} = useAuthStore();

    // Pulsing fade for the in-card refreshing line. Same shape as the
    // capsule pulse in ArkCapsules' TransactionRowAnim (1 → 0.2 → 1, 1.6s
    // total) so the in-card status reads visually consistent with the
    // capsule animation a tap-through reveals on the Capsules tab.
    const refreshPulseAnim = useRef(new Animated.Value(1)).current;
    useEffect(() => {
        if (!refreshingInfo) {
            refreshPulseAnim.setValue(1);
            return;
        }
        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(refreshPulseAnim, {
                    toValue: 0.2,
                    duration: 800,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(refreshPulseAnim, {
                    toValue: 1,
                    duration: 800,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ]),
        );
        pulse.start();
        return () => pulse.stop();
    }, [refreshingInfo, refreshPulseAnim]);

    // Capsule count is redundant with the capsule-slot row rendered right
    // below the balance — users can already see how many shapes are
    // pulsing. Just show the sats being refreshed. "+" prefix reads as
    // "incoming/about-to-be-spendable" alongside the balance line.
    const refreshingText = refreshingInfo
        ? `+ Refreshing ${refreshingInfo.sats.toLocaleString()} sats`
        : null;
    const showRefreshingInsteadOfBalance =
        refreshingInfo !== null && (Number(balance) || 0) === 0;

    const thresholdMet = calculateBalancePercentage(Number(balance), Number(withdrawThreshold), Number(reserveAmount)) >= 100;

    const onCardClickHandler = () => {
        onPress?.(true);
    }

    const getBalance = () => {
        const safeConverted = Number(convertedRate) || 0;
        return `${formatSats(Number(balance) || 0)} sats ~ ${getStrikeCurrency(currency || 'USD')}${safeConverted.toFixed(2)}`
    }

    const getSats = () => {
        return `${formatNumber(Number(withdrawThreshold) + Number(reserveAmount))} sats`
    }

    const getLineLeft = () => {
        return `${calculatePercentage(Number(withdrawThreshold), (Number(reserveAmount)))}%`
    }

    // Eased fill for the threshold bar: balance changes glide the pink
    // fill instead of snapping it. Gated on actual visibility (screen
    // focused AND this carousel page on screen) so the sweep replays when
    // the user arrives instead of playing unseen — a balance change while
    // they're on the Bark page or another screen holds the old fill until
    // they swipe back.
    const cardPageVisible = useContext(CarouselPageVisibilityContext);
    const cardFocused = useIsFocused();
    const fillPct = calculateBalancePercentage(Number(balance), Number(withdrawThreshold), Number(reserveAmount));
    const fillAnim = useEasedProgress(fillPct, cardPageVisible && cardFocused);
    const fillStyle = useAnimatedStyle(() => ({
        width: `${Math.min(Math.max(fillAnim.value, 0), 100)}%`,
    }));
    // Single-wallet shortcuts. When the user has exactly one BTC wallet
    // and no vaults, skip the wallet-picker sheet (it would show a single
    // tile anyway) and dispatch straight to the wallet-specific entry
    // screen.
    //
    //   - Lightning wallet (STRIKE / COINOS): receive → CreateInvoice,
    //     send → SendScreen. Those screens hit Strike/CoinOS APIs.
    //   - Ark wallet: send → ArkSendScreen directly (unified paste-and-
    //     classify handles all four rails: LN invoice / LN address / Ark
    //     address / on-chain — no rail picker needed before it). Receive
    //     still routes through the sheet because the receive UX
    //     intentionally exposes three discrete rails as tabs (Onchain /
    //     Lightning / Ark address), different from the unified-send design.
    //
    // The OLD single-wallet shortcut treated Lightning and Ark the same,
    // so Ark-only users landed on the Strike create-invoice screen and
    // hit "not authenticated."
    const isSingleWallet =
        allBTCWallets.length == 1 && !coldStorageWalletID && !walletID;
    const isSingleLightningWallet = isSingleWallet && wallet !== "ARK";
    const isSingleArkWallet = isSingleWallet && wallet === "ARK";

    const onReceiveClickHandler = () => {
        if (isSingleLightningWallet) {
            dispatchNavigate('CreateInvoice', {
                matchedRate,
                currency,
                receiveType: true
            });
        } else {
            // Ark-only and multi-wallet both go through the sheet. The sheet
            // auto-shows the Ark sub-menu (Onchain / Lightning / Ark address)
            // when only Ark is present (see ReceivedListNew.getInitialSelectedItem).
            receiveClickHandler?.(true);
        }
    }

    const onSendClickHandler = () => {
        if (isSingleLightningWallet) {
            dispatchNavigate('SendScreen', {
                matchedRate,
                currency,
                receiveType: true
            });
        } else if (isSingleArkWallet) {
            dispatchNavigate('ArkSendScreen', {
                matchedRate,
                currency,
            });
        } else {
            sendClickHandler?.(true);
        }
    }

    const cardChildren = (
        <>
            {/* Translucent lightning watermark behind the card content —
                mirrors the same treatment on the home "Unlock Lightning
                Wallet" CTA so all Lightning surfaces share the visual
                language. 12% alpha keeps it readable but lets the card's
                pink (Strike/CoinOS) or grey (Ark) gradient show through. */}
            <Image
                source={Electricity}
                style={{
                    position: 'absolute',
                    alignSelf: 'center',
                    top: '50%',
                    marginTop: -42,
                    width: 60,
                    height: 84,
                    tintColor: '#FFFFFF',
                    opacity: 0.10,
                }}
                resizeMode="contain"
                pointerEvents="none"
            />
            <View style={styles.view}>
                {wallet === 'ARK' ? (
                    // Boat-outline icon next to the "Ark Vault" title —
                    // matches the Ark = boat icon used in the receive
                    // flow ([ReceivedListNew:310]) and the Vault tab on
                    // the Ark menu, so the visual is consistent
                    // everywhere "Ark Vault" appears.
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons
                            name="boat-outline"
                            size={18}
                            color="#FFFFFF"
                            style={{ marginRight: 6 }}
                        />
                        <Text h2 bold style={[styles.check, { fontSize: 16 }]}>
                            {title}
                        </Text>
                    </View>
                ) : (
                    <Text h2 bold style={[styles.check, { fontSize: 16 }]}>
                        {title}
                    </Text>
                )}
                {wallet === 'STRIKE' ? (
                    // Full brand logo (icon + wordmark) on the right —
                    // StrikeFull / CoinOS replace the previous wordmark-
                    // only assets (Strike2 / CoinOSSmall) so the card
                    // shows the actual provider logo, not a text label.
                    <Image
                        source={StrikeFull}
                        style={[styles.blink, { width: 100, height: 28 }]}
                        resizeMode="contain"
                    />
                ) : wallet === 'ARK' ? (
                    // Second.tech wordmark logo at 95×26. MaskedView fills
                    // the PNG alpha with white since tintColor wasn't taking
                    // on the source.
                    <MaskedView
                        style={{ width: 95, height: 26, transform: [{ translateX: 5 }] }}
                        maskElement={
                            <Image
                                source={Second}
                                style={{ width: 95, height: 26 }}
                                resizeMode="contain"
                            />
                        }
                    >
                        <View style={{ width: 95, height: 26, backgroundColor: '#FFFFFF' }} />
                    </MaskedView>
                ) : (
                    <Image
                        source={CoinOS}
                        style={[styles.blink, { width: 100, height: 28, marginTop: 0, marginBottom: 10 }]}
                        resizeMode="contain"
                    />
                )}
            </View>
            <View style={styles.view}>
                {hideBalance ? null : showRefreshingInsteadOfBalance ? (
                    // Zero spendable balance + round in flight: showing
                    // "0 sats ~ $0.00" would mislead users into thinking
                    // they have nothing left when funds are merely locked
                    // mid-refresh. Replace the line entirely with the
                    // pulsing refreshing status. Sized to match the
                    // instruction-message text below the card (h4) rather
                    // than the big `styles.sats` balance face — Bam's
                    // intent: same visual weight as the rest of the
                    // home-screen status copy, not the headline number.
                    <Animated.View style={{ opacity: refreshPulseAnim }}>
                        <Text h4 bold style={{ color: colors.green }}>
                            {refreshingText}
                        </Text>
                    </Animated.View>
                ) : (
                    // Inner row wrapper so the refreshing line sits on the
                    // same horizontal line as the balance, with a small
                    // controlled gap. Without this, both would be direct
                    // siblings of the outer row (space-between) and the
                    // refreshing line would be shoved to the far right.
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                        <Text h2 bold style={styles.sats}>
                            {getBalance()}
                        </Text>
                        {refreshingText && (
                            <Animated.View style={{ opacity: refreshPulseAnim, marginLeft: 8 }}>
                                <Text h4 bold style={{ color: colors.green }}>
                                    {refreshingText}
                                </Text>
                            </Animated.View>
                        )}
                    </View>
                )}
                {/* Withdrawal-threshold reminder. Hidden for Ark because
                    Ark is self-custodial — there's no custodial-balance
                    counterparty-risk threshold to nudge the user toward.
                    Strike/CoinOS still surface their threshold/reserve
                    nudge here. */}
                {wallet !== 'ARK' && (
                    <Text bold style={styles.totalsats}>
                        {getSats()}
                    </Text>
                )}
            </View>
            {/* Ark capsule slot row: up to 5 solid-coloured pills showing
                the most-urgent VTXOs by expiry band, with a fade-pulse on
                any that are currently mid-refresh. Padding-row mirrors
                Hot Vault's empty-slot pattern so the box visual stays
                constant when the wallet has fewer than 5 capsules or
                none at all. Rendered OUTSIDE `styles.view` (which is
                flexDirection: 'row' holding balance + brand logo) so it
                stacks below as its own full-width row instead of being
                squeezed into the horizontal balance/brand layout. */}
            {wallet === 'ARK' && arkCapsuleSlots && (() => {
                const VISIBLE = 10;
                const filled = arkCapsuleSlots.slice(0, VISIBLE);
                const emptyCount = Math.max(0, VISIBLE - filled.length);
                // 10 slots auto-distributed across the card width via
                // flex:1 — at 10 the per-slot width naturally lands near
                // ~22pt (narrower than the previous 5×32pt grid Bam asked
                // to shrink), so we don't need a fixed-width constant.
                // Empty slots are INVISIBLE but still take their flex:1
                // share so the grid stays stable as VTXOs arrive.
                const SLOT_HEIGHT = 8;
                const SLOT_RADIUS = 4;
                const SLOT_GAP = 6;
                const filledSlot = (color: string) => (
                    <View
                        style={{
                            height: SLOT_HEIGHT,
                            borderRadius: SLOT_RADIUS,
                            backgroundColor: color,
                        }}
                    />
                );
                return (
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                        {filled.map((slot, i) => {
                            const last = i === VISIBLE - 1;
                            const wrapStyle = {
                                flex: 1,
                                marginRight: last ? 0 : SLOT_GAP,
                            } as const;
                            return slot.refreshing ? (
                                <Animated.View
                                    key={`s-${i}`}
                                    style={{ ...wrapStyle, opacity: refreshPulseAnim }}
                                >
                                    {filledSlot(slot.color)}
                                </Animated.View>
                            ) : (
                                <View key={`s-${i}`} style={wrapStyle}>
                                    {filledSlot(slot.color)}
                                </View>
                            );
                        })}
                        {Array(emptyCount).fill(0).map((_, i) => {
                            const idx = filled.length + i;
                            const last = idx === VISIBLE - 1;
                            // Invisible placeholder — reserves the grid
                            // slot without rendering anything visible.
                            return (
                                <View
                                    key={`e-${i}`}
                                    style={{ flex: 1, marginRight: last ? 0 : SLOT_GAP, height: SLOT_HEIGHT }}
                                />
                            );
                        })}
                    </View>
                );
            })()}
            {/* Threshold progress bar (glow + indicator + gradient fill).
                Same self-custody rationale as the reminder above: hidden
                for Ark, kept for Strike/CoinOS. */}
            {wallet !== 'ARK' && (
                // 25pt slot for the threshold-bar trio. All three children
                // are absolutely positioned (see Card/styles.ts), so without
                // this height the parent collapses to 0 and the bars float
                // up over the row above.
                <View style={[{ height: 25 }, thresholdMet ? {
                    shadowColor: '#e84393',
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 1,
                    shadowRadius: 16,
                    elevation: 10,
                } : undefined]}>
                    <View style={styles.showLine} />
                    <View style={[styles.box, { left: getLineLeft() } as any]} />
                    {/* LinearGradient wrapped in an absolute View — see
                        StrikeWallet/index.tsx for the full explanation.
                        Paper-only react-native-linear-gradient doesn't
                        honor position:absolute through the Fabric legacy
                        interop on RN 0.77, so the pink fill never rendered
                        on the CoinOS home card either. */}
                    {/* Solid pink fill — see StrikeWallet for the full
                        explanation. LinearGradient inside the absolute
                        wrapper doesn't render under Fabric interop, so we
                        use a solid color and let the wrapper's percent
                        width control the fill. */}
                    <Reanimated.View style={[styles.linearGradient2, { backgroundColor: colors.pink.dark, minWidth: 6 } as any, fillStyle]} />
                </View>
            )}
        </>
    );

    return (
        <View>
            <TouchableOpacity
                style={wallet === 'ARK' ? styles.shadowViewArk : styles.shadowView}
                onPress={onCardClickHandler}
            >
                {wallet === 'ARK' ? (
                    <View
                        style={[
                            styles.shadowTop,
                            // Ark cards carry a thin yellow outline to signal
                            // the non-custodial provider at a glance — mirrors
                            // the same 1.5px yellow edge used on the "Create an
                            // Ark Wallet" CTA box (ArkWallet/styles.ts), and
                            // parallels the green edge on the Hot Vault card.
                            { borderWidth: 1.5, borderColor: colors.ark.light },
                        ]}
                    >
                        {cardChildren}
                    </View>
                ) : (
                    // Strike / CoinOS Lightning cards: a solid pink outline
                    // matches the Ark pattern (1.5px coloured edge on a
                    // primary-coloured body), but in pink to brand the
                    // custodial Lightning tier. The previous version wrapped
                    // the card in a pink-gradient ring (gradient1 → gradient2
                    // diagonal stops); that rendered the outline visibly
                    // pink only along the top-left edge where gradient1 sat,
                    // fading to near-dark on the bottom-right where
                    // gradient2 sat — looked like a half-coloured frame and
                    // an unintended 3D embossed effect closer to the vault
                    // cards than to the Lightning brand. Lightning is flat;
                    // the outline should be flat too.
                    <View
                        style={[
                            styles.shadowTop,
                            // colors.pink.dark (#FB17A0) — fully opaque hot
                            // pink, more saturated than colors.pink.default
                            // (rgba 0.9, reads slightly muted). Matches the
                            // visual weight of the Ark card's yellow outline.
                            { borderWidth: 1.5, borderColor: colors.pink.dark },
                        ]}
                    >
                        {cardChildren}
                    </View>
                )}
            </TouchableOpacity>
            {isShowButtons && !hideActionButtons &&
                <View style={styles.btnView}>
                    <GradientButtonWithShadow
                        title="Receive"
                        onPress={onReceiveClickHandler}
                        isShadow
                        isTextShadow
                    />
                    <GradientButtonWithShadow
                        title="Send"
                        onPress={onSendClickHandler}
                        isShadow
                        isTextShadow
                    />
                </View>
            }
        </View>
    )

}
