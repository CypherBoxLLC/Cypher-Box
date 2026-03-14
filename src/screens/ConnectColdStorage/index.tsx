import React, { useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Keyboard, LayoutAnimation, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import IdleTimerManager from 'react-native-idle-timer';
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { colors, } from "@Cypher/style-guide";
import { requestCameraAuthorization, scanQrHelper } from "../../../helpers/scan-qr";
import styles from "./styles";
import { HDSegwitBech32Wallet } from "../../../class";
import useAuthStore from "@Cypher/stores/authStore";
import { dispatchNavigate } from "@Cypher/helpers";
import startImport from "../../../class/wallet-import";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import triggerHapticFeedback, { HapticFeedbackTypes } from "../../../blue_modules/hapticFeedback";
import { GradientCard } from "@Cypher/components";
import { shortenAddress } from "../ColdStorage";
import { Icon } from "react-native-elements";
import loc from '../../../loc';
import createHash from "create-hash";
import { BlueURDecoder, decodeUR, extractSingleWorkload } from "../../../blue_modules/ur";
import { BlueText } from "BlueComponents";
const fs = require('../../../blue_modules/fs');
const Base43 = require('../../../blue_modules/base43');
const bitcoin = require('bitcoinjs-lib');

interface Props {
    route: any;
    navigation: any;
}

export default function ConnectColdStorage({ route, navigation }: Props) {
    const [address, setAddress] = useState<string>("")
    const [progress, setProgress] = useState();
    const [wallets, setWallets] = useState([]);
    const [password, setPassword] = useState();
    const [loading, setLoading] = useState(false);
    const { setColdStorageWalletID, setVaultTab } = useAuthStore();
    const { addAndSaveWallet } = useContext(BlueStorageContext);
    const task = useRef<any>();
    const importing = useRef(false);

    console.log('address: ', address)
    const onBarScanned = value => {
        if (value && value.data) value = value.data + ''; // no objects here, only strings
        setAddress(value);
    };

    useEffect(() => {
        if(address && address.trim().length > 0) {
            importButtonPressed();
        }
    }, [address])
    
    const importScan = () => {
        requestCameraAuthorization().then(() =>
              navigation.navigate('ScanQRCodeRoot', {
                screen: 'ScanQRCode',
                params: {
                    launchedBy: route.name,
                    onBarScanned,
                    showFileImportButton: true,
                },
            }),
        );
    };
    
    const onBlur = () => {
        const valueWithSingleWhitespace = address.replace(/^\s+|\s+$|\s+(?=\s)/g, '');
        setAddress(valueWithSingleWhitespace);
        return valueWithSingleWhitespace;
    };
    
    const importButtonPressed = () => {
        const textToImport = address.replace(/^\s+|\s+$|\s+(?=\s)/g, '');
        if (textToImport.trim().length === 0) {
          return;
        }
        handleImport(textToImport);
    };

    const saveWallet = (wallet: any) => {
        if (importing.current) return;
        importing.current = true;
        addAndSaveWallet(wallet);
    };
        //   const bip39 = useMemo(() => {
        //     const hd = new HDSegwitBech32Wallet();
        //     hd.setSecret(importText);
        //     return hd.validateMnemonic();
        //   }, [importText]);

    const handleImport = async (textToImport: string) => {
        console.log('textToImport: ', textToImport)
        const cleanedText = textToImport.replace(/\[.*\]/, '');
        const isValid = cleanedText.startsWith('xpub') || cleanedText.startsWith('ypub') || cleanedText.startsWith('zpub');
        console.log('isValid: ', isValid)
        if (!isValid) {
            Alert.alert('Invalid Mnemonic', 'Please check your address and try again.');
            return;
        }

        // If valid, proceed with the import
        const onProgress = (data: React.SetStateAction<undefined>) => setProgress(data);
        const onWallet = (wallet: { getID: () => any; getDerivationPath: () => any; }) => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            const id = wallet.getID();
            setColdStorageWalletID(id)
            let subtitle: any;
            try {
                subtitle = wallet.getDerivationPath?.();
                dispatchNavigate('SavingVaultCreated');
                setVaultTab(true)
            } catch (e) { }
            setWallets(w => [...w, { wallet, subtitle, id }]);
        };

        const onPassword = async (title: string | undefined, subtitle: string | undefined) => {
            try {
                const pass = await prompt(title, subtitle);
                setPassword(pass);
                return pass;
            } catch (e) {
                if (e.message === 'Cancel Pressed') {
                    navigation.goBack();
                }
                throw e;
            }
        };

        IdleTimerManager.setIdleTimerDisabled(true);
        setLoading(true);

        task.current = startImport(textToImport, false, false, onProgress, onWallet, onPassword);

        task.current.promise
            .then(({ cancelled, wallets: w }) => {
                if (cancelled) return;
                if (w.length === 1) saveWallet(w[0]);
                if (w.length === 0) {
                    triggerHapticFeedback(HapticFeedbackTypes.ImpactLight);
                }
            })
            .catch((e: { message: string | undefined; }) => {
                console.warn('import error', e);
                Alert.alert('Import error', e.message);
            })
            .finally(() => {

                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setLoading(false);
                IdleTimerManager.setIdleTimerDisabled(false);
            });
    };
    
    // const importMnemonic = text => {
    //     navigation.navigate('ImportWalletDiscovery', { importText: text, askPassphrase: false, searchAccounts: false });
    // };    

    const pasteClickHandler = async () => {
        const text = await Clipboard.getString();
        console.log("🚀 ~ pasteClickHandler ~ text:", text)
        setAddress(text);
    }

    const HashIt = function (s) {
    return createHash('sha256').update(s).digest().toString('hex');
    };

    const scannedCache: any = {};
    let decoder: any = false;
    let launchedBy = route.name;
    const [urTotal, setUrTotal] = useState(0);
    const [urHave, setUrHave] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [animatedQRCodeData, setAnimatedQRCodeData] = useState({});

    
    const _onReadUniformResourceV2 = part => {
        if (!decoder) decoder = new BlueURDecoder();
        try {
          decoder.receivePart(part);
          if (decoder.isComplete()) {
            const data = decoder.toString();
            decoder = false; // nullify for future use (?)
            if (launchedBy) {
              navigation.navigate({ name: launchedBy, params: {}, merge: true });
            }
            onBarScanned({ data });
          } else {
            setUrTotal(100);
            setUrHave(Math.floor(decoder.estimatedPercentComplete() * 100));
          }
        } catch (error) {
          console.warn(error);
          setIsLoading(true);
          Alert.alert(
            loc.send.scan_error,
            loc._.invalid_animated_qr_code_fragment,
            [
              {
                text: loc._.ok,
                onPress: () => {
                  setIsLoading(false);
                },
                style: 'default',
              },
            ],
            { cancelabe: false },
          );
        }
    };

    const _onReadUniformResource = ur => {
        try {
          const [index, total] = extractSingleWorkload(ur);
          animatedQRCodeData[index + 'of' + total] = ur;
          setUrTotal(total);
          setUrHave(Object.values(animatedQRCodeData).length);
          if (Object.values(animatedQRCodeData).length === total) {
            const payload = decodeUR(Object.values(animatedQRCodeData));
            // lets look inside that data
            let data = false;
            if (Buffer.from(payload, 'hex').toString().startsWith('psbt')) {
              // its a psbt, and whoever requested it expects it encoded in base64
              data = Buffer.from(payload, 'hex').toString('base64');
            } else {
              // its something else. probably plain text is expected
              data = Buffer.from(payload, 'hex').toString();
            }
            if (launchedBy) {
              navigation.navigate({ name: launchedBy, params: {}, merge: true });
            }
            onBarScanned({ data });
          } else {
            setAnimatedQRCodeData(animatedQRCodeData);
          }
        } catch (error) {
          console.warn(error);
          setIsLoading(true);
          Alert.alert(
            loc.send.scan_error,
            loc._.invalid_animated_qr_code_fragment,
            [
              {
                text: loc._.ok,
                onPress: () => {
                  setIsLoading(false);
                },
                style: 'default',
              },
            ],
            { cancelabe: false },
          );
        }
    };
    
    const onBarCodeRead = ret => {
        const h = HashIt(ret.data);
        if (scannedCache[h]) {
          // this QR was already scanned by this ScanQRCode, lets prevent firing duplicate callbacks
          return;
        }
        scannedCache[h] = +new Date();
    
        if (ret.data.toUpperCase().startsWith('UR:CRYPTO-ACCOUNT')) {
          return _onReadUniformResourceV2(ret.data);
        }
    
        if (ret.data.toUpperCase().startsWith('UR:CRYPTO-PSBT')) {
          return _onReadUniformResourceV2(ret.data);
        }
    
        if (ret.data.toUpperCase().startsWith('UR:CRYPTO-OUTPUT')) {
          return _onReadUniformResourceV2(ret.data);
        }
    
        if (ret.data.toUpperCase().startsWith('UR:BYTES')) {
          const splitted = ret.data.split('/');
          if (splitted.length === 3 && splitted[1].includes('-')) {
            return _onReadUniformResourceV2(ret.data);
          }
        }
    
        if (ret.data.toUpperCase().startsWith('UR')) {
          return _onReadUniformResource(ret.data);
        }
    
        // is it base43? stupid electrum desktop
        try {
          const hex = Base43.decode(ret.data);
          bitcoin.Psbt.fromHex(hex); // if it doesnt throw - all good
    
          if (launchedBy) {
            navigation.navigate({ name: launchedBy, params: {}, merge: true });
          }
          onBarScanned({ data: Buffer.from(hex, 'hex').toString('base64') });
          return;
        } catch (_) {}
    
        if (!isLoading) {
          setIsLoading(true);
          try {
            if (launchedBy) {
              navigation.navigate({ name: launchedBy, params: {}, merge: true });
            }
            onBarScanned(ret.data);
          } catch (e) {
            console.log(e);
          }
        }
        setIsLoading(false);
    };
    
    const showFilePicker = async () => {
        const { data } = await fs.showFilePickerAndReadFile();
        if (data) onBarCodeRead({ data });
    };

    return (
        <ScreenLayout disableScroll showToolbar progress={1} color={[colors.cold.gradient1, colors.cold.gradient2]}>
        {/* <ScreenLayout disableScroll showToolbar isBackButton title={"Connect Hardware Device"}> */}
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <Text style={styles.title}>Connect Hardware Device</Text>
                    {loading ?
                        <ActivityIndicator style={{marginTop: 30}} color={colors.white} />
                    :
                        <>
                            <Text h4 style={styles.descption}>Authorize your hardware device to display its Public Key (xpub, ypub, or zpub) then Scan, Paste, OR Import it from your files. Some devices don’t  give you that so you need to take it from their companion app’s settings.</Text>
                            <View style={styles.pasteview}>
                                <GradientCard
                                    colors_={["#1693EDFA", "#15A7A7"]}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 0, y: 1 }}            
                                    style={styles.linearGradientInside}
                                    linearStyle={styles.linearStyle}
                                    onPress={importScan}>
                                    <View style={styles.insideView}>
                                        <Image source={require("../../../img/scan-new.png")} style={styles.qrimage} resizeMode="contain" />
                                        <Text h2>Scan</Text>
                                    </View>
                                </GradientCard>
                                <GradientCard
                                    colors_={["#1693EDFA", "#15A7A7"]}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 0, y: 1 }}            
                                    style={styles.linearGradientInside}
                                    linearStyle={styles.linearStyle}
                                    onPress={pasteClickHandler}>
                                    <View style={styles.insideView}>
                                        <Image source={require('../../../img/paste-icon.png')} style={styles.qrimage} resizeMode="contain" />
                                        {address ?
                                            <Text style={{fontSize: 14}}>{shortenAddress(address)}</Text>
                                        :
                                            <Text h2>Paste</Text>
                                        }
                                    </View>
                                </GradientCard>
                                <GradientCard
                                    colors_={["#1693EDFA", "#15A7A7"]}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 0, y: 1 }}            
                                    style={styles.linearGradientInside}
                                    linearStyle={styles.linearStyle}
                                    onPress={showFilePicker}>
                                    <View style={styles.insideView}>
                                        <Image source={require('../../../img/import.png')} style={styles.qrimage} resizeMode="contain" />
                                        <Text h2>Import</Text>
                                    </View>
                                </GradientCard>
                            </View>
                        </>
                    }
                        {/* <TouchableOpacity style={[styles.button, { borderColor: colors.coldGreen }]} onPress={pasteClickHandler}>
                            {address ?
                                <Text bold>{address}</Text>
                                :
                                <Text bold>Paste</Text>
                            }
                        </TouchableOpacity> */}
                        {/* <TouchableOpacity onPress={importScan}>
                            <Image source={require("../../../img/scan-new.png")} style={styles.qrcode} resizeMode="contain" />
                        </TouchableOpacity> */}
                    </View>
                    {/* <TouchableOpacity onPress={importButtonPressed} style={styles.importBtn} disabled={loading}>
                        {loading ?
                            <ActivityIndicator color={colors.white} />
                            :
                            <Text h3>Import</Text>
                        }
                    </TouchableOpacity> */}
            </View>
        </ScreenLayout>
    )
}
