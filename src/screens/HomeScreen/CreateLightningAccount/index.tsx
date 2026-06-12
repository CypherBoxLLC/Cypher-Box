import { Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import React from "react";
import { Image, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import styles from "../styles";

// Provider-logo sheet — outlined with the same pink gradient ring as
// the parent card, dark interior. Mirrors the slick "ring + dark fill"
// pattern used by the Strike/CoinOS Lightning cards (Card/styles.ts
// shadowTopGradientOutline) so the whole CTA reads as one design
// language: pink-edged sheets on a transparent base.
const TILE_W = 78;
const TILE_H = 36;
const ProviderTile = ({ logo }: { logo: any }) => (
  <LinearGradient
    colors={[colors.pink.gradient1, colors.pink.gradient2]}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 1 }}
    style={{
      width: TILE_W,
      height: TILE_H,
      borderRadius: 12,
      padding: 1.2,
    }}
  >
    <View
      style={{
        flex: 1,
        borderRadius: 11,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Image
        source={logo}
        style={{ width: 58, height: 20, tintColor: '#FFFFFF', opacity: 0.95 }}
        resizeMode="contain"
      />
    </View>
  </LinearGradient>
);

interface Props {
    onPress(): void;
}

export default function CreateLightningAccount({ onPress }: Props) {
    // Outlined-only card — pink gradient ring, dark interior. Replaces
    // the previous solid pink fill so the watermark + provider tiles
    // can breathe and the design reads as "this is a wallet I'm about
    // to unlock", not a flat pink slab. Same ring + dark inner pattern
    // the Strike / CoinOS Lightning cards use (Card/styles.ts
    // shadowTopGradientOutline). marginTop matches the legacy
    // GradientCardWithShadow's createView style so the card's vertical
    // position on Home stays put.
    return (
        <View style={{ height: '42%' }}>
            <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={{ flex: 1, marginTop: 15 }}>
                {/* Pink gradient ring — thinner so the border reads as
                    a lighter accent rather than a heavy frame. */}
                <LinearGradient
                    colors={[colors.pink.gradient1, colors.pink.gradient2]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ flex: 1, borderRadius: 24, padding: 1.5 }}
                >
                    <View style={{ flex: 1, borderRadius: 21, backgroundColor: colors.primary, overflow: 'hidden' }}>
                        {/* Pinkish base gradient — dark wine at the top
                            fading to nearly black-pink at the bottom.
                            Replaces the previous grey→black so the
                            interior matches the pink ring family. */}
                        <LinearGradient
                            colors={['#4A0F33', '#1A0612']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            pointerEvents="none"
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                borderRadius: 21,
                            }}
                        />
                        {/* Large translucent lightning watermark behind
                            the label — same motif as the carousel cards
                            and the Unlock Vault CTAs. */}
                        <Image
                            source={require("@Cypher/assets/images/electricity.png")}
                            style={{
                                position: 'absolute',
                                alignSelf: 'center',
                                top: '50%',
                                marginTop: -75,
                                width: 110,
                                height: 150,
                                tintColor: '#FFFFFF',
                                opacity: 0.10,
                            }}
                            resizeMode="contain"
                            pointerEvents="none"
                        />
                        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }}>
                            <View style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8,
                            }}>
                                <Image
                                    source={require("@Cypher/assets/images/electricity.png")}
                                    style={{ width: 16, height: 22, tintColor: '#FFFFFF' }}
                                    resizeMode="contain"
                                />
                                <Text h2 style={[styles.shadow, { fontSize: 16 }]} center>
                                    Unlock Lightning Wallet
                                </Text>
                            </View>
                            {/* Provider tiles — pink-bordered pills
                                matching the parent card's ring. */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
                                <ProviderTile logo={require("@Cypher/assets/images/strike.png")} />
                                <ProviderTile logo={require("@Cypher/assets/images/coinos.png")} />
                                <ProviderTile logo={require("@Cypher/assets/images/second.png")} />
                            </View>
                        </View>
                    </View>
                </LinearGradient>
            </TouchableOpacity>
        </View>
    );
}