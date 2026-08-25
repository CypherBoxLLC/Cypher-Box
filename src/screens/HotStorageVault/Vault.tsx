import React, { useCallback, useContext, useRef, useState } from "react";
import { LoadingSpinner, Text } from "@Cypher/component-library";
import { Image, InteractionManager, RefreshControl, ScrollView, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import SimpleToast from "react-native-simple-toast";
import Share from 'react-native-share';
import 'text-encoding';
import QRCode from "react-native-qrcode-svg";
import Clipboard from "@react-native-clipboard/clipboard";

import { GradientView, SavingVault } from "@Cypher/components";
import styles from "./styles";

import { colors, heights, widths } from "@Cypher/style-guide";
import RBSheet from "react-native-raw-bottom-sheet";
import ReceivedList from "../HomeScreen/ReceivedList";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import { Copy, InformationNew, QrCode, Share as Share2, ShareNew } from "@Cypher/assets/images";
import { btc } from "@Cypher/helpers/coinosHelper";
import { formatBalance, formatBalanceWithoutSuffix } from "../../../loc";
import { dispatchNavigate } from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";

const shortenAddress = (address: string) => {
    // Show full address for security
    return address;
};

export default function Vault({ wallet, matchedRate, setSelectedTab }: { wallet: any, matchedRate: string, setSelectedTab: (tab: number) => void }) {
    const currency = btc(1);
    const { vaultTab, setVaultDisplayAddress } = useAuthStore();
    const balance = !wallet?.hideBalance && formatBalance(Number(wallet?.getBalance()), wallet?.getPreferredBalanceUnit(), true);
    const balanceWithoutSuffix = !wallet?.hideBalance && formatBalanceWithoutSuffix(Number(wallet?.getBalance()), wallet?.getPreferredBalanceUnit(), true);
    const { wallets, saveToDisk, sleep, isElectrumDisabled } = useContext(BlueStorageContext);
    const [address, setAddress] = useState<string | undefined>();
    const [refreshing, setRefreshing] = useState(false);
    // const base64QrCodeRef = useRef(''); // disabled: toDataURL broken under Fabric/New Arch

    const obtainWalletAddress = async () => {
        // A pinned address wins over generating a fresh one. Picked from
        // Settings > Show Addresses, and kept per walletID so hot and cold are
        // independent. Without this the useFocusEffect below would overwrite
        // the choice with a next-free address every time the tab regained
        // focus, which is to say immediately.
        const pinned = useAuthStore.getState().vaultDisplayAddress?.[wallet?.getID?.()];
        if (pinned) {
            setAddress(pinned);
            // Still subscribe it: the user picked it in order to be paid on it,
            // and an unsubscribed address gets no incoming-payment push.
            try {
                const GroundControl = require('../../../blue_modules/groundControl');
                await GroundControl.majorTomToGroundControl([pinned], [], []);
            } catch (notifyErr) {
                console.warn('[GroundControl] Failed to subscribe pinned address:', notifyErr);
            }
            return;
        }
        let newAddress;
        try {
            if (!isElectrumDisabled) newAddress = await Promise.race([wallet.getAddressAsync(), sleep(1000)]);
        } catch (_) { }
        if (newAddress === undefined) {
            // either sleep expired or getAddressAsync threw an exception
            console.warn('either sleep expired or getAddressAsync threw an exception');
            newAddress = wallet._getExternalAddressByIndex(wallet.getNextFreeAddressIndex());
        } else {
            saveToDisk(); // caching whatever getAddressAsync() generated internally
        }
        console.log('newAddress: ', newAddress)
        setAddress(newAddress);

        // Subscribe new address to GroundControl for push notifications
        try {
            const GroundControl = require('../../../blue_modules/groundControl');
            await GroundControl.majorTomToGroundControl([newAddress], [], []);
            console.log('[GroundControl] Subscribed new address:', newAddress);
        } catch (notifyErr) {
            console.warn('[GroundControl] Failed to subscribe address:', notifyErr);
        }

    }

    // Subscribing to the pin (not just reading it in the callback) is what makes
    // the tab update on arrival from the picker: navigation restores this tab
    // without necessarily re-firing focus.
    const pinnedAddress = useAuthStore(
        (st: any) => st.vaultDisplayAddress?.[wallet?.getID?.()],
    );

    useFocusEffect(
        useCallback(() => {
            if (wallet) {
                obtainWalletAddress();
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [wallet, pinnedAddress]),
    );

    const copyToClipboard = (text: string) => {
        Clipboard.setString(text);
        SimpleToast.show('Copied to clipboard', SimpleToast.SHORT);
    };

    // The "Vault Addresses" button on this tab. Same picker as
    // Settings > Show Addresses: tapping a row pins it as the address shown
    // here. Left read-only in the first pass on the theory that a browsing
    // surface and the thing it changes should not sit on one screen. That was
    // wrong in practice, because this is the button people actually reach for
    // when they want a different receive address, and an inert list next to the
    // QR it would change reads as broken rather than informational.
    const addressHandler = () => {
        dispatchNavigate('WalletAddresses', {
            walletID: wallet.getID(),
            isTouchable: true,
            selectForVaultDisplay: true,
        });
    }

    const addressClickHandler = () => {
        setSelectedTab(1)
    }

    const shareQRCode = async () => {
        try {
            console.log('base64QrCodeRef: ', base64QrCodeRef)

            const shareOptions = {
                message: `Bitcoin: ${address}`,
                url: `data:image/jpeg;base64,${base64QrCodeRef?.current}`,
            };

            await Share.open(shareOptions);

        } catch (error) {
            console.error('Error sharing QR code:', error);
        }
    };

    const onRefresh = async () => {
        setRefreshing(true);
        if (wallet) {
            obtainWalletAddress();
            await wallet?.fetchBalance();
        }
        setRefreshing(false);
    }

    return (
        <ScrollView
            style={styles.container}
            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                    tintColor="white"
                />
            }
        >
            <View>
            <SavingVault
                container={styles.savingVault}
                innerContainer={styles.savingVault}
                shadowTopBottom={styles.savingVault}
                shadowBottomBottom={styles.savingVault}
                bitcoinText={styles.bitcoinText}
                imageStyle={styles.bitcoinImage}
                titleStyle={styles.title}
                title={vaultTab ? "Cold Savings" : "Hot Savings"}
                bitcoinValue={balance}
                inDollars={`$${(Number(balanceWithoutSuffix) * Number(matchedRate || 0)).toFixed(2)}`}
            />
            
            <View style={styles.base}>
            
                <GradientView
                    onPress={addressHandler}
                    style={styles.linearGradientStyle}
                    linearGradientStyle={styles.mainShadowStyle}
                    topShadowStyle={[styles.outerShadowStyle, vaultTab && { shadowColor: colors.coldGreen }]}
                    bottomShadowStyle={[styles.innerShadowStyle, vaultTab && { shadowColor: colors.coldGreen }]}
                    linearGradientStyleMain={styles.linearGradientStyleMain}
                >
                    <Text h3 center>Vault Addresses</Text>
                </GradientView>
                {vaultTab &&
                    <Text style={{paddingRight: 20, paddingLeft:30, paddingTop: 20, fontSize: 15}}>
                        ⚠️ DO NOT use these addresses to receive funds without verifying their authenticity from your hardware device! 
                    </Text>
                }
                {/* <GradientView
                    onPress={addressClickHandler}
                    topShadowStyle={styles.outerShadowStyle}
                    bottomShadowStyle={styles.innerShadowStyle}
                    style={[styles.linearGradientStyle, { marginStart: 25 }]}
                    linearGradientStyle={styles.mainShadowStyle}
                    linearGradientStyleMain={styles.linearGradientStyleMain}
                >
                    <Text h3 center>Send Coins</Text>
                </GradientView> */}
            </View>
            </View>
            {/* {!vaultTab ?
                <View style={[styles.base, { marginHorizontal: 20 }]}>
                    <Image style={styles.info} source={InformationNew} />
                    <Text style={styles.textInfo} italic>What is a Savings Vault?</Text>
                </View>
            :
                <View style={[{ flex: 1, marginTop: 20, width: '80%', justifyContent: 'center', alignItems: 'center', alignSelf: 'center' }]}>
                    <Text style={[{fontSize: 14}]}>⚠️ DO NOT use these addresses to receive funds without verifying their authenticity from your hardware device! </Text>
                </View>
            } */}
            {address ?
                <>
                    {!vaultTab &&
                        <Text h4 style={styles.infoText}>You can use this vault address to receive sizable coins from another vault on the Bitcoin Network</Text>
                    }
                    {/* Solid borderColor (no LinearGradient wrapper) — the
                        previous Cold Vault path stacked greenShadow from
                        styles.qrcode UNDER a blue→teal gradient ring, which
                        under RN 0.77 Fabric renders as a smeared teal halo
                        with the green outer border showing through. Hot Vault
                        keeps its solid mint border via styles.qrcode default;
                        Cold Vault overrides borderColor to match the cold
                        button glow (colors.coldGreen, which is actually cyan
                        blue #21C7FB despite the name). */}
                    <View style={[styles.qrcode, vaultTab && { borderColor: colors.coldGreen }]}>
                        <View style={{ alignItems:'center', justifyContent: 'center', width: "100%", height: "100%", margin: 0, padding: 20, backgroundColor: 'white', borderRadius: 30 }}>
                            <QRCode
                                value={address}
                                size={175}
                                color="black"
                                backgroundColor="white"
                            />
                        </View>
                    </View>
                    <View style={styles.codeViewMain}>
                        {vaultTab ? (
                            <TouchableOpacity onPress={() => copyToClipboard(address)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, height: 44, width: widths - 80 }}>
                                <Image source={Copy} style={styles.copyImage} resizeMode="contain" />
                                <Text semibold style={{ fontSize: 15, color: colors.white, marginStart: 10 }}>{address || 'Loading...'}</Text>
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity style={styles.codeView} onPress={() => copyToClipboard(address)}>
                                <Image source={Copy} style={styles.copyImage} resizeMode="contain" />
                                <Text semibold style={styles.address}>{shortenAddress(address)}</Text>
                            </TouchableOpacity>
                        )}
                        {/* <TouchableOpacity onPress={shareQRCode}>
                            <Image source={ShareNew} style={styles.shareImage} resizeMode="contain" />
                        </TouchableOpacity> */}
                    </View>
{/* address shown inside copy button above */}
                    {pinnedAddress ? (
                        // Without this there is no way back. The pin survives
                        // every focus, so a user who picked an old address once
                        // would keep seeing it forever with nothing on screen
                        // explaining why it stopped advancing.
                        <TouchableOpacity
                            onPress={() => {
                                setVaultDisplayAddress(wallet?.getID?.(), null);
                                SimpleToast.show('Back to a fresh address', SimpleToast.SHORT);
                            }}
                            style={{ paddingHorizontal: 30, paddingTop: 10 }}
                        >
                            <Text style={{ fontSize: 13, color: colors.green, textAlign: 'center' }}>
                                You chose this address. Tap to go back to a fresh one.
                            </Text>
                        </TouchableOpacity>
                    ) : null}
                    {/* <Text h4 style={styles.infoText}>You can use this Bitcoin Network address of your vault to receive coins</Text> */}
                </>
                :
                <View style={{ marginTop: 100 }}>
                    <LoadingSpinner />
                </View>

            }
        </ScrollView>
    )
}