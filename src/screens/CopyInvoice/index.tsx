import React, { useRef } from "react";
import { Image, View } from "react-native";
import SimpleToast from "react-native-simple-toast";
import Clipboard from '@react-native-clipboard/clipboard';
import 'text-encoding';
import QRCode from 'react-native-qrcode-svg';
import Share from 'react-native-share';

import styles from "./styles";
import loc from "../../../loc";
import { Copy, QrCode, Second, Share2 } from "@Cypher/assets/images";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientButton, ImageTextVertical } from "@Cypher/components";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { colors, ltr, rtl } from "@Cypher/style-guide";
import { displayDestination } from "@Cypher/helpers/addressDisplay";

interface Props {
    route: any;
}

// Arabic or Hebrew letters: text in a right-to-left language, which has to keep its own direction
const RTL_LETTERS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

export default function CopyInvoice({ route }: Props) {
    const { value, converted, hash } = route?.params
    // Callers pass theme: 'ark' for Bark surfaces (white gradient, black
    // text); everything else (Strike, CoinOS) keeps GradientButton's
    // default pink. Same split ArkSendSuccessScreen uses for its Home.
    const isArk = route?.params?.theme === 'ark';
    /**
     * Whether what this screen is handing out will be paid into an
     * out-of-round capsule.
     *
     * An explicit param rather than something inferred from `theme`, because
     * three Ark paths land here and they do not share this property. A
     * Lightning invoice and a Bark address both resolve to a capsule the Ark
     * server has not yet put in a round; the on-chain boarding address does
     * not, so showing this notice there would be simply wrong. Inferring from
     * `isArk` would have got that third case backwards.
     *
     * Defaults to false, so a caller has to opt in.
     */
    const showArkoorNotice = route?.params?.arkoorNotice === true;
    const qrCode = useRef();
    const base64QrCodeRef = useRef('');

    const copyToClipboard = (text: string) => {
        Clipboard.setString(text);
        SimpleToast.show(loc.cypherbox.payments.common.copied_to_clipboard, SimpleToast.SHORT);
    };
    
    const shareQRCode = async () => {
        try {
            // const qrData = 'Bitcoin-lightning invoice QR code data'; // Replace this with your QR code data
            console.log('base64QrCodeRef: ', base64QrCodeRef)

            // const qrCodeImage = await qrCode.current?.toDataURL(qrData);
            // console.log('qrCodeImage: ', qrCodeImage)
        
            const shareOptions = {
                message: String(loc.formatString(loc.cypherbox.payments.common.qr_image_share, { value: hash })),
                url: `data:image/jpeg;base64,${base64QrCodeRef?.current}`,
            };
        
            await Share.open(shareOptions);
    
        } catch (error) {
              console.error('Error sharing QR code:', error);
        }
    };

    return (
        <ScreenLayout showToolbar title={loc.cypherbox.payments.copy_invoice.title}>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    {showArkoorNotice && (
                        /* Above the amount and the QR on purpose. The advice is
                           "keep the app open", which is only actionable before
                           the sender is paid, so it has to be read before the
                           QR is shared rather than found afterwards.
                           COPY: Bam finalizes. */
                        <View style={styles.arkoorBanner}>
                            <Text bold style={styles.arkoorBannerTitle}>
                                {loc.cypherbox.payments.copy_invoice.arkoor_title}
                            </Text>
                            <Text style={styles.arkoorBannerBody}>
                                {loc.cypherbox.payments.copy_invoice.arkoor_body}
                            </Text>
                        </View>
                    )}
                    {/* `value` is a translated line ("Receive 5 USD") and follows the language: forced left-to-right,
                        iOS put the number first in Arabic. `converted` is one too on the on-chain address; otherwise
                        it's an amount ("$ 0.01"), which has no letter to set its direction, so it's marked
                        left-to-right. */}
                    <Text bold h1 adjustsFontSizeToFit numberOfLines={1}>{value}</Text>
                    <Text bold style={styles.usd}>{converted && !RTL_LETTERS.test(converted) ? ltr(converted) : converted}</Text>
                    {/* <Image source={QrCode} resizeMode="contain" style={styles.image} /> */}
                    <View style={{ margin: 20, padding: 30, backgroundColor: 'white', borderRadius: 30 }}>
                        <QRCode
                            value={hash}
                                size={250}
                                color="black"
                                backgroundColor="white"
                        />
                    </View>

                    <Text semibold style={[styles.code, rtl.ltrText]}>{displayDestination(hash)}</Text>
                    <View style={styles.imageView}>
                        <ImageTextVertical text={loc.cypherbox.payments.common.copy} source={Copy} onPress={() => copyToClipboard(hash)} />
                        <ImageTextVertical text={loc.cypherbox.payments.common.share} source={Share2} onPress={shareQRCode} />
                    </View>
                    <Text bold h3 style={styles.maintitle}>{loc.cypherbox.payments.copy_invoice.instructions}</Text>
                    <GradientButton
                        style={styles.homeButton}
                        title={loc.cypherbox.payments.common.home}
                        onPress={() => dispatchReset('HomeScreen')}
                        {...(isArk
                            ? {
                                colors_: [colors.ark.gradient1, colors.ark.gradient2],
                                textStyle: { fontFamily: 'Lato-Medium', color: colors.black.default },
                            }
                            : {})}
                    />
                    {isArk && (
                        /* Attribution for the third party that coordinates every
                           Bark capsule. Shown on all three Ark receive surfaces,
                           unlike the notice above, because the ASP is involved in
                           all of them. */
                        <View style={styles.aspAttribution}>
                            <Text style={styles.aspAttributionText}>
                                {loc.cypherbox.payments.copy_invoice.asp_attribution}
                            </Text>
                            <Image
                                source={Second}
                                style={styles.aspLogo}
                                resizeMode="contain"
                            />
                        </View>
                    )}
                </View>
            </View>
        </ScreenLayout>
    )
}
