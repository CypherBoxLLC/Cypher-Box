import { Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { colors, shadow, widths } from "@Cypher/style-guide";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { Icon } from "react-native-elements";
import styles from "../styles";
import { GradientView } from "@Cypher/components";

type CarouselKind = 'fiat' | 'lightning' | 'ark';

interface Props {
    balance: any
    convertedRate: any
    onAddAccount?: () => void
    showAddAccount?: boolean
    carouselPage?: number
    carouselTotal?: number
    /** Per-page kind, in carousel order. Drives the per-dot color. */
    carouselKinds?: CarouselKind[]
    /** Tap handler on a dot — HomeScreen wires this to WalletsView.snapTo. */
    onDotPress?: (index: number) => void
}

// Brand color per wallet kind. Inactive dots dim to ~40% opacity of the same
// hue so the active dot stays visually distinct without losing the color cue.
const DOT_COLOR: Record<CarouselKind, string> = {
    fiat: colors.green,
    lightning: colors.pink.light,
    ark: colors.ark.light,
};

export default React.memo(function BalanceView({ balance, convertedRate, onAddAccount, showAddAccount, carouselPage = 0, carouselTotal = 0, carouselKinds = [], onDotPress }: Props) {
    return (
        <View style={[styles.innerContainer]} >
            <View
                style={StyleSheet.flatten([styles.shadowTopBottom2])}
            >
                <Text subHeader bold style={styles.price}>
                    {balance}
                </Text>
                <Text bold style={styles.priceusd} >
                    {convertedRate}
                </Text>

                {showAddAccount && onAddAccount && (
                    // Compact pill — fully opaque solid pink fill, black
                    // label + Feather "plus" icon (thinner / cleaner than
                    // the bare "+" character we used before). Drop shadow
                    // gives a restrained 3D pop without any glow or tint.
                    // activeOpacity stays at 1 so the pill never dims on
                    // press — the tap feedback is the slight depress
                    // implied by the shadow.
                    <View style={{ alignItems: 'flex-end', paddingRight: 15, paddingTop: 6, zIndex: 10 }}>
                        <TouchableOpacity
                            onPress={onAddAccount}
                            activeOpacity={1}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'center',
                                paddingHorizontal: 12,
                                paddingVertical: 6,
                                borderRadius: 16,
                                backgroundColor: colors.pink.light,
                                shadowColor: '#000',
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: 0.5,
                                shadowRadius: 3,
                                elevation: 4,
                            }}
                        >
                            {/* Feather icon set — thin, modern stroke.
                                Black on the pink fill keeps contrast high
                                without introducing a third colour. */}
                            <Icon
                                name="plus"
                                type="feather"
                                color="#000"
                                size={14}
                                containerStyle={{ marginRight: 4 }}
                            />
                            <Text bold style={{ color: '#000', fontSize: 12, letterSpacing: 0.3 }}>
                                Add wallet
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}

                {carouselTotal > 1 && (
                    // Absolutely-anchored to the bottom of the black box so
                    // the dots stay inside its 128pt fixed height. Using flow
                    // layout pushed them outside the box visually because the
                    // price + "Add wallet" pill already fill the inner space.
                    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 8, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                        {Array.from({ length: carouselTotal }).map((_, i) => {
                            // Fall back to 'lightning' (pink) if kinds didn't
                            // arrive yet — better than a flash of grey.
                            const kind: CarouselKind = carouselKinds[i] ?? 'lightning';
                            const baseColor = DOT_COLOR[kind];
                            const isActive = i === carouselPage;
                            return (
                                <TouchableOpacity
                                    key={i}
                                    onPress={() => onDotPress?.(i)}
                                    activeOpacity={0.6}
                                    // Generous hit slop — the dot itself is
                                    // 28×6, too small for a comfortable tap.
                                    hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
                                    style={{ marginHorizontal: 3 }}
                                >
                                    <View
                                        style={{
                                            width: 28,
                                            height: 6,
                                            borderRadius: 3,
                                            backgroundColor: baseColor,
                                            opacity: isActive ? 1 : 0.4,
                                        }}
                                    />
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}

            </View>
        </View>
    )
})
