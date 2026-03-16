import React, { useRef } from "react";
import { Image, View } from "react-native";
import SimpleToast from "react-native-simple-toast";
import Clipboard from '@react-native-clipboard/clipboard';
import 'text-encoding';
import QRCode from 'react-native-qrcode-svg';
import Share from 'react-native-share';

import styles from "./styles";
import { Copy, QrCode, Share2 } from "@Cypher/assets/images";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { ImageTextVertical } from "@Cypher/components";

interface Props {
    route: any;
}

export default function CopyInvoice({ route }: Props) {
    const { value, converted, hash } = route?.params
    const qrCode = useRef();
    const base64QrCodeRef = useRef('');

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
        <ScreenLayout showToolbar title='Copy Invoice'>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <Text bold h1>{route?.params?.value}</Text>
                    <Text bold style={styles.usd}>{route?.params?.converted}</Text>
                    {/* <Image source={QrCode} resizeMode="contain" style={styles.image} /> */}
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

                    <Text semibold style={styles.code}>{shortenAddress(hash)}</Text>
                    <View style={styles.imageView}>
                        <ImageTextVertical text="Copy" source={Copy} onPress={() => copyToClipboard(hash)} />
                        <ImageTextVertical text="Share" source={Share2} onPress={shareQRCode} />
                    </View>
                    <Text bold h3 style={styles.maintitle}>Copy this invoice code or share the QR with the sender to receive bitcoin</Text>
                </View>
            </View>
        </ScreenLayout>
    )
}
