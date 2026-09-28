import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientButton } from "@Cypher/components";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { resolveHotVaultTronAccount, tronTransferSignerForWallet } from "@Cypher/services/tron/account";
import { USDT_ASSET_LABEL, USDT_DECIMALS } from "@Cypher/services/tron/constants";
import { decimalToUnits } from "@Cypher/services/tron/contract";
import { formatUsdtExact } from "@Cypher/services/tron/format";
import {
    type TronSendRemedy,
    TronSendError,
    checkUsdtSendReadiness,
    confirmUsdtTransfer,
    sendUsdt,
} from "@Cypher/services/tron/send";
import { classifyTronSendDestination } from "@Cypher/services/tron/sendForm";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import Biometric from "../../../class/biometrics";
// Same geometry as the swap flow's review step, deliberately.
import styles from "../UsdtSwapConfirm/styles";

interface Props {
    route: { params?: { amount?: string; destination?: string } };
}

type Stage =
    | { readonly kind: 'checking' }
    | { readonly kind: 'ready' }
    /** Cannot go ahead as asked. Nothing has been signed. */
    | { readonly kind: 'refused'; readonly message: string; readonly retry: boolean }
    | { readonly kind: 'sending' }
    | { readonly kind: 'sent'; readonly txID: string }
    /**
     * The send did not go through, or might not have. `settled` false means a
     * signed transfer may still land, so this must never say nothing moved and
     * must not offer to send again.
     */
    | {
          readonly kind: 'failed';
          readonly message: string;
          readonly settled: boolean;
          readonly txID?: string;
          /** Only when the send module settled that nothing moved. */
          readonly canRetry: boolean;
      };

function Row({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
    return (
        <View style={styles.row}>
            <Text bold style={styles.rowLabel}>{label}</Text>
            <Text bold={emphasis} style={emphasis ? [styles.rowValue, styles.rowValueEmphasis] : styles.rowValue}>
                {value}
            </Text>
        </View>
    );
}

/** A remedy that means nothing was sent and trying again now is reasonable. */
const RETRYABLE: ReadonlySet<TronSendRemedy> = new Set<TronSendRemedy>(['retry', 'wait', 'retry_later']);

/**
 * Send USDT on Tron, step three: the review, and the one tap that sends it.
 *
 * The wallet is checked against the chain when the screen opens, so a shortfall
 * or a spent network allowance is known before the user commits rather than
 * after they have authenticated. Send asks for biometrics where they are on,
 * as a Hot Vault send does.
 *
 * A signed Tron transfer can land after the app stops, so nothing here ever
 * says the money did not move unless the send module settled that against the
 * chain. An indeterminate failure shows the transfer id and offers no retry.
 *
 * A synchronous latch, not React state, stops a second tap signing a second
 * transfer before the first has rendered.
 */
export default function UsdtSendReview({ route }: Props) {
    const amount = route?.params?.amount ?? '';
    const destinationRaw = route?.params?.destination ?? '';
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    const hotVault = useMemo(
        () => (wallets || []).find((w: any) => typeof w?.getID === 'function' && w.getID() === walletID),
        [wallets, walletID],
    );
    // Memoised: the derivation runs BIP39's PBKDF2 over 2048 rounds.
    const account = useMemo(() => resolveHotVaultTronAccount(wallets, walletID), [wallets, walletID]);

    const destination = useMemo(
        () => classifyTronSendDestination(destinationRaw, account?.address ?? null),
        [destinationRaw, account],
    );

    const [stage, setStage] = useState<Stage>({ kind: 'checking' });
    const sendingRef = useRef(false);

    const check = useCallback(async () => {
        if (!account || destination.kind !== 'tron') {
            setStage({
                kind: 'refused',
                message: 'Your USDT comes from your Hot Vault, and this phone no longer has one.',
                retry: false,
            });
            return;
        }
        setStage({ kind: 'checking' });
        try {
            const readiness = await checkUsdtSendReadiness(account.address, decimalToUnits(amount, USDT_DECIMALS));
            if (readiness.ready) {
                setStage({ kind: 'ready' });
                return;
            }
            setStage(
                readiness.code === 'INSUFFICIENT_USDT'
                    ? { kind: 'refused', message: 'Your USDT balance is lower than this amount.', retry: false }
                    : {
                          kind: 'refused',
                          message:
                              readiness.retryAfterSeconds !== undefined
                                  ? 'This wallet has used its free Tron network allowance for now. It refills over the day, so try again later.'
                                  : "This wallet's free Tron network allowance is too small for a transfer. Contact Cypher Box support.",
                          retry: readiness.retryAfterSeconds !== undefined,
                      },
            );
        } catch (error) {
            setStage({
                kind: 'refused',
                message: error instanceof Error && error.message ? error.message : 'Could not reach the Tron network.',
                retry: true,
            });
        }
    }, [account, destination, amount]);

    // Once, on opening. Not on the dependencies: the wallet list is rebuilt as
    // the app saves, and each rebuild would read the chain again.
    const checkRef = useRef(check);
    checkRef.current = check;
    useEffect(() => {
        void checkRef.current();
    }, []);

    const onSend = async () => {
        if (sendingRef.current || stage.kind !== 'ready' || !account || !hotVault || destination.kind !== 'tron') return;
        sendingRef.current = true;
        let submittedTxID: string | undefined;
        try {
            const sign = tronTransferSignerForWallet(hotVault);
            if (!sign) {
                setStage({
                    kind: 'refused',
                    message: 'This Hot Vault holds no recovery phrase on this phone, so it cannot sign the transfer.',
                    retry: false,
                });
                return;
            }
            if (await Biometric.isBiometricUseCapableAndEnabled()) {
                if (!(await Biometric.unlockWithBiometrics())) return;
            }
            setStage({ kind: 'sending' });
            const receipt = await sendUsdt({
                from: account,
                to: destination.value,
                amountUnits: decimalToUnits(amount, USDT_DECIMALS),
                sign,
                onSubmit: (transfer) => {
                    submittedTxID = transfer.txID;
                },
            });
            await confirmUsdtTransfer(receipt);
            setStage({ kind: 'sent', txID: receipt.txID });
        } catch (error) {
            if (error instanceof TronSendError) {
                // The send module settled these against the backend or the
                // chain. Anything else may still be on its way to a block, and
                // a second transfer while the first could land pays twice.
                const settled = !error.indeterminate;
                const canRetry = settled && RETRYABLE.has(error.remedy);
                setStage({
                    kind: 'failed',
                    message: error.message,
                    settled,
                    canRetry,
                    ...(error.detail.txID ?? submittedTxID ? { txID: error.detail.txID ?? submittedTxID } : {}),
                });
                // Unlatched only when nothing moved. Otherwise this screen
                // sends nothing else for the rest of its life.
                if (canRetry) sendingRef.current = false;
                return;
            }
            setStage({
                kind: 'failed',
                message:
                    'Could not confirm whether your transfer went out. It may still land, so do not send this USDT again until it is settled.',
                settled: false,
                canRetry: false,
                ...(submittedTxID ? { txID: submittedTxID } : {}),
            });
        }
    };

    const goHome = () => dispatchReset('HomeScreen');
    const usdtColors = [colors.usdt.gradient1, colors.usdt.gradient2];
    const to = destination.kind === 'tron' ? destination.value : destinationRaw;

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title={`Send ${USDT_ASSET_LABEL}`}>
            <ScrollView style={styles.main} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {stage.kind === 'checking' && (
                    <View style={styles.center}>
                        <ActivityIndicator size="large" color={colors.usdt.light} />
                        <Text style={styles.quiet}>Checking this wallet can send...</Text>
                    </View>
                )}

                {stage.kind === 'refused' && (
                    <View style={styles.center}>
                        <Text bold style={styles.refusalTitle}>Cannot send</Text>
                        <Text style={styles.refusal}>{stage.message}</Text>
                    </View>
                )}

                {(stage.kind === 'ready' || stage.kind === 'sending') && (
                    <View>
                        <Row label="You send" value={`${formatUsdtExact(amount)} USDT`} emphasis />
                        <Text style={styles.rowNote}>
                            The network cost is paid separately, so this is the amount that arrives.
                        </Text>

                        <Row label="Over" value="The Tron network, TRC-20" />

                        <View style={styles.row}>
                            <Text bold style={styles.rowLabel}>To</Text>
                            <Text style={styles.destinationLabel}>Tron address</Text>
                            <View style={styles.destinationBox}>
                                <Text style={styles.destinationValue}>{to}</Text>
                            </View>
                        </View>
                    </View>
                )}

                {stage.kind === 'sent' && (
                    <View style={styles.center}>
                        <Text bold style={styles.refusalTitle}>Sent</Text>
                        <Text style={styles.refusal}>
                            {`${formatUsdtExact(amount)} USDT is on its way to ${to}.`}
                        </Text>
                        <View style={styles.destinationBox}>
                            <Text style={styles.destinationValue}>{stage.txID}</Text>
                        </View>
                    </View>
                )}

                {stage.kind === 'failed' && (
                    <View style={styles.center}>
                        <Text bold style={styles.refusalTitle}>
                            {stage.settled ? 'Not sent' : 'Not confirmed'}
                        </Text>
                        <Text style={styles.refusal}>{stage.message}</Text>
                        {!!stage.txID && (
                            <View style={styles.destinationBox}>
                                <Text style={styles.destinationValue}>{stage.txID}</Text>
                            </View>
                        )}
                    </View>
                )}
            </ScrollView>

            <View style={styles.footer}>
                {stage.kind === 'ready' && (
                    <>
                        <Text style={styles.caution}>
                            Check the address. Once USDT is sent on Tron, it cannot be recalled.
                        </Text>
                        <GradientButton style={styles.button} title="Send" onPress={onSend} colors_={usdtColors} />
                    </>
                )}
                {stage.kind === 'sending' && (
                    <GradientButton style={styles.button} title="Sending..." disabled onPress={() => {}} colors_={usdtColors} />
                )}
                {stage.kind === 'refused' && stage.retry && (
                    <GradientButton style={styles.button} title="Try again" onPress={() => void check()} colors_={usdtColors} />
                )}
                {stage.kind === 'refused' && !stage.retry && (
                    <GradientButton style={styles.button} title="Home" onPress={goHome} colors_={usdtColors} />
                )}
                {stage.kind === 'failed' && stage.canRetry && (
                    <GradientButton style={styles.button} title="Try again" onPress={() => void check()} colors_={usdtColors} />
                )}
                {stage.kind === 'failed' && !stage.canRetry && (
                    <GradientButton style={styles.button} title="Home" onPress={goHome} colors_={usdtColors} />
                )}
                {stage.kind === 'sent' && (
                    <GradientButton style={styles.button} title="Done" onPress={goHome} colors_={usdtColors} />
                )}
            </View>
        </ScreenLayout>
    );
}
