import React, { useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, TouchableOpacity, View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import { Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { getTronUsdtBalance } from "@Cypher/api/tronAPIs";
import { resolveHotVaultTronAccount } from "@Cypher/services/tron/account";
import { formatUsdtAmount } from "@Cypher/services/tron/format";
import useAuthStore from "@Cypher/stores/authStore";
import useUsdtSwapStore, { whenUsdtSwapStoreReady } from "@Cypher/stores/usdtSwapStore";
import { colors } from "@Cypher/style-guide";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import GradientView from "../GradientView";
import LinearBorderView from "../StrikeView/LinearBorderView";
import styles from "./styles";

/** The illustrative balance on the preview card. Not the user's. */
const PREVIEW_AMOUNT = '1,000';

/** When to read the balance again, after a failure and after a success. */
const RETRY_AFTER_FAILURE_MS = 15_000;
const REFRESH_AFTER_SUCCESS_MS = 60_000;

type Props = {
    /**
     * Show the card as an illustration: a sample balance, the buttons as
     * shapes only, nothing tappable, nothing read from the network. Used on
     * the last screen of Hot Vault creation, where the card is shown, not used.
     */
    preview?: boolean;
};

/**
 * The USDT balance card, on Home and at the end of Hot Vault creation.
 *
 * USDT comes with the Hot Vault: the Tron account is derived from the vault's
 * phrase, so a user who has a vault already has an address and there is
 * nothing to unlock. Outside preview the card renders nothing without one, and
 * Home only adds the slide when the vault holds a phrase, so that case is a
 * vault deleted while the card is on screen.
 *
 * Layout: balance top left with Receive under it; Swap stacked on Send on the
 * right, so Receive and Send share the bottom edge. The "?" beside the label
 * opens the guide.
 *
 * Nothing here logs. The balance is not secret, but the address it is read for
 * is derived from seed material and the surrounding code keeps that habit.
 */
export default function UsdtWallet({ preview = false }: Props) {
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    // Memoised because the derivation behind it runs BIP39's PBKDF2 over 2048
    // rounds. Skipped entirely for the preview, which shows no real address.
    const account = useMemo(
        () => (preview ? null : resolveHotVaultTronAccount(wallets, walletID)),
        [preview, wallets, walletID],
    );
    const address = account?.address ?? null;

    const [balance, setBalance] = useState<string | null>(null);

    // Read the balance, then keep it fresh. A failed read (an unreachable node,
    // a rate limit) keeps whatever is on screen and tries again shortly; until
    // the first success the card shows a spinner rather than a guessed zero.
    useEffect(() => {
        if (preview || !address) return undefined;
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        setBalance(null);
        const read = async () => {
            let wait = RETRY_AFTER_FAILURE_MS;
            try {
                const value = await getTronUsdtBalance(address);
                if (!alive) return;
                setBalance(value);
                wait = REFRESH_AFTER_SUCCESS_MS;
            } catch {
                // Kept quiet on purpose: the next read is the recovery.
            }
            if (alive) timer = setTimeout(read, wait);
        };
        void read();
        return () => {
            alive = false;
            if (timer) clearTimeout(timer);
        };
    }, [preview, address]);

    if (!preview && !address) {
        return null;
    }

    const amount = preview ? PREVIEW_AMOUNT : balance === null ? null : formatUsdtAmount(balance);

    // Undefined in preview: the buttons render as shapes that do nothing.
    const onGuide = preview ? undefined : () => dispatchNavigate('UsdtSwapsGuide');
    const onReceive = preview ? undefined : () => dispatchNavigate('UsdtReceive');
    // A swap under way, or one that ended but has not been dismissed, is
    // shown again rather than a new one started: while its deposit could
    // still land, starting another could pay twice. Waits for the stored swap
    // to be read back, since that decides which it is.
    const onSwap = preview
        ? undefined
        : () => {
              void whenUsdtSwapStoreReady().then(() =>
                  dispatchNavigate(useUsdtSwapStore.getState().record ? 'UsdtSwapProgress' : 'UsdtSwapAmount'),
              );
          };
    // Send needs its own stack (amount, destination, confirm), not built yet.
    const onSend = preview
        ? undefined
        : () => SimpleToast.show("Sending USDT is not available yet", SimpleToast.SHORT);

    return (
        <View style={styles.container} pointerEvents={preview ? 'none' : 'auto'}>
            <View style={styles.rowContainer}>
                <LinearBorderView>
                    <View style={styles.card}>
                        <View style={styles.column}>
                            <View style={styles.balanceBlock}>
                                <View style={styles.labelRow}>
                                    <Text h2 bold style={styles.balanceLabel}>USDT</Text>
                                    <TouchableOpacity
                                        onPress={onGuide}
                                        disabled={!onGuide}
                                        style={styles.helpButton}
                                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                        accessibilityRole="button"
                                        accessibilityLabel="How Bitcoin-USDT swaps work"
                                    >
                                        <Text bold style={styles.helpText}>?</Text>
                                    </TouchableOpacity>
                                </View>
                                {amount === null ? (
                                    <ActivityIndicator
                                        size="small"
                                        color={colors.usdt.light}
                                        style={styles.balanceSpinner}
                                    />
                                ) : (
                                    <Text
                                        h2
                                        bold
                                        style={styles.balanceAmount}
                                        numberOfLines={1}
                                        adjustsFontSizeToFit
                                    >
                                        {`${amount} USDT`}
                                    </Text>
                                )}
                            </View>
                            <ActionButton label="Receive" onPress={onReceive} />
                        </View>
                        <View style={styles.column}>
                            <ActionButton label="Swap" onPress={onSwap} spaced />
                            <ActionButton label="Send" onPress={onSend} />
                        </View>
                    </View>
                </LinearBorderView>
            </View>
        </View>
    );
}

/** One of the card's pill buttons. Without onPress it is a shape only. */
function ActionButton({ label, onPress, spaced = false }: { label: string; onPress?: () => void; spaced?: boolean }) {
    return (
        <GradientView
            style={spaced ? [styles.actionButton, styles.actionButtonSpaced] : styles.actionButton}
            linearGradientStyle={styles.actionGradient}
            topShadowStyle={styles.topShadow}
            bottomShadowStyle={styles.bottomShadow}
            linearGradientStyleMain={styles.actionGradientMain}
            onPress={onPress}
            disabled={!onPress}
        >
            <Text h3 bold center>{label}</Text>
        </GradientView>
    );
}
