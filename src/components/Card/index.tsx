import { CoinOS, CoinOSSmall, CoinOs, Electricity, Second, Strike2, StrikeFull } from "@Cypher/assets/images";
import { Text } from "@Cypher/component-library";
import { calculateBalancePercentage, calculatePercentage, dispatchNavigate } from "@Cypher/helpers";
import { formatNumber, formatSats, getStrikeCurrency } from "@Cypher/helpers/coinosHelper";
import { colors } from "@Cypher/style-guide";
import MaskedView from "@react-native-masked-view/masked-view";
import React from "react";
import { Image, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import GradientButtonWithShadow from "../GradientButtonWithShadow";
import styles from "./styles";
import useAuthStore from "@Cypher/stores/authStore";

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
}: Props) {
    const {coldStorageWalletID, walletID, allBTCWallets} = useAuthStore();

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

    const getWidth = () => {
        return `${calculateBalancePercentage(Number(balance), Number(withdrawThreshold), Number(reserveAmount))}%`
    }
    const onReceiveClickHandler = () => {
        if(allBTCWallets.length == 1 && !coldStorageWalletID && !walletID) {
            dispatchNavigate('CreateInvoice', {
                matchedRate,
                currency,
                receiveType: true
            });
        } else {
            receiveClickHandler?.(true);
        }
    }

    const onSendClickHandler = () => {
        if(allBTCWallets.length == 1 && !coldStorageWalletID && !walletID) {
            dispatchNavigate('SendScreen', {
                matchedRate,
                currency,
                receiveType: true
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
                    // White lightning bolt next to the "Ark Vault"
                    // title to mirror the icon-+-label pattern used
                    // in the Receive/Send tile, the Vault tab, and
                    // the Add-Account flow.
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Image
                            source={Electricity}
                            style={{ width: 12, height: 16, marginRight: 6, tintColor: '#FFFFFF' }}
                            resizeMode="contain"
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
                <Text h2 bold style={styles.sats}>
                    {getBalance()}
                </Text>
                <Text bold style={styles.totalsats}>
                    {getSats()}
                </Text>
            </View>
            <View style={thresholdMet ? {
                // Threshold-met glow tracks wallet branding so Ark glows
                // yellow rather than pink. Strike/CoinOS keep the pink glow.
                shadowColor: wallet === 'ARK' ? colors.ark.shadowTopNew : '#e84393',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 1,
                shadowRadius: 16,
                elevation: 10,
            } : undefined}>
                <View style={styles.showLine} />
                <View style={[styles.box, { left: getLineLeft() } as any]} />
                <LinearGradient
                    start={{ x: 0, y: 1 }} end={{ x: 1, y: 1 }}
                    colors={
                        wallet === 'ARK'
                            ? [colors.white, colors.ark.dark]
                            : [colors.white, colors.pink.dark]
                    }
                    style={[styles.linearGradient2, { width: getWidth() } as any]}>
                </LinearGradient>
            </View>
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
                    // Strike / CoinOS Lightning cards: a pink-gradient ring
                    // wraps the card surface to brand the custodial Lightning
                    // tier. Outer LinearGradient with 1.5px padding paints
                    // the visible outline; `shadowTopInner` (colors.primary)
                    // covers the center, leaving the 1.5px gradient ring.
                    <LinearGradient
                        colors={[colors.pink.gradient1, colors.pink.gradient2]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.shadowTopGradientOutline}
                    >
                        <View style={styles.shadowTopInner}>
                            {cardChildren}
                        </View>
                    </LinearGradient>
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
