import React from "react";
import { Image, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";

import { Text } from "@Cypher/component-library";
import { colors, shadow } from "@Cypher/style-guide";
import screenWidth from "@Cypher/style-guide/screenWidth";
import styles from "../styles";

/** The empty Hot Vault's card, on the home screen and on a signing phone that has no Hot Vault yet */
export default function UnlockHotVaultCard({ onPress, label = 'Unlock Hot Vault' }: { onPress: () => void; label?: string }) {
    // Outlined only: green gradient ring on a dark interior, matching the slick treatment of the Unlock Lightning
    // Wallet CTA. Replaces the previous solid green fill so the shield watermark and label read against a dark surface.
    return (
        <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[styles.createView, { borderRadius: 25, width: screenWidth - 40, height: 135 }]}>
            <LinearGradient
                colors={[colors.green_.greenGradient1, colors.green_.greenGradient2]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ borderRadius: 25, padding: 1.5, height: '100%' }}
            >
                <View style={{ flex: 1, borderRadius: 23.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                    {/* Light grey → black inner fill, same
                        gradient the created Hot/Cold vault
                        cards (SavingVault) use. Sits inside
                        the green ring so the unlock CTA and
                        the created vault share one surface
                        treatment. */}
                    <LinearGradient
                        colors={['#2A2A2A', '#000000']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        pointerEvents="none"
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            borderRadius: 23.5,
                        }}
                    />
                    <Image
                        source={require("@Cypher/assets/images/fireShield.png")}
                        style={{
                            position: 'absolute',
                            alignSelf: 'center',
                            top: '50%',
                            marginTop: -45,
                            width: 90,
                            height: 90,
                            opacity: 0.12,
                        }}
                        resizeMode="contain"
                        pointerEvents="none"
                    />
                    <Text h2 style={[styles.createVaultText, shadow.text25]}>
                        {label}
                    </Text>
                </View>
            </LinearGradient>
        </TouchableOpacity>
    );
}
