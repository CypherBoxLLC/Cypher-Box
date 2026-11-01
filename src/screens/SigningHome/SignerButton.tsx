import React from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";

import { Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";

/**
 * A button on a signing phone's home, the same with a Hot Vault or without one. Filled, with a chevron, so it reads
 * as a button and not as the outlined fingerprint box or a line of text; danger is for taking the seed off the phone.
 */
export default function SignerButton({ label, onPress, disabled, danger }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    danger?: boolean;
}) {
    return (
        <TouchableOpacity
            style={[styles.button, danger && styles.danger]}
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
        >
            <Text bold style={danger ? [styles.text, styles.dangerText] : styles.text}>
                {label}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={danger ? colors.red : colors.gray.light} />
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginHorizontal: 20,
        marginBottom: 10,
        paddingVertical: 14,
        paddingStart: 18,
        paddingEnd: 12,
        borderRadius: 12,
        backgroundColor: '#1F1F22',
    },
    danger: {
        marginTop: 14,
        borderWidth: 1,
        borderColor: colors.red,
        backgroundColor: 'transparent',
    },
    text: {
        fontSize: 17,
        lineHeight: 22,
    },
    dangerText: {
        color: colors.red,
    },
});
