import React from "react";
import { Modal, StyleSheet, TouchableOpacity, View } from "react-native";

import { Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import loc from "../../loc";

export type TamperAlarmVariant = "tamper" | "unsupported";

interface Props {
    visible: boolean;
    variant: TamperAlarmVariant;
    /** Called when the user acknowledges. The caller must NOT broadcast. */
    onAcknowledge: () => void;
}

/**
 * Full-screen, interaction-blocking alarm shown when anti-exfil verification
 * fails ("tamper") or the signing phone did not support verification
 * ("unsupported"). It never offers a way to continue the spend: the only
 * action is to acknowledge and back out. The caller fails closed regardless of
 * what the user taps here.
 */
export default function AntiExfilTamperAlarm({ visible, variant, onAcknowledge }: Props) {
    const isTamper = variant === "tamper";
    const title = isTamper ? loc.cypherbox.anti_exfil.tamper_title : loc.cypherbox.anti_exfil.unsupported_title;
    const message = isTamper ? loc.cypherbox.anti_exfil.tamper_message : loc.cypherbox.anti_exfil.unsupported_message;

    return (
        <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={onAcknowledge}>
            <View style={[styles.root, { backgroundColor: isTamper ? colors.red : colors.black.default }]}>
                <View style={styles.content}>
                    <Text h2 bold center style={styles.title}>
                        {title}
                    </Text>
                    <Text h4 center style={styles.message}>
                        {message}
                    </Text>
                </View>
                <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={onAcknowledge}>
                    <Text h3 bold center style={styles.buttonText}>
                        {loc._.ok}
                    </Text>
                </TouchableOpacity>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        paddingHorizontal: 24,
        paddingVertical: 48,
        justifyContent: "space-between",
    },
    content: {
        flex: 1,
        justifyContent: "center",
    },
    title: {
        color: colors.white,
        marginBottom: 24,
    },
    message: {
        color: colors.white,
        lineHeight: 26,
    },
    button: {
        borderColor: colors.white,
        borderWidth: 1,
        borderRadius: 8,
        paddingVertical: 16,
        alignItems: "center",
    },
    buttonText: {
        color: colors.white,
    },
});
