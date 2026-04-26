import { Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { colors, shadow, widths } from "@Cypher/style-guide";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import styles from "../styles";
import { GradientView } from "@Cypher/components";

interface Props {
    balance: any
    convertedRate: any
    onAddAccount?: () => void
    showAddAccount?: boolean
    carouselPage?: number
    carouselTotal?: number
}

export default React.memo(function BalanceView({ balance, convertedRate, onAddAccount, showAddAccount, carouselPage = 0, carouselTotal = 0 }: Props) {
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
                    <TouchableOpacity
                        onPress={onAddAccount}
                        activeOpacity={0.7}
                        style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 15, paddingVertical: 10, zIndex: 10}}>
                        <Text h4 bold style={{color: colors.pink.light, fontSize: 20}}>+</Text>
                        <Text h4 semibold style={{ marginStart: 5, color: colors.pink.light }}>Add Account</Text>
                    </TouchableOpacity>
                )}

                {carouselTotal > 1 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingBottom: 10, paddingTop: 4 }}>
                        {Array.from({ length: carouselTotal }).map((_, i) => (
                            <View
                                key={i}
                                style={{
                                    width: 24,
                                    height: 3,
                                    borderRadius: 2,
                                    marginHorizontal: 3,
                                    backgroundColor: i === carouselPage ? colors.pink.light : 'rgba(255,255,255,0.3)',
                                }}
                            />
                        ))}
                    </View>
                )}

            </View>
        </View>
    )
})
