import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./styles";
import { Dimensions, Image, ScrollView, StyleSheet, TouchableOpacity, View, Animated as RNAnimated, InteractionManager, ActivityIndicator, Alert } from "react-native";
import { Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import { Back } from "@Cypher/assets/images";
import Animated, {
    useSharedValue,
    withTiming,
    Easing,
    useAnimatedStyle,
} from "react-native-reanimated";

import SimpleToast from "react-native-simple-toast";

import { PrivateKeyGenerater, Tips } from "@Cypher/components";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import useAuthStore from "@Cypher/stores/authStore";
import { AbstractHDElectrumWallet } from "../../../class/wallets/abstract-hd-electrum-wallet";
import { dispatchNavigate } from "@Cypher/helpers";
import Biometric from "../../../class/biometrics";
import {
    backupHotVaultSeedWithMeta,
    listHotVaultKeychainBackups,
    resetHotVaultBackupFully,
    resetHotVaultKeychainBackup,
    resetHotVaultMeta,
} from "@Cypher/services/hotVaultKeychain";
import SignerButton from "../SigningHome/SignerButton";
import { recordEvent } from "@Cypher/stores/eventLogStore";
import triggerHapticFeedback, { HapticFeedbackTypes } from "../../../blue_modules/hapticFeedback";
import loc from "../../../loc";
import Notifications from "../../../blue_modules/notifications";
import showPrompt from "@Cypher/helpers/prompt";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { useRoute } from "@react-navigation/native";
import { WatchOnlyWallet } from "../../../class";
import DeeplinkSchemaMatch from "../../../class/deeplink-schema-match";
import useImportTransaction from "./useImportTransaction";
import { startSigning } from "../SignOnce/start";
import { getBuildNumber, getVersion } from "react-native-device-info";

// `header` is for a signing phone's home, where this is the whole screen: the signer goes above the rows, and the
// screen scrolls
export default function Settings({wallet, to, matchedRate, toStrike, header}: any) {
    // const [right] = useState(new Animated.Value(0));
    const firstView = useSharedValue(1);
    const secondView = useSharedValue(0);
    const thirdView = useSharedValue(0);
    const [right] = useState(new RNAnimated.Value(0));
    const [viewType, setViewType] = useState(0);
    const Container: any = header ? ScrollView : View;
    const scrollRef = useRef<any>(null);
    const { wallets, isAdvancedModeEnabled, saveToDisk, deleteWallet } = useContext(BlueStorageContext);
    const {
        setWalletID,
        setColdStorageWalletID,
        vaultTab,
        walletID,
        coldStorageWalletID,
        hotVaultKeychainBackups,
        setHotVaultKeychainBackup,
    } = useAuthStore();
    const [keychainBusy, setKeychainBusy] = useState(false);
    const thisWalletID = wallet?.getID?.();
    const isKeychainBackedUp = thisWalletID
        ? !!hotVaultKeychainBackups?.[thisWalletID]
        : false;
    // On a signing phone, whether the Keychain really holds a copy of this vault's seed, from listing the Keychain
    // (which doesn't open anything): the hint above can be out of date, and a copy nobody can see is the one thing a
    // signing phone mustn't keep.
    const [keychainCopy, setKeychainCopy] = useState(false);
    useEffect(() => {
        if (!header || !thisWalletID) return;
        listHotVaultKeychainBackups()
            .then(ids => setKeychainCopy(ids.includes(thisWalletID)))
            .catch(() => {});
    }, [header, thisWalletID, isKeychainBackedUp]);
    // const wallet = vaultTab ? useRef(wallets.find(w => w.getID() === coldStorageWalletID)).current : useRef(wallets.find(w => w.getID() === walletID)).current;
    // on a signing phone this tab sits on the home screen, which can have no params
    const { name, params: routeParams = {} } = useRoute();
    const { isEditable } = routeParams;
    const [transactionMemo, setTransactionMemo] = useState('');
    const { importFromFile: importTransaction, importFromQr: importQrTransaction } = useImportTransaction(wallet, transactionMemo);

    const [hideTransactionsInWalletsList, setHideTransactionsInWalletsList] = useState(!wallet.getHideTransactionsInWalletsList());
    const [isAdvancedModeEnabledRender, setIsAdvancedModeEnabledRender] = useState(false);
    const [isBIP47Enabled, setIsBIP47Enabled] = useState(wallet.isBIP47Enabled());
    const [masterFingerprint, setMasterFingerprint] = useState();
    const [isLoading, setIsLoading] = useState(false);
    const derivationPath = useMemo(() => {
        try {
            const path = wallet.getDerivationPath();
            return path.length > 0 ? path : null;
        } catch (e) {
            return null;
        }
    }, [wallet]);

    useLayoutEffect(() => {
        isAdvancedModeEnabled().then(setIsAdvancedModeEnabledRender);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hideTransactionsInWalletsList, isBIP47Enabled]);

    useEffect(() => {
        // decode route params
        if (routeParams.uri) {
            try {
                const { address, amount, memo, payjoinUrl: pjUrl } = DeeplinkSchemaMatch.decodeBitcoinUri(routeParams.uri);
                if (memo?.trim().length > 0) {
                    setTransactionMemo(memo);
                }
            } catch (error) {
                console.log(error);
                Alert.alert(loc.errors.error, loc.send.details_error_decode);
            }
        }
    }, [routeParams]);


    useEffect(() => {
        if (isAdvancedModeEnabledRender && wallet.allowMasterFingerprint()) {
            InteractionManager.runAfterInteractions(() => {
                setMasterFingerprint(wallet.getMasterFingerprintHex());
            });
        }
    }, [isAdvancedModeEnabledRender, wallet]);


    const nextClickInitiate = () => {
        backClickHandler();
    }

    const infoViewClickHandler = () => {
        firstView.value = withTiming(0, {
            duration: 1000,
            easing: Easing.linear,
        });

        secondView.value = withTiming(1, {
            duration: 1000,
            easing: Easing.linear,
        });
    }

    const backupSeedPhraseClickHandler = () => {
        setViewType(1);
        // the second panel starts at the top, which may be scrolled out of sight on a signing phone's home
        scrollRef.current?.scrollTo?.({ y: 0, animated: true });
        RNAnimated.timing(right, {
            toValue: Dimensions.get('window').width * 1.15,
            duration: 250,
            useNativeDriver: false,
        }).start();
        // firstView.value = withTiming(0, {
        //     duration: 1000,
        //     easing: Easing.linear,
        // });

        // thirdView.value = withTiming(1, {
        //     duration: 1000,
        //     easing: Easing.linear,
        // });
    }

    /**
     * Retroactive "save seed to Keychain" for an existing hot vault.
     *
     * Distinct from the creation-time opt-in on SavingVault: this path is for
     * users who either declined the Switch at creation, or existed before
     * Keychain backup shipped. Reads the mnemonic directly from the in-memory
     * wallet object (already decrypted by BlueApp on launch), so no extra
     * biometric prompt — the write itself is silent with our access-control
     * settings; only the future READ will prompt FaceID/passcode.
     */
    const handleKeychainBackup = async () => {
        if (keychainBusy) return;
        const mnemonic = wallet?.getSecret?.();
        if (!thisWalletID || !mnemonic) {
            SimpleToast.show("Could not read vault seed", SimpleToast.SHORT);
            return;
        }
        setKeychainBusy(true);
        // Retroactive backup from vault Settings — stamp `createdAt` with
        // "now" so the row in the Recover picker reflects when the user
        // actually chose to back this vault up, not when the wallet
        // itself was generated. Same helper as the create flow so both
        // paths end up with a matching meta sidecar.
        const result = await backupHotVaultSeedWithMeta(
            thisWalletID,
            mnemonic,
            { createdAt: Date.now() },
        );
        setKeychainBusy(false);
        if (result.ok) {
            setHotVaultKeychainBackup(thisWalletID, true);
            triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
            SimpleToast.show("Seed backed up to Keychain", SimpleToast.SHORT);
        } else {
            console.warn("[HotVault] Keychain save failed:", result.error);
            SimpleToast.show("Keychain save failed", SimpleToast.LONG);
        }
    };

    const handleKeychainRemove = () => {
        if (keychainBusy || !thisWalletID) return;
        Alert.alert(
            "Remove Keychain backup?",
            header
                ? "The copy of this seed in this phone's secure storage is removed. The seed on this phone and your paper or SeedQR backup aren't affected. A seed-signer doesn't keep this second copy, so it can't be made again here."
                : "The 12 words will be removed from this device's Keychain. Your wallet and its paper backup are not affected. You can re-enable this anytime.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Remove",
                    style: "destructive",
                    onPress: async () => {
                        setKeychainBusy(true);
                        // Full wipe — seed + meta sidecar. Leaving a meta
                        // orphan would make the Recover screen render a
                        // legacy-looking row for a vault the user just
                        // asked to remove; `resetHotVaultBackupFully`
                        // tears down both atomically (from caller POV).
                        const ok = await resetHotVaultBackupFully(
                            thisWalletID,
                        );
                        setKeychainBusy(false);
                        // Clear the zustand hint either way — if the Keychain
                        // call failed, the entry may or may not still exist,
                        // but the user asked to forget about it and we'd
                        // rather be optimistic than leave a stale "✓".
                        setHotVaultKeychainBackup(thisWalletID, false);
                        // the signing phone's row goes by what the Keychain holds, so look again
                        if (header) {
                            listHotVaultKeychainBackups()
                                .then(ids => setKeychainCopy(ids.includes(thisWalletID)))
                                .catch(() => {});
                        }
                        if (ok) {
                            triggerHapticFeedback(
                                HapticFeedbackTypes.NotificationSuccess,
                            );
                        }
                    },
                },
            ],
        );
    };

    const backClickHandler = () => {
        // secondView.value = withTiming(0, {
        //     duration: 1000,
        //     easing: Easing.linear,
        // });

        // thirdView.value = withTiming(0, {
        //     duration: 1000,
        //     easing: Easing.linear,
        // });

        // firstView.value = withTiming(1, {
        //     duration: 1000,
        //     easing: Easing.linear,
        // });
    }

    const animatedStyle = useAnimatedStyle(() => {
        return {
            opacity: firstView.value, // Use the value directly
            zIndex: firstView.value === 0 ? 0 : 1,
        };
    });

    const animatedStyle2 = useAnimatedStyle(() => {
        return {
            opacity: secondView.value, // Use the value directly 
            zIndex: secondView.value === 0 ? 0 : 1,
        };
    });

    const animatedStyle3 = useAnimatedStyle(() => {
        return {
            opacity: thirdView.value, // Use the value directly 
            zIndex: thirdView.value === 0 ? 0 : 1,
        };
    });

    const leftToRight = () => {
        RNAnimated.timing(right, {
            toValue: 0,
            duration: 250,
            useNativeDriver: false,
        }).start();
    };

    const rightToLeft = async () => {
        setViewType(0);
        scrollRef.current?.scrollTo?.({ y: 0, animated: true });
        RNAnimated.timing(right, {
            toValue: Dimensions.get('window').width * 1.32,
            duration: 250,
            useNativeDriver: false,
        }).start();
    };

    // Picks which address the Vault tab shows. Serves the cold vault too: this
    // screen is shared, and the selection is keyed by walletID.
    const navigateToAddresses = () =>
        dispatchNavigate('WalletAddresses', {
            walletID: wallet.getID(),
            isTouchable: true,
            selectForVaultDisplay: true,
        });

    const navigateToXPub = () =>
        dispatchNavigate('WalletXpubRoot', {
            screen: 'WalletXpub',
            params: {
                walletID: wallet.getID(),
            },
        });

    const navigateToOverviewAndDeleteWallet = () => {
        setIsLoading(true);
        let externalAddresses = [];
        try {
            externalAddresses = wallet.getAllExternalAddresses();
        } catch (_) { }
        Notifications.unsubscribe(externalAddresses, [], []);

        // DO NOT wipe the Keychain backup on wallet delete. The whole point
        // of the Keychain backup is to survive wallet deletion and app
        // reinstall so the user can recover via the "Recover from Keychain"
        // flow. Tearing it down here would make that flow useless in the
        // most common recovery scenario (user deletes a vault they meant to
        // keep, or wipes app data). The Recover screen's enumeration is the
        // canonical UI path to surface any retained backups. Explicit
        // "remove backup" still exists in vault Settings for users who want
        // to purge the Keychain entry while keeping the wallet.

        deleteWallet(wallet);
        vaultTab ? setColdStorageWalletID(undefined) : setWalletID(undefined);
        // Activity log: only emit for cold-vault deletions; hot-vault
        // deletions are intentionally not logged (Bam's call — symmetry
        // isn't a strong enough reason to ship an unrequested event kind).
        if (vaultTab) {
            recordEvent({ kind: 'cold-vault-deleted' });
        }
        dispatchReset('HomeScreen');
        saveToDisk(true);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
    };

    const presentWalletHasBalanceAlert = useCallback(async () => {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationWarning);
        try {
            const walletBalanceConfirmation = await showPrompt(
                "Delete Vault",
                loc.formatString("This vault has a balance. Before proceeding, please be aware that you will not be able to recover the funds without this vault’s seed phrase. In order to avoid accidental removal, please enter your vault’s balance of {balance} satoshis.", { balance: wallet.getBalance() }),
                true,
                'plain-text',
                true,
                "Delete"
            );
            if (Number(walletBalanceConfirmation) === wallet.getBalance()) {
                navigateToOverviewAndDeleteWallet();
            } else {
                triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
                setIsLoading(false)
                // alert("The provided balance amount does not match this wallet’s balance. Please try again.");
            }
        } catch (_) { }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleDeleteButtonTapped = () => {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationWarning);
        Alert.alert(
            "Delete Vault",
            "Are you sure?",
            [
                {
                    text: "Yes, delete",
                    onPress: async () => {
                        const isBiometricsEnabled = await Biometric.isBiometricUseCapableAndEnabled();
                        if (isBiometricsEnabled) {
                            if (!(await Biometric.unlockWithBiometrics())) {
                                return;
                            }
                        }
                        if (wallet.getBalance() > 0 && wallet.allowSend()) {
                            presentWalletHasBalanceAlert();
                        } else {
                            navigateToOverviewAndDeleteWallet();
                        }
                    },
                    style: 'destructive',
                },
                { text: "No, cancel", onPress: () => { }, style: 'cancel' },
            ],
            { cancelable: false },
        );
    };

    // Signs for a watch-only wallet (a Cold Vault on another phone, Sparrow...): the sign-once screen scans the
    // transaction and shows what it does before anything is signed
    const handlePsbtSign = () => startSigning({ mode: 'vault' });

    // A signing phone's Delete is a wipe: the seed leaves the phone, Keychain backup included, which an ordinary
    // delete keeps for recovery. The app's copy only goes once the Keychain one is confirmed gone, so a failure never
    // leaves the user thinking the seed is off the phone when it isn't.
    const wipeSeed = async () => {
        if (await Biometric.isBiometricUseCapableAndEnabled()) {
            if (!(await Biometric.unlockWithBiometrics())) return;
        }
        const keychainCleared =
            (await resetHotVaultKeychainBackup(thisWalletID)) &&
            !(await listHotVaultKeychainBackups()).includes(thisWalletID);
        if (!keychainCleared) {
            Alert.alert(
                'The seed is still on this phone',
                "Its backup in this phone's secure storage couldn't be removed, so the seed was left in the app too. Try again.",
            );
            return;
        }
        // the backup's date and label, nothing secret
        await resetHotVaultMeta(thisWalletID);
        setHotVaultKeychainBackup(thisWalletID, false);
        navigateToOverviewAndDeleteWallet();
        SimpleToast.show('Seed wiped from this phone', SimpleToast.LONG);
    };

    const handleWipeTapped = () => {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationWarning);
        Alert.alert(
            'Wipe the seed from this phone?',
            "This seed is removed from the app and from this phone's secure storage. After that only a backup kept elsewhere, on paper or as a SeedQR, can bring it back, so check you have one. Your coins aren't affected.\n\nIf this phone is ever stolen, getting a seed out of it is very difficult, but assume it's compromised and move your coins to a new seed.",
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Wipe', style: 'destructive', onPress: wipeSeed },
            ],
        );
    };

    // A signing phone's home has these under the signer, as one list of buttons, in the order they're needed: the
    // public key goes to the watch-only wallet first, then the seed is backed up and the addresses checked against
    // that wallet's, then help and other ways to sign, and last the wipe. There's no way out of the mode: it's one-way
    // (services/seedSignerLock). The same actions as the rows of an everyday Hot Vault, without signing (it's above).
    const signerButtons: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }[] = [
        { label: 'Seed’s Public Key (xpub)', onPress: navigateToXPub },
        { label: 'Make a SeedQR Backup', onPress: () => dispatchNavigate('SeedQRBackup', { walletID: wallet.getID() }) },
        { label: 'Show Addresses', onPress: navigateToAddresses },
        { label: 'Backup Seed Phrase', onPress: backupSeedPhraseClickHandler },
        // No backing up to the Keychain here: a signing phone keeps no second copy of the seed, one that outlives
        // deleting the vault or the app. A copy made before, in normal mode or by an earlier version, can be removed.
        ...(keychainCopy || isKeychainBackedUp
            ? [{
                label: keychainBusy ? 'Removing Keychain Copy…' : 'Remove Seed Copy from Keychain',
                onPress: handleKeychainRemove,
                disabled: keychainBusy,
            }]
            : []),
        { label: 'Signing Safely', onPress: () => dispatchNavigate('SigningSafetyGuide') },
        { label: 'Sign from a Backup Instead', onPress: () => startSigning() },
        { label: 'Info', onPress: rightToLeft },
        { label: 'App Settings', onPress: () => dispatchNavigate('Settings') },
        { label: 'Wipe Seed from This Phone', onPress: handleWipeTapped, danger: true },
    ];

    return (
        <Container ref={scrollRef} style={{
            flex: 1,
        }}>
            {isLoading ?
                <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
                    <ActivityIndicator color={'white'} />
                </View>
            :
                // Animation target: slide the row container left to
                // expose the second panel (settingView2). Originally
                // used `style={{ right: <Animated.Value> }}`, which
                // iOS honored as a layout offset on a non-positioned
                // View but Android (and especially Fabric under RN
                // 0.76 New Arch) silently ignored — the seed-reveal
                // button appeared to do nothing. translateX is the
                // portable equivalent: `right` increasing by N is the
                // same as `translateX` of -N.
                <RNAnimated.View
                    style={[
                        styles.main,
                        { transform: [{ translateX: RNAnimated.multiply(right, -1) }] },
                    ]}
                >
                    {header ? (
                        <View style={styles.signerRows}>
                            {header}
                            {signerButtons.map(button => (
                                <SignerButton key={button.label} {...button} />
                            ))}
                        </View>
                    ) : (
                        <View style={styles.settingView}>
                            {/* <View style={styles.rowview}>
                                <Text bold style={styles.text}>Name Your Vault</Text>
                                <View style={styles.blankspace} />
                            </View> */}
                            {/* <View style={styles.line} /> */}
                            {!vaultTab &&
                                <>
                                    <TouchableOpacity onPress={backupSeedPhraseClickHandler}>
                                        <Text bold style={styles.text}>Backup Seed Phrase</Text>
                                    </TouchableOpacity>
                                    <View style={styles.line} />
                                    {/*
                                      Keychain backup tile. Hidden on cold vault
                                      (!vaultTab) because cold vaults are typed-in
                                      watch-only xpubs with no on-device secret to
                                      back up — the seed lives on the signing device.
                                    */}
                                    <TouchableOpacity
                                        onPress={
                                            isKeychainBackedUp
                                                ? handleKeychainRemove
                                                : handleKeychainBackup
                                        }
                                        disabled={keychainBusy}
                                    >
                                        <Text bold style={styles.text}>
                                            {keychainBusy
                                                ? "Updating Keychain…"
                                                : isKeychainBackedUp
                                                ? "Seed saved to Keychain ✓ · Remove"
                                                : "Back up seed to iPhone Keychain"}
                                        </Text>
                                    </TouchableOpacity>
                                    <View style={styles.line} />
                                </>
                            }
                            {wallet instanceof AbstractHDElectrumWallet && (
                                <>
                                    <TouchableOpacity onPress={navigateToAddresses}>
                                        <Text bold style={styles.text}>Show Addresses</Text>
                                    </TouchableOpacity>
                                    <View style={styles.line} />
                                </>
                            )}
                            {wallet.allowXpub() && (
                                <>
                                    <TouchableOpacity onPress={navigateToXPub}>
                                        <Text bold style={styles.text}>Vault’s Public Key (xpub)</Text>
                                    </TouchableOpacity>
                                    <View style={styles.line} />
                                </>
                            )}
                            <TouchableOpacity onPress={rightToLeft}>
                                <Text bold style={styles.text}>Info</Text>
                            </TouchableOpacity>
                            <View style={styles.line} />
                            {wallet && !vaultTab && wallet.allowCosignPsbt() && (
                                <>
                                    {/* the phrase as a QR to copy by hand: lets a signing phone sign from the backup by scanning */}
                                    <TouchableOpacity onPress={() => dispatchNavigate('SeedQRBackup', { walletID: wallet.getID() })}>
                                        <Text bold style={styles.text}>Make a SeedQR backup</Text>
                                    </TouchableOpacity>
                                    <View style={styles.line} />
                                </>
                            )}
                            {wallet && !vaultTab && wallet.allowCosignPsbt() && (
                                <TouchableOpacity onPress={() => handlePsbtSign()}>
                                    <Text bold style={styles.text}>{loc.send.psbt_sign}</Text>
                                </TouchableOpacity>
                            )}
                            {/* {wallet && !vaultTab && wallet.allowCosignPsbt() && (
                                <TouchableOpacity onPress={() => handlePsbtSign(toStrike)}>
                                    <Text bold style={styles.text}>{"Sign a transaction for Strike"}</Text>
                                </TouchableOpacity>
                            )} */}
                            {wallet && vaultTab && wallet.type === WatchOnlyWallet.type && wallet.isHd() && (
                                <>
                                    <TouchableOpacity onPress={importTransaction}>
                                        <Text bold style={styles.text}>{loc.send.details_adv_import}</Text>
                                    </TouchableOpacity>
                                    <View style={styles.line} />             
                                </>        
                            )}
                            {wallet && wallet.type === WatchOnlyWallet.type && wallet.isHd() && (
                                <TouchableOpacity onPress={importQrTransaction}>
                                    <Text bold style={styles.text}>{loc.send.details_adv_import_qr}</Text>
                                </TouchableOpacity>                                                
                            )}

                            <View style={styles.line} />
                            <TouchableOpacity onPress={handleDeleteButtonTapped}>
                                <Text bold style={StyleSheet.flatten([styles.text, { color: colors.red }])}>Delete</Text>
                            </TouchableOpacity>
                            <View style={styles.line} />
                        </View>
                    )}
                    {viewType == 0 ?
                        <View style={styles.settingView2}>
                            <TouchableOpacity onPress={leftToRight}>
                                <Image source={Back} style={styles.backbtn} />
                            </TouchableOpacity>
                            <View style={styles.typeView}>
                                <Text bold style={styles.typeText}>Type</Text>
                                <Text h3>{wallet.typeReadable}</Text>
                            </View>
                            <View style={styles.typeView}>
                                <Text bold style={styles.typeText}>Transaction count</Text>
                                <Text h3>{wallet.getTransactions().length || 0}</Text>
                            </View>
                            {/* compared between the two phones when one of them only signs */}
                            <View style={styles.typeView}>
                                <Text bold style={styles.typeText}>App version</Text>
                                <Text h3>{`${getVersion()} (build ${getBuildNumber()})`}</Text>
                            </View>
                            {isAdvancedModeEnabledRender && (
                                <>
                                    <View style={styles.typeView}>
                                        <Text bold style={styles.typeText}>Master fingerprint</Text>
                                        <Text h3>{masterFingerprint ?? <ActivityIndicator />}</Text>
                                    </View>
                                    {derivationPath && (
                                        <View style={styles.typeView}>
                                            <Text bold style={styles.typeText}>Derivation path</Text>
                                            <Text h3>{derivationPath}</Text>
                                        </View>
                                    )}
                                </>
                            )}
                        </View>
                        :
                        <View style={styles.settingView2}>
                            <View style={styles.backupView}>
                                <TouchableOpacity onPress={leftToRight}>
                                    <Image source={Back} style={styles.backbtn} />
                                </TouchableOpacity>
                                <Text h4 style={styles.titleBackup}>Write  this backup copy on a piece of paper</Text>
                            </View>
                            <PrivateKeyGenerater callNext={nextClickInitiate} />
                            <Tips />
                        </View>
                    }
                </RNAnimated.View>            
            }
            {/* <Animated.View style={[styles.main, animatedStyle]}>
                <View style={styles.settingView}>
                    <Text bold style={styles.text}>Name Your Vault</Text>
                    <View style={styles.line} />
                    <TouchableOpacity onPress={backupSeedPhraseClickHandler}>
                        <Text bold style={styles.text}>Backup Seed Phrase</Text>
                    </TouchableOpacity>
                    <View style={styles.line} />
                    <Text bold style={styles.text}>Show Addresses</Text>
                    <View style={styles.line} />
                    <Text bold style={styles.text}>Vault’s Public Key (xpub)</Text>
                    <View style={styles.line} />
                    <TouchableOpacity onPress={infoViewClickHandler}>
                        <Text bold style={styles.text}>Info</Text>
                    </TouchableOpacity>
                    <View style={styles.line} />
                    <Text bold style={StyleSheet.flatten([styles.text, { color: colors.red }])}>Delete</Text>
                    <View style={styles.line} />
                </View>
            </Animated.View>
            <Animated.View style={[styles.infoView, animatedStyle2]}>
                <View style={styles.settingView2}>
                    <TouchableOpacity onPress={backClickHandler}>
                        <Image source={Back} style={styles.backbtn} />
                    </TouchableOpacity>
                    <View style={styles.typeView}>
                        <Text bold style={styles.typeText}>Type</Text>
                        <Text h3>HD SegWit (BIP BECH32 Native)</Text>
                    </View>
                    <View style={styles.typeView}>
                        <Text bold style={styles.typeText}>Transaction count</Text>
                        <Text h3>0</Text>
                    </View>
                    <View style={styles.typeView}>
                        <Text bold style={styles.typeText}>Mater fingerprint</Text>
                        <Text h3>78AD4F2A</Text>
                    </View>
                    <View style={styles.typeView}>
                        <Text bold style={styles.typeText}>Derivation path</Text>
                        <Text h3>m/84’/0’/0’</Text>
                    </View>
                </View>
            </Animated.View>
            <Animated.View style={[styles.infoView, animatedStyle3]}>
                <View style={styles.settingView2}>
                    <View style={styles.backupView}>
                        <TouchableOpacity onPress={backClickHandler}>
                            <Image source={Back} style={styles.backbtn} />
                        </TouchableOpacity>
                        <Text h4 style={styles.titleBackup}>Write  this backup copy on a piece of paper</Text>
                    </View>
                    <PrivateKeyGenerater callNext={nextClickInitiate} />
                    <Tips />
                </View>
            </Animated.View> */}

        </Container>
    )
}
