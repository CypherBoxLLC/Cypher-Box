import React, { useEffect, useRef, useState } from "react";
import { Image, View } from "react-native";
import SimpleToast from "react-native-simple-toast";
import Clipboard from '@react-native-clipboard/clipboard';
import 'text-encoding';
import QRCode from 'react-native-qrcode-svg';
import Share from 'react-native-share';

import styles from "./styles";
import { CoinOS, Copy, QrCode, Share2 } from "@Cypher/assets/images";
import { LoadingSpinner, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import ImageText from "@Cypher/components/ImageText";
import { GradientCard, ImageTextVertical } from "@Cypher/components";
import { createInvoice } from "@Cypher/api/coinOSApis";
import { createInvoice as createInvoiceStrike } from "@Cypher/api/strikeAPIs";

interface Props {
    route: any;
}

export default function QrScreen({ route }: Props) {
    const { type, receiveType } = route.params;

    const [hash, setHash] = useState('');
    const qrCode = useRef();
    const base64QrCodeRef = useRef('');


    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        handleCreateInvoice();
    }, [])

    const handleCreateInvoice = async () => {
        try {
            const response = receiveType ? await createInvoice({
                type: type,
            }) : await createInvoiceStrike({
                onchain: {
                },
                targetCurrency: "USD"
            });
            const hash = receiveType ? response.hash : response.onchain?.address
            setHash(hash);
        } catch (error) {
            console.error('Error generating bitcoin address handleCreateInvoice QR:', error);
            SimpleToast.show(`Failed to generating ${type == 'bitcoin' ? "bitcoin" : "liquid"} address. Please try again.`, SimpleToast.SHORT);
        } finally {
            setIsLoading(false);
        }
    };

    const copyToClipboard = (text: string) => {
        Clipboard.setString(text);
        SimpleToast.show('Copied to clipboard', SimpleToast.SHORT);
    };
    
    const shortenAddress = (address: string) => {
        // Take the first 6 characters
        const start = address.substring(0, 6);
        // Take the last 6 characters
        const end = address.substring(address.length - 6);
        // Combine with three dots in the middle
        return `${start}...${end}`;
    };

    const shareQRCode = async () => {
        try {
            // const qrData = 'Bitcoin-lightning invoice QR code data'; // Replace this with your QR code data
            console.log('base64QrCodeRef: ', base64QrCodeRef)

            // const qrCodeImage = await qrCode.current?.toDataURL(qrData);
            // console.log('qrCodeImage: ', qrCodeImage)
        
            const shareOptions = {
                message: `QR image: ${hash}`,
                url: `data:image/jpeg;base64,${base64QrCodeRef?.current}`,
            };
        
            await Share.open(shareOptions);
    
        } catch (error) {
              console.error('Error sharing QR code:', error);
        }
    };


    return (
        <ScreenLayout showToolbar title={type == 'liquid' ? 'Receive to Liquid Address' : 'Receive to Bitcoin Address'}>
            <View style={styles.container}>
                {isLoading ?
                    <View>
                        <LoadingSpinner />
                    </View>       
                : hash &&    
                    <View style={styles.innerView}>
                        {/* <Text h3 style={styles.maintitle}>Top-up your Coinos Lightning Account{`\n`} using this Bitcoin Network address:</Text> */}
                        {receiveType ?
                            <Image source={CoinOS} style={styles.logo} resizeMode="contain" />
                        :
                            <Image source={require('../../../img/Strike.png')} style={styles.logo} resizeMode="contain" />
                        }

                        <View style={{ margin: 20, padding: 30, backgroundColor: 'white', borderRadius: 30 }}>
                            <QRCode
                                getRef={c => {
                                    if (!c?.toDataURL) return;
                                        c?.toDataURL((base64Image: string) => {
                                        base64QrCodeRef.current = base64Image?.replace(/(\r\n|\n|\r)/gm, '');
                                    });
                                }}
                                value={hash}
                                    size={250}
                                    color="black"
                                    backgroundColor="white"
                            />
                        </View>

                        {/* <Image source={QrCode} resizeMode="contain" style={styles.image} /> */}
                        <Text semibold style={styles.code}>{shortenAddress(hash)}</Text>
                        <View style={styles.imageView2}>
                            <ImageTextVertical text="Copy" source={Copy} onPress={() => copyToClipboard(hash)} />
                            <ImageTextVertical text="Share" source={Share2} onPress={shareQRCode} />
                        </View>
                        {/* <View style={styles.imageView}>
                            <ImageText text="Copy" source={Copy}/>
                            <ImageText text="Share" source={Share}/>
                        </View>
                        <GradientCard style={{ height: 50,marginTop: 20 }} linearStyle={{ height: 50 }}>
                            <View style={styles.background}>
                                <Text subHeader bold>bc1qt3......wmsn6u</Text>
                            </View>
                        </GradientCard> */}
                        <Text h3 style={styles.title}>Bitcoin Network transactions may take hours, or in rare case, days to confirm depending on how much fees the sender paid and how fast your bitcoin banking provider, {receiveType ? 'Coinos' : 'Strike'}, will credit your account.</Text>
                    </View>
                }
            </View>
        </ScreenLayout>
    )
}
