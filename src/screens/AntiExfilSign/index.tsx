import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import QRCodeComponent from "../../../components/QRCodeComponent";
import { scanQrHelper } from "../../../helpers/scan-qr";
import loc from "../../../loc";
import ecc from "../../../blue_modules/noble_ecc";
import { ECPairFactory } from "ecpair";
import {
    SignerKeyAccess,
    signerCommitStep,
    signerSignStep,
    SignerSession,
} from "@Cypher/helpers/antiExfilController";
import { decodeAntiExfilMessage } from "@Cypher/helpers/antiExfilTransport";
import useAntiExfilStore from "@Cypher/stores/antiExfilStore";

const ECPair = ECPairFactory(ecc);

interface Props {
    route: any;
    navigation: any;
}

type Stage = "working" | "showOpen" | "showSign" | "done" | "error";

/**
 * Signer side (offline Hot Vault) of the anti-exfil protocol.
 *
 * Reached from the Hot Vault signing path when the scanned payload is an
 * anti-exfil `commit` container rather than a plain PSBT. Drives the signer's
 * two hops:
 *   - commit -> show the openings QR (hop 2)
 *   - scan the host's reveal, then show the signed-transaction QR (hop 4)
 *
 * The heavy lifting lives in the pure, unit-tested controller; this screen is
 * just QR I/O. It never logs key material.
 */
export default function AntiExfilSign({ route, navigation }: Props) {
    const { wallet, commit } = route?.params || {};
    const { setSignerSession, clearSignerSession } = useAntiExfilStore();

    const [stage, setStage] = useState<Stage>("working");
    const [payload, setPayload] = useState<string>("");
    const [session, setSession] = useState<SignerSession | null>(null);
    const [errorMessage, setErrorMessage] = useState<string>("");

    // Derive private keys the same way cosignPsbt does: by (change, index) off
    // the wallet, so the account derivation matches exactly.
    const access: SignerKeyAccess = {
        // Single-sig vault: take the sole derivation per input. The pubkey
        // match in `derive` below is the safety net that it is really ours.
        fingerprint: undefined,
        derive: (path: string, pubkey: Uint8Array) => {
            try {
                const parts = path.split("/");
                const internal = +parts[parts.length - 2];
                const index = +parts[parts.length - 1];
                const wif = wallet._getWIFByIndex(!!internal, index);
                if (!wif) return null;
                const keyPair = ECPair.fromWIF(wif);
                const priv = keyPair.privateKey;
                if (!priv) return null;
                // Sanity: the derived key must match the pubkey the host referenced.
                if (Buffer.from(keyPair.publicKey).toString("hex") !== Buffer.from(pubkey).toString("hex")) return null;
                return Uint8Array.from(priv);
            } catch (_e) {
                return null;
            }
        },
    };

    const fail = (message: string) => {
        setErrorMessage(message);
        setStage("error");
    };

    const runCommit = useCallback((commitString: string) => {
        const decoded = decodeAntiExfilMessage(commitString);
        if (decoded.kind !== "ok" || decoded.message.hop !== "commit") {
            fail(loc.cypherbox.anti_exfil.unsupported_message);
            return;
        }
        try {
            const { message, session: sess } = signerCommitStep(decoded.message, access);
            setSignerSession(sess);
            setSession(sess);
            setPayload(message);
            setStage("showOpen");
        } catch (_e) {
            fail(loc.cypherbox.anti_exfil.unsupported_message);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (commit) {
            runCommit(commit);
        } else {
            // No commit handed in: open the scanner to read it.
            scanQrHelper(navigation.navigate, route.name, { wallet }).then(data => {
                if (!data) {
                    navigation.goBack();
                    return;
                }
                runCommit(String(data));
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const scanRevealAndSign = async () => {
        const data = await scanQrHelper(navigation.navigate, route.name, { wallet });
        if (!data) return;
        const decoded = decodeAntiExfilMessage(String(data));
        if (decoded.kind !== "ok" || decoded.message.hop !== "reveal" || !session) {
            fail(loc.cypherbox.anti_exfil.unsupported_message);
            return;
        }
        try {
            const { message } = signerSignStep(decoded.message, session, access);
            setPayload(message);
            setStage("showSign");
            clearSignerSession();
        } catch (_e) {
            fail(loc.cypherbox.anti_exfil.unsupported_message);
        }
    };

    if (stage === "working") {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.center}>
                    <ActivityIndicator />
                </View>
            </ScreenLayout>
        );
    }

    if (stage === "error") {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.container}>
                    <Text h3 bold center style={styles.title}>
                        {loc.cypherbox.anti_exfil.unsupported_title}
                    </Text>
                    <Text h4 center style={styles.body}>
                        {errorMessage}
                    </Text>
                    <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
                        <Text h3 bold center>
                            {loc._.ok}
                        </Text>
                    </TouchableOpacity>
                </View>
            </ScreenLayout>
        );
    }

    const isOpen = stage === "showOpen";
    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <Text h3 bold center style={styles.title}>
                    {loc.cypherbox.anti_exfil.setting_title}
                </Text>
                <Text h4 center style={styles.body}>
                    {isOpen ? loc.cypherbox.anti_exfil.verify_step_reveal : loc.cypherbox.anti_exfil.verify_step_scan_sign}
                </Text>
                <View style={styles.qrWrap}>
                    <QRCodeComponent value={payload} ecl="L" />
                </View>
                {isOpen ? (
                    <TouchableOpacity style={styles.button} onPress={scanRevealAndSign}>
                        <Text h3 bold center>
                            {loc.cypherbox.anti_exfil.verify_step_scan_open}
                        </Text>
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
                        <Text h3 bold center>
                            {loc._.ok}
                        </Text>
                    </TouchableOpacity>
                )}
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
