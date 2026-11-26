import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { colors, rtl } from "@Cypher/style-guide";
import { createPendingSignature, formatSats, formatUsd, sameUnsignedTransaction, summarizePsbt } from "@Cypher/helpers";
import { confirmLabels, VaultSendKind } from "@Cypher/helpers/vaultSendKind";
import { HostSession, hostCommitStep, hostRevealStep, hostVerifyStep } from "@Cypher/helpers/antiExfilController";
import { decodeAntiExfilMessage, MAX_ANTI_EXFIL_INPUTS } from "@Cypher/helpers/antiExfilTransport";
import AntiExfilCode from "@Cypher/components/AntiExfilCode";
import AntiExfilTamperAlarm, { TamperAlarmVariant } from "@Cypher/components/AntiExfilTamperAlarm";
import useAuthStore from "@Cypher/stores/authStore";
import { shortenAddress } from "../ColdStorage";
import styles from "../HardwareWalletTransaction/styles";
import loc from "../../../loc";
import { randomBytes } from "../../../class/rng";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";

interface Props {
    route: any;
    navigation: any;
}

type Stage = "starting" | "commit" | "reveal" | "verifying" | "alarm";

/**
 * The Cold Vault's side of verified signing (anti-exfil): what the signing screen (HardwareWalletTransaction and its
 * Continue screen) is for a spend with "Verify my signing phone" on. Only reached through that switch. Instead of
 * showing the bare transaction, it runs the four-hop exchange with the signing phone and checks the result:
 *   1. shows the transaction with this vault's commitments (hop 1)
 *   2. scans the signing phone's commitment to its nonces (hop 2)
 *   3. shows the secret behind this vault's commitments (hop 3)
 *   4. scans the signed transaction (hop 4), and verifies that every signature opens to what was committed
 * A transaction that verifies goes to the same confirm screen as a plain one, which runs its own match check before
 * the swipe to send. One that doesn't ends in a full-screen alarm, and nothing is sent.
 *
 * The exchange's state, the vault's secret included, lives here in memory for the minutes it takes. The spend is kept
 * as a pending signature, as the plain screen keeps it, so an app closed midway can start a fresh exchange over the
 * same transaction from the Vault tab.
 */
export default function AntiExfilVerify({ route, navigation }: Props) {
    const params = route?.params ?? {};
    const { walletID = null, fromWallet, psbt, sats, inUSD, destinationAddress, networkFees, kind = null, changeSats = 0, to = null } = params;
    // the same labels and figures as the plain signing screen, read from the transaction the phone will sign
    const sendKind: VaultSendKind = kind || (to ? 'top_up' : 'send');
    const labels = confirmLabels(sendKind, { vaultTab: true, toCoinos: sendKind === 'top_up' && !!to && destinationAddress === to });
    const shown = useMemo(() => {
        let built = null;
        try {
            built = summarizePsbt(psbt, destinationAddress);
        } catch (_) {
            // fall back to what the review passed
        }
        const amount = built && built.amountSats > 0 ? built.amountSats : Number(sats) || 0;
        const usdPerSat = Number(sats) > 0 && Number(inUSD) > 0 ? Number(inUSD) / Number(sats) : null;
        return {
            amount,
            usd: usdPerSat !== null ? amount * usdPerSat : null,
            change: built ? built.changeSats : Number(changeSats) || 0,
            fee: built && built.fee !== null ? built.fee : kind ? Number(networkFees) || null : null,
        };
    }, [psbt, destinationAddress, sats, inUSD, changeSats, networkFees, kind]);
    const psbtBase64: string | null = useMemo(() => {
        try {
            return typeof psbt === 'string' ? psbt : psbt.toBase64();
        } catch (_) {
            return null;
        }
    }, [psbt]);

    const [stage, setStage] = useState<Stage>("starting");
    const [code, setCode] = useState<string>("");
    const [session, setSession] = useState<HostSession | null>(null);
    const [alarm, setAlarm] = useState<TamperAlarmVariant>("tamper");
    const [replyError, setReplyError] = useState<string | null>(null);

    const showAlarm = (variant: TamperAlarmVariant) => {
        setAlarm(variant);
        setStage("alarm");
    };

    // Signing happens on the other phone, so keep this until it is broadcast: if the app is closed meanwhile the vault
    // tab offers to resume it (through this screen again while the switch is on), and checks what comes back against it.
    useEffect(() => {
        if (!psbt || !walletID) return;
        const { pendingSignatures, setPendingSignature } = useAuthStore.getState();
        const current = pendingSignatures?.[walletID];
        if (current && sameUnsignedTransaction(current.psbt, psbt)) return;
        setPendingSignature(walletID, createPendingSignature(params));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [psbt, walletID]);

    // hop 1: fresh randomness for every input, committed to; nothing of it leaves this screen until hop 3
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                if (!psbtBase64) throw new Error('no transaction');
                const pool = Uint8Array.from(await randomBytes(32 * MAX_ANTI_EXFIL_INPUTS));
                let offset = 0;
                const nextRandom = () => {
                    const slice = pool.subarray(offset, offset + 32);
                    offset += 32;
                    return slice;
                };
                const { message, session: next } = hostCommitStep(psbtBase64, nextRandom);
                if (cancelled) return;
                setSession(next);
                setCode(message);
                setStage("commit");
            } catch (_e) {
                // an input the exchange can't cover, or no randomness: nothing to verify, so nothing to sign
                if (!cancelled) showAlarm("cannot_start");
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [psbtBase64]);

    const scan = (onData: (data: string) => void) => {
        setReplyError(null);
        requestCameraAuthorization().then(() => {
            navigation.navigate('ScanQRCodeRoot', {
                screen: 'ScanQRCode',
                params: {
                    launchedBy: route.name,
                    showFileImportButton: false,
                    onBarScanned: (ret: any) => {
                        const data = typeof ret === 'string' ? ret : ret?.data;
                        if (data) onData(String(data));
                    },
                },
            });
        });
    };

    // hop 2 in, hop 3 out: the signing phone's commitment, answered with this vault's secret
    const onOpenScanned = (data: string) => {
        if (!session) return;
        const decoded = decodeAntiExfilMessage(data);
        if (decoded.kind === 'unsupported-version') return showAlarm("unsupported");
        if (decoded.kind !== 'ok' || decoded.message.hop !== 'open' || decoded.message.sessionId !== session.id) {
            return setReplyError(loc.cypherbox.anti_exfil.wrong_reply);
        }
        try {
            const { message, session: next } = hostRevealStep(decoded.message, session);
            setSession(next);
            setCode(message);
            setStage("reveal");
        } catch (_e) {
            setReplyError(loc.cypherbox.anti_exfil.wrong_reply);
        }
    };

    // hop 4 in: every signature must open to the signing phone's commitment under this vault's secret, or nothing is sent
    const onSignScanned = (data: string) => {
        if (!session) return;
        const decoded = decodeAntiExfilMessage(data);
        if (decoded.kind === 'unsupported-version') return showAlarm("unsupported");
        if (decoded.kind !== 'ok' || decoded.message.hop !== 'sign' || decoded.message.sessionId !== session.id) {
            return setReplyError(loc.cypherbox.anti_exfil.wrong_reply);
        }
        setStage("verifying");
        try {
            const result = hostVerifyStep(decoded.message, session);
            if (result.verdict !== 'ok' || !result.signedPsbtBase64) {
                showAlarm("tamper");
                return;
            }
            // verified: the signed transaction takes the plain path from here, match check included
            const tx = fromWallet.combinePsbt(psbt, result.signedPsbtBase64);
            SimpleToast.show(loc.cypherbox.anti_exfil.verified_ok, SimpleToast.SHORT);
            setStage("reveal");
            navigation.navigate('ConfirmHardwareTransaction', { ...params, txHex: tx.toHex() });
        } catch (_e) {
            // a signed transaction that can't be checked or finished isn't sent either
            showAlarm("tamper");
        }
    };

    if (stage === "alarm") {
        return <AntiExfilTamperAlarm visible variant={alarm} onAcknowledge={() => navigation.goBack()} />;
    }

    const busy = stage === "starting" || stage === "verifying";
    const isCommit = stage === "commit";
    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <Text style={styles.title} center>{loc.cypherbox.payments.common.transaction_signing}</Text>
                <View style={styles.recipientView}>
                    <Text h4 style={local.lead}>{loc.cypherbox.anti_exfil.setting_title}</Text>
                    <Text h4 style={local.step}>
                        {stage === "verifying"
                            ? loc.cypherbox.anti_exfil.verifying
                            : isCommit || stage === "starting"
                            ? loc.cypherbox.anti_exfil.step_commit
                            : loc.cypherbox.anti_exfil.step_reveal}
                    </Text>
                    {busy ? (
                        <View style={local.busy}>
                            <ActivityIndicator size="large" color={colors.white} />
                        </View>
                    ) : (
                        // remounted per hop: the animated code splits its frames once, when it mounts
                        <AntiExfilCode key={stage} value={code} />
                    )}
                    <TouchableOpacity
                        onPress={() => scan(isCommit ? onOpenScanned : onSignScanned)}
                        disabled={busy}
                        style={[styles.nextBtn, local.scanButton, busy ? local.scanButtonBusy : null]}
                        accessibilityRole="button"
                    >
                        <Text h3>{isCommit || stage === "starting" ? loc.cypherbox.anti_exfil.scan_open : loc.cypherbox.anti_exfil.scan_sign}</Text>
                    </TouchableOpacity>
                    {replyError ? <Text style={local.error}>{replyError}</Text> : null}

                    {/* the built transaction's amount, change and fee: the same figures the review and the plain signing screen show */}
                    <View style={styles.priceView}>
                        <View>
                            <Text style={styles.recipientTitle}>{labels.amount}</Text>
                            <Text bold style={[styles.value, { color: colors.blueText }, rtl.ltrText]}>{formatSats(shown.amount) + (shown.usd !== null ? ' ~' + formatUsd(shown.usd) : '')}</Text>
                        </View>
                    </View>
                    <View style={styles.priceView}>
                        <View>
                            <Text style={styles.recipientTitle}>{labels.toTitle}</Text>
                            <Text style={StyleSheet.flatten([styles.fees, { color: colors.blueText }])}>{labels.to}{shortenAddress(destinationAddress)}</Text>
                        </View>
                    </View>
                    {shown.change > 0 &&
                        <View style={styles.priceView}>
                            <View>
                                <Text style={styles.recipientTitle}>{loc.cypherbox.payments.confirm_transaction.change}</Text>
                                <Text style={StyleSheet.flatten([styles.fees, rtl.ltrText])}>{formatSats(shown.change)}</Text>
                            </View>
                        </View>
                    }
                    {shown.fee !== null &&
                        <View style={styles.priceView}>
                            <View>
                                <Text style={styles.recipientTitle}>{loc.cypherbox.payments.confirm_transaction.network_fee}</Text>
                                <Text style={StyleSheet.flatten([styles.fees, rtl.ltrText])}>{formatSats(shown.fee)}</Text>
                            </View>
                        </View>
                    }
                </View>
            </View>
        </ScreenLayout>
    );
}

const local = StyleSheet.create({
    scanButton: {
        backgroundColor: colors.blueText,
    },
    scanButtonBusy: {
        opacity: 0.5,
    },
    lead: {
        marginBottom: 6,
        color: colors.white,
    },
    step: {
        marginBottom: 12,
        color: '#CCC',
    },
    busy: {
        height: 240,
        alignItems: 'center',
        justifyContent: 'center',
    },
    error: {
        marginTop: 10,
        fontSize: 14,
        lineHeight: 20,
        color: colors.redLight,
    },
});
