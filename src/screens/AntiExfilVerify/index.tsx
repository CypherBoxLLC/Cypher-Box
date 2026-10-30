import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import QRCodeComponent from "../../../components/QRCodeComponent";
import { scanQrHelper } from "../../../helpers/scan-qr";
import loc from "../../../loc";
import { randomBytes } from "../../../class/rng";
import {
    HostSession,
    hostCommitStep,
    hostRevealStep,
    hostVerifyStep,
} from "@Cypher/helpers/antiExfilController";
import { decodeAntiExfilMessage } from "@Cypher/helpers/antiExfilTransport";
import { MAX_ANTI_EXFIL_INPUTS } from "@Cypher/helpers/antiExfilTransport";
import useAntiExfilStore from "@Cypher/stores/antiExfilStore";
import AntiExfilTamperAlarm, { TamperAlarmVariant } from "@Cypher/components/AntiExfilTamperAlarm";

interface Props {
    route: any;
    navigation: any;
}

type Stage = "working" | "showCommit" | "showReveal" | "verifying" | "alarm";

/**
 * Host side (online Cold Vault) of the anti-exfil protocol: the "Verify my
 * signing phone" flow. Only reached when the opt-in setting is on. It drives
 * all four hops and then verifies, failing closed:
 *   1. show commit QR (unsigned PSBT + commitments)
 *   2. scan the signing phone's openings
 *   3. show reveal QR (rho)
 *   4. scan the signed transaction, then verify
 * On success it hands the signed PSBT to the existing combine/broadcast path.
 * On failure it shows a full-screen tamper alarm and never broadcasts.
 *
 * This is an ADDITIONAL layer: the downstream confirm/broadcast screen still
 * runs the existing signed-tx-vs-reviewed match check.
 */
export default function AntiExfilVerify({ route, navigation }: Props) {
    const params = route?.params || {};
    const { fromWallet, psbt } = params;
    const { setHostSession, clearHostSession } = useAntiExfilStore();

    const [stage, setStage] = useState<Stage>("working");
    const [payload, setPayload] = useState<string>("");
    const [session, setSession] = useState<HostSession | null>(null);
    const [alarmVariant, setAlarmVariant] = useState<TamperAlarmVariant>("tamper");

    const showAlarm = (variant: TamperAlarmVariant) => {
        setAlarmVariant(variant);
        setStage("alarm");
    };

    const begin = useCallback(async () => {
        try {
            const psbtBase64 = typeof psbt === "string" ? psbt : psbt.toBase64();
            // Pre-generate a secure randomness pool so the pure controller can
            // pull 32 bytes per input synchronously.
            const pool = Uint8Array.from(await randomBytes(32 * MAX_ANTI_EXFIL_INPUTS));
            let offset = 0;
            const nextRandom = () => {
                const slice = pool.subarray(offset, offset + 32);
                offset += 32;
                return slice;
            };
            // Single-sig phone-to-phone vault: each input carries exactly one
            // bip32Derivation, so we take it directly rather than filtering by
            // fingerprint (whose stored representation can differ).
            const { message, session: sess } = hostCommitStep(psbtBase64, nextRandom);
            setHostSession(sess);
            setSession(sess);
            setPayload(message);
            setStage("showCommit");
        } catch (_e) {
            // Cannot even start (e.g. an input we cannot cover): fail closed.
            showAlarm("unsupported");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        begin();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const scanOpenAndReveal = async () => {
        const data = await scanQrHelper(navigation.navigate, route.name, params);
        if (!data) return;
        const decoded = decodeAntiExfilMessage(String(data));
        if (decoded.kind === "unsupported-version" || decoded.kind === "not-anti-exfil") {
            showAlarm("unsupported");
            return;
        }
        if (decoded.kind !== "ok" || decoded.message.hop !== "open" || !session) {
            showAlarm("unsupported");
            return;
        }
        try {
            const { message, session: next } = hostRevealStep(decoded.message, session);
            setHostSession(next);
            setSession(next);
            setPayload(message);
            setStage("showReveal");
        } catch (_e) {
            showAlarm("unsupported");
        }
    };

    const scanSignAndVerify = async () => {
        const data = await scanQrHelper(navigation.navigate, route.name, params);
        if (!data) return;
        const decoded = decodeAntiExfilMessage(String(data));
        if (decoded.kind === "unsupported-version" || decoded.kind === "not-anti-exfil") {
            showAlarm("unsupported");
            return;
        }
        if (decoded.kind !== "ok" || decoded.message.hop !== "sign" || !session) {
            showAlarm("unsupported");
            return;
        }
        setStage("verifying");
        try {
            const result = hostVerifyStep(decoded.message, session);
            if (result.verdict !== "ok" || !result.signedPsbtBase64) {
                showAlarm("tamper");
                return;
            }
            // Verified. Hand the signed PSBT to the existing combine + broadcast
            // path (which also runs the existing match check).
            const Tx = fromWallet.combinePsbt(psbt, result.signedPsbtBase64);
            const txHex = Tx.toHex();
            clearHostSession();
            navigation.navigate("ConfirmHardwareTransaction", { ...params, psbt, txHex });
        } catch (_e) {
            showAlarm("tamper");
        }
    };

    if (stage === "alarm") {
        return (
            <AntiExfilTamperAlarm
                visible
                variant={alarmVariant}
                onAcknowledge={() => {
                    clearHostSession();
                    navigation.goBack();
                }}
            />
        );
    }

    if (stage === "working" || stage === "verifying") {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.center}>
                    <ActivityIndicator />
                    {stage === "verifying" && (
                        <Text h4 center style={styles.body}>
                            {loc.cypherbox.anti_exfil.verify_step_scan_sign}
                        </Text>
                    )}
                </View>
            </ScreenLayout>
        );
    }

    const isCommit = stage === "showCommit";
    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <Text h3 bold center style={styles.title}>
                    {loc.cypherbox.anti_exfil.setting_title}
                </Text>
                <Text h4 center style={styles.body}>
                    {isCommit ? loc.cypherbox.anti_exfil.verify_step_commit : loc.cypherbox.anti_exfil.verify_step_reveal}
                </Text>
                <View style={styles.qrWrap}>
                    <QRCodeComponent value={payload} ecl="L" />
                </View>
                <TouchableOpacity
                    style={styles.button}
                    onPress={isCommit ? scanOpenAndReveal : scanSignAndVerify}
                >
                    <Text h3 bold center>
                        {isCommit ? loc.cypherbox.anti_exfil.verify_step_scan_open : loc.cypherbox.anti_exfil.verify_step_scan_sign}
                    </Text>
                </TouchableOpacity>
            </View>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    container: { flex: 1, paddingHorizontal: 20, paddingVertical: 24, alignItems: "center" },
    title: { marginBottom: 12 },
    body: { marginBottom: 24, color: colors.whiteText },
    qrWrap: { alignItems: "center", marginBottom: 24 },
    button: {
        borderColor: colors.white,
        borderWidth: 1,
        borderRadius: 8,
        paddingVertical: 16,
        paddingHorizontal: 32,
        alignSelf: "stretch",
    },
});
