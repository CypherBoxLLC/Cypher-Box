import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { TouchableOpacity, View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import { Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { getTronUsdtBalance } from "@Cypher/api/tronAPIs";
import { resolveHotVaultTronAccount } from "@Cypher/services/tron/account";
import useAuthStore from "@Cypher/stores/authStore";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import GradientView from "../GradientView";
import LinearBorderView from "../StrikeView/LinearBorderView";
import styles from "./styles";

/**
 * The USDT balance card, on Home and at the end of Hot Vault creation.
 *
 * USDT comes with the Hot Vault: the Tron account is derived from the vault's
 * phrase, so a user who has a vault already has an address and there is
 * nothing to unlock. The card renders nothing without one, and Home only adds
 * the slide when the vault holds a phrase, so that case is a vault deleted
 * while the card is on screen.
 *
 * The "?" beside the label opens the guide: what this is, who is involved,
 * where the key comes from. That material used to be two onboarding screens;
 * now that onboarding is the Hot Vault's own, it lives here for reference.
 *
 * Nothing here logs. The balance is not secret, but the address it is read for
 * is derived from seed material and the surrounding code keeps that habit.
 */
export default function UsdtWallet() {
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    // Memoised because the derivation behind it runs BIP39's PBKDF2 over 2048
    // rounds. Unmemoised it ran on every carousel scroll frame and every
    // balance tick, which is seconds of work on a slow phone.
    const account = useMemo(
        () => resolveHotVaultTronAccount(wallets, walletID),
        [wallets, walletID],
    );
    const address = account?.address ?? null;

    const [balance, setBalance] = useState<string | null>(null);
    const [balanceFailed, setBalanceFailed] = useState(false);
    // Guards a state write after the slide has gone, which the carousel does
    // on every composition change.
    const aliveRef = useRef(true);

    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
        };
    }, []);

    const readBalance = useCallback(async () => {
        if (!address) return;
        try {
            const next = await getTronUsdtBalance(address);
            if (!aliveRef.current) return;
            setBalance(next);
            setBalanceFailed(false);
        } catch {
            if (!aliveRef.current) return;
            // An unreachable node is an ordinary state here, not a fault: the
            // last known balance stays on screen and the row says it is stale
            // rather than showing a zero the user does not have.
            setBalanceFailed(true);
        }
    }, [address]);

    useEffect(() => {
        if (address) {
            void readBalance();
        }
    }, [address, readBalance]);

    if (!address) {
        return null;
    }

    const guideClickHandler = () => {
        dispatchNavigate('UsdtSwapsGuide');
    };

    const receiveClickHandler = () => {
        dispatchNavigate('UsdtReceive');
    };

    const sendClickHandler = () => {
        // The send flow is its own screen stack (amount, destination, the fee
        // confirmation the quote returns) and is not built yet. The button is
        // here because the card is designed around the pair; replace this with
        // the navigate once that stack lands.
        SimpleToast.show("Sending USDT is not available yet", SimpleToast.SHORT);
    };

    return (
        <View style={styles.container}>
            <View style={styles.rowContainer}>
                <LinearBorderView>
                    <View style={styles.usdtRow}>
                        <View style={styles.sideContainer}>
                            <View style={styles.balanceBox}>
                                <View style={styles.labelRow}>
                                    <Text h2 bold style={styles.balanceLabel}>USDT</Text>
                                    <TouchableOpacity
                                        onPress={guideClickHandler}
                                        style={styles.helpButton}
                                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                        accessibilityRole="button"
                                        accessibilityLabel="How Bitcoin-USDT swaps work"
                                    >
                                        <Text bold style={styles.helpText}>?</Text>
                                    </TouchableOpacity>
                                </View>
                                <Text h2 bold style={styles.balanceAmount}>
                                    {balance === null ? '...' : `$${balance}`}
                                </Text>
                                {balanceFailed && (
                                    <Text style={styles.balanceSub}>
                                        Balance may be out of date
                                    </Text>
                                )}
                            </View>
                        </View>

                        <View style={styles.sideContainer}>
                            <GradientView
                                style={[styles.actionButton, styles.receiveButton]}
                                linearGradientStyle={styles.actionGradient}
                                topShadowStyle={styles.topShadow}
                                bottomShadowStyle={styles.bottomShadow}
                                linearGradientStyleMain={styles.actionGradientMain}
                                onPress={receiveClickHandler}
                            >
                                <Text h3 bold center>Receive</Text>
                            </GradientView>
                            <GradientView
                                style={[styles.actionButton, styles.sendButton]}
                                linearGradientStyle={styles.actionGradient}
                                topShadowStyle={styles.topShadow}
                                bottomShadowStyle={styles.bottomShadow}
                                linearGradientStyleMain={styles.actionGradientMain}
                                onPress={sendClickHandler}
                            >
                                <Text h3 bold center>Send</Text>
                            </GradientView>
                        </View>
                    </View>
                </LinearBorderView>
            </View>
        </View>
    );
}
