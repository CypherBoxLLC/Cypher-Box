import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Image, TouchableOpacity, View } from "react-native";
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
 * The USDT slide on Home.
 *
 * Locked until the user has been through the introduction, which is the whole
 * point of the locked state: the account already exists, derived from the Hot
 * Vault seed, so there is nothing to create. What the user has not done is
 * read who the providers are and what the risks are, and this card is what
 * sends them to do it.
 *
 * Renders nothing at all when there is no Hot Vault. Without a seed of our own
 * there is no Tron address to show, and a card offering USDT to a
 * Strike-only user would lead to a dead end rather than a flow.
 *
 * Nothing here logs. The balance is not secret, but the address it is read for
 * is derived from seed material and the surrounding code keeps that habit.
 */
export default function UsdtWallet() {
    const { isUsdtSwapsUnlocked, walletID } = useAuthStore();
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
        if (isUsdtSwapsUnlocked && address) {
            void readBalance();
        }
    }, [isUsdtSwapsUnlocked, address, readBalance]);

    if (!address) {
        return null;
    }

    if (!isUsdtSwapsUnlocked) {
        return (
            <View>
                <TouchableOpacity
                    style={styles.lockedCard}
                    onPress={() => dispatchNavigate('UsdtSwapsIntro')}
                    activeOpacity={0.8}
                >
                    <View style={styles.lockedMiddle}>
                        <Image
                            style={styles.lockedArrow}
                            resizeMode="contain"
                            source={require("../../../img/arrow-right.png")}
                        />
                        <Text h2 style={styles.lockedTitle} center>
                            Unlock Bitcoin-USDT swaps
                        </Text>
                    </View>
                </TouchableOpacity>
                <View style={styles.lockedFooter}>
                    <Text bold style={styles.lockedSubtitle}>
                        Hold dollars on Tron, swap them for bitcoin
                    </Text>
                    <TouchableOpacity onPress={() => dispatchNavigate('UsdtSwapsIntro')}>
                        <Text bold style={styles.lockedHint}>
                            Tap to learn how it works
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    const receiveClickHandler = () => {
        dispatchNavigate('UsdtSwapsAddress', { fromHome: true });
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
                                <Text h2 bold style={styles.balanceLabel}>USDT</Text>
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
