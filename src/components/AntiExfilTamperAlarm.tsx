import React from "react";
import { Modal, StyleSheet, TouchableOpacity, View } from "react-native";

import { Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import loc from "../../loc";

/**
 * Why verified signing stopped: a signature that doesn't open to what the signing phone committed to ("tamper"),
 * a reply from a Cypher Box this one can't read ("unsupported"), or a transaction the exchange can't cover at all
 * ("cannot_start").
 */
export type TamperAlarmVariant = "tamper" | "unsupported" | "cannot_start";

interface Props {
    visible: boolean;
    variant: TamperAlarmVariant;
    /** Called when the user acknowledges. The caller must NOT broadcast. */
    onAcknowledge: () => void;
}

/**
 * Full-screen, interaction-blocking alarm shown when verified signing (anti-exfil) fails. It never offers a way to
 * continue the spend: the only action is to acknowledge and back out. The caller fails closed regardless of what the
 * user taps here. Red for a failed check, black for the two cases where nothing was checked.
 */
export default function AntiExfilTamperAlarm({ visible, variant, onAcknowledge }: Props) {
    const isTamper = variant === "tamper";
    const title = isTamper
        ? loc.cypherbox.anti_exfil.tamper_title
        : variant === "unsupported"
        ? loc.cypherbox.anti_exfil.unsupported_title
        : loc.cypherbox.anti_exfil.cannot_start_title;
    const message = isTamper
        ? loc.cypherbox.anti_exfil.tamper_message
        : variant === "unsupported"
        ? loc.cypherbox.anti_exfil.unsupported_message
        : loc.cypherbox.anti_exfil.cannot_start_message;

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
