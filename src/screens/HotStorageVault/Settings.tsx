import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./styles";
import { Dimensions, Image, StyleSheet, TouchableOpacity, View, Animated as RNAnimated, InteractionManager, ActivityIndicator, Alert, Platform } from "react-native";
import { Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import { Back } from "@Cypher/assets/images";
import Animated, {
    useSharedValue,
    withTiming,
    Easing,
    useAnimatedStyle,
} from "react-native-reanimated";
import * as bitcoin from 'bitcoinjs-lib';
import DocumentPicker from 'react-native-document-picker';
import RNFS from 'react-native-fs';

import { PrivateKeyGenerater, Tips } from "@Cypher/components";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import useAuthStore from "@Cypher/stores/authStore";
import { AbstractHDElectrumWallet } from "../../../class/wallets/abstract-hd-electrum-wallet";
import { dispatchNavigate } from "@Cypher/helpers";
import Biometric from "../../../class/biometrics";
import triggerHapticFeedback, { HapticFeedbackTypes } from "../../../blue_modules/hapticFeedback";
import loc from "../../../loc";
import Notifications from "../../../blue_modules/notifications";
import showPrompt from "@Cypher/helpers/prompt";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { useNavigation, useRoute } from "@react-navigation/native";
import { requestCameraAuthorization, scanQrHelper } from "../../../helpers/scan-qr";
import BigNumber from "bignumber.js";
import { WatchOnlyWallet } from "../../../class";
import DeeplinkSchemaMatch from "../../../class/deeplink-schema-match";

export default function Settings({wallet, to, matchedRate, toStrike}: any) {
    // const [right] = useState(new Animated.Value(0));
    const firstView = useSharedValue(1);
    const secondView = useSharedValue(0);
    const thirdView = useSharedValue(0);
    const [right] = useState(new RNAnimated.Value(0));
    const [viewType, setViewType] = useState(0);
    const { wallets, isAdvancedModeEnabled, saveToDisk, deleteWallet } = useContext(BlueStorageContext);
    const { setWalletID, setColdStorageWalletID, vaultTab, walletID, coldStorageWalletID } = useAuthStore()
    // const wallet = vaultTab ? useRef(wallets.find(w => w.getID() === coldStorageWalletID)).current : useRef(wallets.find(w => w.getID() === walletID)).current;
    const routeName = useRoute().name;
    const navigation = useNavigation();
    const { name, params: routeParams } = useRoute();
    const { isEditable } = routeParams;
    const [transactionMemo, setTransactionMemo] = useState('');

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
        RNAnimated.timing(right, {
            toValue: Dimensions.get('window').width * 1.32,
            duration: 250,
            useNativeDriver: false,
        }).start();
    };

    const navigateToAddresses = () =>
        dispatchNavigate('WalletAddresses', {
            walletID: wallet.getID(),
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
        deleteWallet(wallet);
        vaultTab ? setColdStorageWalletID(undefined) : setWalletID(undefined);
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

    const handlePsbtSign = async () => {
        setIsLoading(true);
        await new Promise(resolve => setTimeout(resolve, 100)); // sleep for animations
        console.log('routeName: ', routeName)
        const scannedData = await scanQrHelper(navigation.navigate, routeName, { wallet, matchedRate });
        if (!scannedData) return setIsLoading(false);
    
        let tx;
        let psbt;
        try {
          psbt = bitcoin.Psbt.fromBase64(scannedData);
          tx = wallet.cosignPsbt(psbt).tx;
          console.log('tx: ' , tx, psbt)
        } catch (e) {
          Alert.alert(loc.errors.error, e.message);
          return;
        } finally {
          setIsLoading(false);
        }
    
        if (!tx) return setIsLoading(false);
    
        // we need to remove change address from recipients, so that Confirm screen show more accurate info
        const changeAddresses = [];
        for (let c = 0; c < wallet.next_free_change_address_index + wallet.gap_limit; c++) {
          changeAddresses.push(wallet._getInternalAddressByIndex(c));
        }
        const recipients = psbt.txOutputs.filter(({ address }) => !changeAddresses.includes(address));
        // navigate('SendDetailsRoot', { screen: 'SendDetails', params });

        console.log('new BigNumber(psbt.getFee()).dividedBy(100000000).toNumber(): ', new BigNumber(psbt.getFee()).dividedBy(100000000).toNumber())
        navigation.navigate('SendDetailsRoot', { screen: "CreateTransaction",
            params: {
                fee: new BigNumber(psbt.getFee()).dividedBy(100000000).toNumber(),
                feeSatoshi: psbt.getFee(),
                wallet: wallet,
                tx: tx.toHex(),
                recipients,
                satoshiPerByte: psbt.getFeeRate(),
                showAnimatedQr: true,
                psbt,
            },
        });
    };

    const importQrTransaction = () => {
        if (wallet.type !== WatchOnlyWallet.type) {
          return Alert.alert(loc.errors.error, 'Error: importing transaction in non-watchonly wallet (this should never happen)');
        }
    
        requestCameraAuthorization().then(() => {
          navigation.navigate('ScanQRCodeRoot', {
            screen: 'ScanQRCode',
            params: {
              onBarScanned: importQrTransactionOnBarScanned,
              showFileImportButton: false,
            },
          });
        });
    };
    
    const importQrTransactionOnBarScanned = ret => {
        navigation.getParent().pop();
        if (!ret.data) ret = { data: ret };
        if (ret.data.toUpperCase().startsWith('UR')) {
            Alert.alert(loc.errors.error, 'BC-UR not decoded. This should never happen');
        } else if (ret.data.indexOf('+') === -1 && ret.data.indexOf('=') === -1 && ret.data.indexOf('=') === -1) {
          // this looks like NOT base64, so maybe its transaction's hex
          // we dont support it in this flow
        } else {
            // psbt base64?
        
            // we construct PSBT object and pass to next screen
            // so user can do smth with it:
            const psbt = bitcoin.Psbt.fromBase64(ret.data);
            navigation.navigate('SendDetailsRoot', { screen: "PsbtWithHardwareWallet", params: {
            // navigation.navigate('PsbtWithHardwareWallet', {
                memo: transactionMemo,
                fromWallet: wallet,
                psbt,
            }});
            setIsLoading(false);
        }
    };

    const importTransaction = async () => {
        if (wallet.type !== WatchOnlyWallet.type) {
          return Alert.alert(loc.errors.error, 'Importing transaction in non-watchonly wallet (this should never happen)');
        }
    
        try {
            const res = await DocumentPicker.pickSingle({
                type:
                Platform.OS === 'ios'
                    ? ['io.bluewallet.psbt', 'io.bluewallet.psbt.txn', DocumentPicker.types.plainText, 'public.json']
                    : [DocumentPicker.types.allFiles],
            });
        
            if (DeeplinkSchemaMatch.isPossiblySignedPSBTFile(res.uri)) {
                // we assume that transaction is already signed, so all we have to do is get txhex and pass it to next screen
                // so user can broadcast:
                const file = await RNFS.readFile(res.uri, 'ascii');
                const psbt = bitcoin.Psbt.fromBase64(file);
                const txhex = psbt.extractTransaction().toHex();
                navigation.navigate('SendDetailsRoot', { screen: "PsbtWithHardwareWallet", params: { memo: transactionMemo, fromWallet: wallet, txhex }});
                setIsLoading(false);
                return;
            }
        
            if (DeeplinkSchemaMatch.isPossiblyPSBTFile(res.uri)) {
                // looks like transaction is UNsigned, so we construct PSBT object and pass to next screen
                // so user can do smth with it:
                const file = await RNFS.readFile(res.uri, 'ascii');
                const psbt = bitcoin.Psbt.fromBase64(file);
                navigation.navigate('SendDetailsRoot', { screen: "PsbtWithHardwareWallet", params: { memo: transactionMemo, fromWallet: wallet, psbt }});
                setIsLoading(false);
                return;
            }
        
            if (DeeplinkSchemaMatch.isTXNFile(res.uri)) {
                // plain text file with txhex ready to broadcast
                const file = (await RNFS.readFile(res.uri, 'ascii')).replace('\n', '').replace('\r', '');
                navigation.navigate('SendDetailsRoot', { screen: "PsbtWithHardwareWallet", params: { memo: transactionMemo, fromWallet: wallet, txhex: file }});
                setIsLoading(false);
                return;
            }
        
            Alert.alert(loc.errors.error, loc.send.details_unrecognized_file_format);
        } catch (err) {
            console.log('err: ', err)
            if (!DocumentPicker.isCancel(err)) {
                Alert.alert(loc.errors.error, loc.send.details_no_signed_tx);
            }
        }
    };

    return (
        <View style={{
            flex: 1,
        }}>
            {isLoading ?
                <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
                    <ActivityIndicator color={'white'} />
                </View>
            :
                <RNAnimated.View style={[styles.main, { right: right }]}>
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

        </View>
    )
}
