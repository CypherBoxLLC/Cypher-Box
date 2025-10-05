import React, { useEffect, useRef, useState } from "react";
import { Image, TouchableOpacity, StyleSheet, TextInput, View, Clipboard, Platform, PermissionsAndroid } from "react-native";
import SimpleToast from "react-native-simple-toast";
import { PERMISSIONS, request } from "react-native-permissions";
import QRCodeScanner from 'react-native-qrcode-scanner';
import { RNCamera } from 'react-native-camera';

import styles from "./styles";
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { CustomKeyboard, GradientCard, GradientInput, GradientInputNew } from "@Cypher/components";
import { colors, } from "@Cypher/style-guide";
import { dispatchNavigate } from "@Cypher/helpers";
import { bitcoinRecommendedFee, getInvoiceByLightening } from "../../api/coinOSApis";
import { shortenAddress } from "../ColdStorage";
import { emailRegex } from "@Cypher/helpers/regex";
import { btc, SATS } from "@Cypher/helpers/coinosHelper";


export function startsWithLn(str: string) {
    return str.startsWith("ln");
}

const validateEmail = (email: string) => {
    return emailRegex.test(email);
}

export default function SendScreen({ navigation, route }: any) {
    const info = route.params;
    const [isSats, setIsSats] = useState(true);
    const [sats, setSats] = useState('');
    const [usd, setUSD] = useState('');
    const [sender, setSender] = useState(info?.to || info?.destination || '');
    const senderRef = useRef<TextInput>(null);

    const [convertedRate, setConvertedRate] = useState(0.00);
    const [isLoading, setIsLoading] = useState(false);
    const [recommendedFee, setRecommendedFee] = useState<any>();
    const [selectedFee, setSelectedFee] = useState<number | null>(null);
    const [isScannerActive, setIsScannerActive] = useState(false);
    const [addressFocused, setAddressFocused] = useState(false);
    const [maxUSD, setMaxUSD] = useState(0);
    const [isPaste, setIsPaste] = useState(info?.destination && info?.destination?.startsWith('ln') ? true : false)

    useEffect(() => {
        if (info?.isWithdrawal) {
            setSats(String(info?.value))
            setUSD(info?.converted)
        }
    }, [info?.isWithdrawal])

    useEffect(() => {
        if(info?.fiatAmount){
            let sats = Number(info?.fiatAmount / info?.matchedRate  * 100000000)
            setUSD(String(Number(info?.fiatAmount).toFixed(2)))
            setSats(String(sats))
        }
    }, [info])

    useEffect(() => {
        if (!sender.startsWith('ln') && !sender.includes('@') && !recommendedFee) {
            const init = async () => {
                const res = await bitcoinRecommendedFee();
                setRecommendedFee(res);
                console.log('recommendedFee: ', res)
            }
            init();
        } else if (sender.startsWith('ln') && isPaste){
            if(info.destination){
                setTimeout(() => handleLighteningInvoice(), 500)
            }
            // handleLighteningInvoice()
        }
    }, [sender, isPaste, info?.destination])

    async function requestCameraPermission() {
        if (Platform.OS === 'android') {
            const granted = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.CAMERA,
                {
                    title: 'Camera Permission',
                    message: 'We need access to your camera to scan QR codes',
                    buttonNeutral: 'Ask Me Later',
                    buttonNegative: 'Cancel',
                    buttonPositive: 'OK',
                },
            );
            if (granted === PermissionsAndroid.RESULTS.GRANTED) {
                console.log('You can use the camera');
            } else {
                console.log('Camera permission denied');
            }
        } else {
            const res = await request(PERMISSIONS.IOS.CAMERA);
            console.log('Camera permission:', res);
        }
    }

    const handlePaste = async () => {
        const clipboardContent = await Clipboard.getString();
        setSender(clipboardContent);
        setIsPaste(true)
        SimpleToast.show('Pasted from clipboard', SimpleToast.SHORT);
    };

    // useEffect(() => {
    //     requestCameraPermission();
    // }, []);

    const handleLighteningInvoice = async () => {
        setIsLoading(true);
        try {
            const response = await getInvoiceByLightening(sender);
            console.log('response getInvoiceByLightening: ', response)
            const dollarAmount = (response.amount_msat / 1000) * info?.matchedRate * btc(1);
            console.log('dollarAmount: ', dollarAmount)
            if(dollarAmount){
                dispatchNavigate('ReviewPayment', {
                    ...info,
                    value: response.amount_msat / 1000,
                    converted: dollarAmount,
                    isSats: isSats,
                    to: info?.isWithdrawal ? info?.to : sender,
                    fees: 0,
                    type: 'lightening',
                    description: response?.description,
                    matchedRate: info?.matchedRate,
                    currency: info?.currency,
                    recommendedFee: recommendedFee || 0
                });    
            }
        } catch (error) {
            console.error('Error handleLighteningInvoice:', error);
            SimpleToast.show('Failed to generate lightening. Please try again.', SimpleToast.SHORT);
        } finally {
            setIsLoading(false);
        }
    }

    const handleSendNext = async () => {
        setIsLoading(true);
        const amount = info?.receiveType ? isSats ? usd : sats : isSats ? sats : usd;
        if(info?.fiatAmount) {
            dispatchNavigate('ReviewPayment', {
                ...info,
                value: sats,
                converted: usd,
                isSats: isSats,
                to: info?.isWithdrawal ? info?.to : sender,
                fees: 0,
                type: info?.fiatType,
                matchedRate: info?.matchedRate,
                currency: info?.currency,
                recommendedFee,
                receiveType: info?.receiveType
            });
            setIsLoading(false);
        } else if (sender == '' && (!info?.to || info?.to == '')) {
            SimpleToast.show('Please enter an address or username', SimpleToast.SHORT);
            setIsLoading(false);
            return;
        } else if (startsWithLn(sender)) { //lightening invoice
            try {
                dispatchNavigate('ReviewPayment', {
                    ...info,
                    value: sats,
                    converted: usd,
                    isSats: isSats,
                    to: info?.isWithdrawal ? info?.to : sender,
                    fees: 0,
                    type: 'lightening',
                    matchedRate: info?.matchedRate,
                    currency: info?.currency,
                    recommendedFee,
                    receiveType: info?.receiveType
                });

            } catch (error) {
                console.error('Error handleSendNext:', error);
                SimpleToast.show('Failed to Send Lightening. Please try again.', SimpleToast.SHORT);
            } finally {
                setIsLoading(false);
            }
        } else if (sender.startsWith('bc')) { //bitcoin onchain
            if (sats == '') {
                SimpleToast.show('Please enter an amount', SimpleToast.SHORT);
                setIsLoading(false);
                return;
            }

            const feeForBamskki = info?.receiveType ? (0.1 / 100) * Number(amount) : 0;
            const remainingAmount = Number(amount) - feeForBamskki;
            console.log('feeForBamskki: ', feeForBamskki)
            console.log('remainingAmount: ', remainingAmount)
            if (remainingAmount <= 0) {
                SimpleToast.show("You don't have enough balance", SimpleToast.SHORT);
                setIsLoading(false);
                return;
            }

            try {
                if (info && info?.editAmount) {
                    info?.editAmount()
                }
                dispatchNavigate('ReviewPayment', {
                    ...info,
                    value: sats,
                    converted: usd,
                    isSats: isSats,
                    to: info?.isWithdrawal ? info?.to : sender,
                    fees: 0,
                    total: info?.total,
                    matchedRate: info?.matchedRate,
                    currency: info?.currency,
                    type: 'bitcoin',
                    feeForBamskki,
                    recommendedFee,
                    receiveType: info?.receiveType
                });
            } catch (error) {
                console.error('Error Send to bitcoin:', error);
                SimpleToast.show('Failed to Send to bitcoin. Please try again.', SimpleToast.SHORT);
            } finally {
                setIsLoading(false);
            }
        } else if (sender.includes("@")) { //username
            if (sats == '') {
                SimpleToast.show('Please enter an amount', SimpleToast.SHORT);
                setIsLoading(false);
                return;
            }
            try {
                dispatchNavigate('ReviewPayment', {
                    ...info,
                    value: sats,
                    converted: usd,
                    isSats: isSats,
                    to: info?.isWithdrawal ? info?.to : sender,
                    fees: 0,
                    type: 'username',
                    matchedRate: info?.matchedRate,
                    currency: info?.currency,
                    recommendedFee,
                    receiveType: info?.receiveType
                });
            } catch (error) {
                console.error('Error handleSendNext:', error);
                SimpleToast.show('Failed to Send Lightening. Please try again.', SimpleToast.SHORT);
            } finally {
                setIsLoading(false);
            }
        } else { //liquid address
            if (sats == '') {
                SimpleToast.show('Please enter an amount', SimpleToast.SHORT);
                setIsLoading(false);
                return;
            }
            const feeForBamskki = (0.1 / 100) * Number(amount);
            const remainingAmount = Number(amount) - feeForBamskki;
            console.log('feeForBamskki: ', feeForBamskki)
            console.log('remainingAmount: ', remainingAmount)
            if (remainingAmount <= 0) {
                SimpleToast.show("You don't have enough balance", SimpleToast.SHORT);
                setIsLoading(false);
                return;
            }

            try {
                dispatchNavigate('ReviewPayment', {
                    ...info,
                    value: sats,
                    converted: usd,
                    isSats: isSats,
                    to: info?.isWithdrawal ? info?.to : sender,
                    fees: 0,
                    matchedRate: info?.matchedRate,
                    currency: info?.currency,
                    type: 'liquid',
                    feeForBamskki,
                    recommendedFee,
                    receiveType: info?.receiveType
                });
            } catch (error) {
                console.error('Error Send to liquid:', error);
                SimpleToast.show('Failed to Send to Liquid. Please try again.', SimpleToast.SHORT);
            } finally {
                setIsLoading(false);
            }
        }
    };

    const handleFeeSelect = (fee: number) => {
        setSelectedFee(fee);
    };

    const nextClickHandler = () => {
        dispatchNavigate('ReviewPayment', {
            value: sats,
            converted: usd,
            isSats: isSats,
            to: sender
        })
    }

    const handleScan = (e: any) => {
        setSender(e.data);
        setIsPaste(true);
        setIsScannerActive(false); // Close scanner after successful scan
    };

    useEffect(() => {
        if(info?.editAmount){

        }
    }, [info?.editAmount])

    const maxSendClickHandler = () => {
        info?.editAmount && info?.editAmount();
        const amount = info?.receiveType ? isSats ? usd : sats : isSats ? sats : usd;
        const feeForBamskki = info?.receiveType ? (0.1 / 100) * Number(amount) : 0;
        const remainingAmount = Number(amount) - feeForBamskki;
        console.log('feeForBamskki: ', feeForBamskki)
        console.log('remainingAmount: ', remainingAmount)
        if (remainingAmount <= 0) {
            SimpleToast.show("You don't have enough balance", SimpleToast.SHORT);
            setIsLoading(false);
            return;
        }

        try {
            if (info && info?.editAmount) {
                info?.editAmount()
            }
            dispatchNavigate('ReviewPayment', {
                ...info,
                value: info?.total * SATS,
                converted: (info?.total * info?.matchedRate).toFixed(2), //convert in ysd
                isSats: true,
                to: info?.isWithdrawal ? info?.to : sender,
                fees: 0,
                isMaxUSDSelected: true,
                total: info?.total,
                matchedRate: info?.matchedRate,
                currency: info?.currency,
                type: 'bitcoin',
                feeForBamskki,
                recommendedFee,
                receiveType: info?.receiveType
            });
        } catch (error) {
            console.error('Error Send to bitcoin:', error);
            SimpleToast.show('Failed to Send to bitcoin. Please try again.', SimpleToast.SHORT);
        } finally {
            setIsLoading(false);
        }
    }

    console.log('senderrr: ', sender, isLoading || ((!startsWithLn(sender)) ? (sats?.length == 0 || sender?.length == 0) : (sender?.length == 0)))
    console.log('info: ', info)
    return (
        <>
            {isScannerActive ? (
                <ScreenLayout disableScroll showToolbar isBackButton onBackPress={() => setIsScannerActive(false)} title="Scan QR Code">
                    <View style={styles.scannerContainer}>
                        <QRCodeScanner
                            onRead={handleScan}
                            flashMode={RNCamera.Constants.FlashMode.auto}
                        // topContent={<Text style={styles.centerText}>Scan the QR code</Text>}
                        // bottomContent={
                        //     <View style={styles.scannerFooter}>
                        //         <Button title="Cancel" onPress={() => setIsScannerActive(false)} />
                        //     </View>
                        // }
                        />
                    </View>
                </ScreenLayout>
            )
                :
                (
                    <ScreenLayout keyboardAware showToolbar isBackButton title={info?.isWithdrawal ? "Edit Amount" : "Send Bitcoin"}>
                        <View style={styles.container}>
                            <GradientInputNew 
                                isSats={isSats} 
                                sats={sats.length == 0 ? '0' : sats} 
                                setSats={setSats} 
                                usd={usd.length == 0 ? '0' : usd}
                                _colors={[colors.pink.extralight, colors.pink.default]}
                                showTitle={false}
                                currency={info?.currency}
                            />

                            {info?.isWithdrawal && 
                                <>
                                    <TouchableOpacity onPress={maxSendClickHandler} style={[styles.btn]}>
                                        <Text bold style={{ fontSize: 13 }}>Send Max: {info?.total} BTC</Text>
                                    </TouchableOpacity>
                                </>
                            }

                            {/* <GradientInput isSats={isSats} sats={sats} setSats={setSats} usd={usd} /> */}
                            {(!info?.isWithdrawal && !info?.fiatAmount) &&
                                <>
                                    {/* <Text h2 style={styles.destination}>Destination</Text> */}
                                    <View style={styles.priceView}>
                                        {addressFocused || sender?.length == 0 &&
                                            <Text h4 center onPress={() => senderRef?.current?.focus()} style={StyleSheet.flatten([styles.label])}>Paste any address or invoice{'\n'} (Bitcoin, Lightning, Liquid)</Text>
                                        }
                                        {/* <GradientInputNew isSats={isSats} sats={sats} setSats={setSats} usd={usd} title={'Specify  Amount'} /> */}

                                        <GradientCard
                                            style={styles.main}
                                            linearStyle={styles.heigth}
                                            colors_={sender ? [colors.pink.extralight, colors.pink.default] : [colors.gray.thin, colors.gray.thin2]}>
                                            <Input
                                                ref={senderRef}
                                                onChange={newValue => {
                                                    console.log('newValue: ', newValue)
                                                    setSender(newValue);
                                                }}
                                                value={!sender.includes('@') && sender.length > 20 ? shortenAddress(sender) : sender}
                                                textInputStyle={styles.senderText}
                                                onFocus={() => {
                                                    setAddressFocused(true);
                                                }}
                                                onBlur={() => {
                                                    setAddressFocused(false);
                                                }}
                                            />
                                            {sender.length > 0 && (
                                                <TouchableOpacity onPress={() => setSender('')} style={styles.deleteButton}>
                                                    <Image source={require('../../../img/delete.png')} style={styles.deleteIcon}
                                                        resizeMode="contain"
                                                    />
                                                </TouchableOpacity>
                                            )}
                                        </GradientCard>
                                        <View style={styles.buttonsContainer}>
                                            <GradientCard
                                                style={styles.linearGradientInside}
                                                linearStyle={styles.linearStyle}
                                                onPress={handlePaste}>
                                                <View style={styles.insideView}>
                                                    <Image source={require('../../../img/paste-icon.png')} style={styles.qrimage} resizeMode="contain" />
                                                    <Text h2>Paste</Text>
                                                </View>
                                            </GradientCard>
                                            <GradientCard
                                                style={styles.linearGradientInside}
                                                linearStyle={styles.linearStyle}
                                                onPress={async () => { await requestCameraPermission(); setIsScannerActive(true); }}>
                                                <View style={styles.insideView}>
                                                    <Image source={require('../../../img/scan-qr.png')} style={[styles.qrimage, { width: 35, marginEnd: 5, marginTop: 4 }]} />
                                                    <Text h2 style={{ paddingRight: 6 }}>Scan</Text>
                                                </View>
                                            </GradientCard>
                                        </View>
                                    </View>
                                </>
                            }
                        </View >
                        <CustomKeyboard
                            title="Next"
                            prevSats={info?.value ? String(info?.value) : info?.fiatAmount ? String(info?.fiatAmount / info?.matchedRate  * 100000000) : false}
                            onPress={handleSendNext}
                            disabled={isLoading || ((!startsWithLn(sender)) ? (sats?.length == 0 || sender?.length == 0) : (sender?.length == 0))}
                            setSATS={setSats}
                            setUSD={setUSD}
                            setIsSATS={setIsSats}
                            matchedRate={info?.matchedRate}
                            currency={info?.currency}
                        />
                    </ScreenLayout >
                )
            }
        </>
    );
}