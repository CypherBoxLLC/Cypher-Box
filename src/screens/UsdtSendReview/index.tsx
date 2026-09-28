import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, ScrollView, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientButton, UsdtSuccess } from "@Cypher/components";
import { Check } from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { resolveHotVaultTronAccount, tronTransferSignerForWallet } from "@Cypher/services/tron/account";
import { USDT_ASSET_LABEL, USDT_DECIMALS } from "@Cypher/services/tron/constants";
import { decimalToUnits } from "@Cypher/services/tron/contract";
import { formatUsdtExact } from "@Cypher/services/tron/format";
import { checkUsdtSendReadiness } from "@Cypher/services/tron/send";
import { classifyTronSendDestination } from "@Cypher/services/tron/sendForm";
import { describeUsdtSend } from "@Cypher/services/tron/sendRun";
import useAuthStore from "@Cypher/stores/authStore";
import useUsdtSendStore, { usdtSendRunner, whenUsdtSendStoreReady } from "@Cypher/stores/usdtSendStore";
import { colors } from "@Cypher/style-guide";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import Biometric from "../../../class/biometrics";
// Same geometry as the swap flow's review step, deliberately.
import styles from "../UsdtSwapConfirm/styles";

interface Props {
    route: { params?: { amount?: string; destination?: string } };
}

/** Before a send is handed to the runner. Afterwards the record is the state. */
type Before =
    | { readonly kind: 'checking' }
    | { readonly kind: 'ready' }
    /** Cannot go ahead as asked. Nothing has been signed. */
    | { readonly kind: 'refused'; readonly message: string; readonly retry: boolean };

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

/**
 * Send USDT on Tron, step three: the review, the one tap that sends it, and
 * whatever became of it.
 *
 * Two screens in one, chosen by whether a send is on record. With none, this
 * is the review: the wallet is checked against the chain when the screen
 * opens, so a shortfall or a spent network allowance is known before the user
 * authenticates rather than after. Send asks for biometrics where they are on,
 * then hands the send to the runner, which writes it down before signing.
 *
 * Once there is a record this screen shows it instead, and it is reached
 * without route params from the card's Send button. That is what makes a send
 * survive the screen closing and the app being killed: on focus and on
 * foreground the runner settles any interrupted transfer against the chain.
 *
 * A send that may still land offers no retry and cannot be dismissed. Only one
 * the runner settled as never having gone out can be tried again.
 */
export default function UsdtSendReview({ route }: Props) {
    const amount = route?.params?.amount ?? '';
    const destinationRaw = route?.params?.destination ?? '';
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);
    const record = useUsdtSendStore((s) => s.record);

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

    const [before, setBefore] = useState<Before>({ kind: 'checking' });
    const startingRef = useRef(false);

    // Settle anything a previous session left in flight, on opening and on
    // coming back to the foreground.
    const resume = useCallback(() => {
        void whenUsdtSendStoreReady().then(() => usdtSendRunner.resume());
    }, []);
    useFocusEffect(resume);
    useEffect(() => {
        const sub = AppState.addEventListener('change', (state) => {
            if (state === 'active') resume();
        });
        return () => sub.remove();
    }, [resume]);

    const check = useCallback(async () => {
        if (!account || destination.kind !== 'tron') {
            setBefore({
                kind: 'refused',
                message: 'Your USDT comes from your Hot Vault, and this phone no longer has one.',
                retry: false,
            });
            return;
        }
        setBefore({ kind: 'checking' });
        try {
            const readiness = await checkUsdtSendReadiness(account.address, decimalToUnits(amount, USDT_DECIMALS));
            if (readiness.ready) {
                setBefore({ kind: 'ready' });
                return;
            }
            setBefore(
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
            setBefore({
                kind: 'refused',
                message: error instanceof Error && error.message ? error.message : 'Could not reach the Tron network.',
                retry: true,
            });
        }
    }, [account, destination, amount]);

    // Once, on opening, and only when this is a fresh review. Not on the
    // dependencies: the wallet list is rebuilt as the app saves, and each
    // rebuild would read the chain again.
    const checkRef = useRef(check);
    checkRef.current = check;
    const hasRecord = record !== null;
    useEffect(() => {
        if (!hasRecord) void checkRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onSend = async () => {
        if (startingRef.current || before.kind !== 'ready' || !account || !hotVault || destination.kind !== 'tron') return;
        startingRef.current = true;
        try {
            const sign = tronTransferSignerForWallet(hotVault);
            if (!sign) {
                setBefore({
                    kind: 'refused',
                    message: 'This Hot Vault holds no recovery phrase on this phone, so it cannot sign the transfer.',
                    retry: false,
                });
                return;
            }
            if (await Biometric.isBiometricUseCapableAndEnabled()) {
                if (!(await Biometric.unlockWithBiometrics())) {
                    startingRef.current = false;
                    return;
                }
            }
            await whenUsdtSendStoreReady();
            if (usdtSendRunner.canStart()) {
                usdtSendRunner.start({
                    account,
                    to: destination.value,
                    amount,
                    amountUnits: decimalToUnits(amount, USDT_DECIMALS),
                    sign,
                });
            }
            // Either way there is now a send on record, and that is what the
            // screen shows from here.
        } catch {
            // Only reached before start() took the send: nothing was signed.
            startingRef.current = false;
            setBefore({
                kind: 'refused',
                message: 'The transfer could not be started. Nothing was sent.',
                retry: true,
            });
        }
    };

    const goHome = () => {
        usdtSendRunner.dismiss();
        dispatchReset('HomeScreen');
    };
    const sendAgain = () => {
        if (!usdtSendRunner.dismiss()) return;
        dispatchNavigate('UsdtSend');
    };

    const usdtColors = [colors.usdt.gradient1, colors.usdt.gradient2];
    const to = destination.kind === 'tron' ? destination.value : destinationRaw;
    const view = record ? describeUsdtSend(record) : null;

    // A landed Tron transfer is final: sendRun only reaches 'sent' once it is
    // in a block. So this one celebrates with no caveat under it.
    if (record && record.phase === 'sent') {
        return (
            <ScreenLayout disableScroll showToolbar isBackButton title={`Send ${USDT_ASSET_LABEL}`}>
                <UsdtSuccess
                    title="Sent"
                    amount={`${formatUsdtExact(record.request.amount)} USDT`}
                    glyph={Check}
                    detail={
                        <>
                            <Text style={styles.destinationLabel}>To</Text>
                            <Text style={styles.destinationValue}>{record.request.destination}</Text>
                        </>
                    }
                    networkLabel="Tron network, TRC-20"
                    onHome={goHome}
                />
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title={`Send ${USDT_ASSET_LABEL}`}>
            <ScrollView style={styles.main} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {view ? (
                    <View style={styles.center}>
                        <Text bold style={styles.refusalTitle}>{view.title}</Text>
                        <Text style={styles.refusal}>{view.detail}</Text>
                        {view.busy && <ActivityIndicator size="large" color={colors.usdt.light} />}
                        {!!view.txID && (
                            <View style={styles.destinationBox}>
                                <Text style={styles.destinationValue}>{view.txID}</Text>
                            </View>
                        )}
                    </View>
                ) : (
                    <>
                        {before.kind === 'checking' && (
                            <View style={styles.center}>
                                <ActivityIndicator size="large" color={colors.usdt.light} />
                                <Text style={styles.quiet}>Checking this wallet can send...</Text>
                            </View>
                        )}

                        {before.kind === 'refused' && (
                            <View style={styles.center}>
                                <Text bold style={styles.refusalTitle}>Cannot send</Text>
                                <Text style={styles.refusal}>{before.message}</Text>
                            </View>
                        )}

                        {before.kind === 'ready' && (
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
                    </>
                )}
            </ScrollView>

            <View style={styles.footer}>
                {view ? (
                    <>
                        {view.canCheckAgain && (
                            <GradientButton style={styles.button} title="Check again" onPress={resume} colors_={usdtColors} />
                        )}
                        {view.canRetry && (
                            <GradientButton style={styles.button} title="Try again" onPress={sendAgain} colors_={usdtColors} />
                        )}
                        {!view.busy && !view.canCheckAgain && !view.canRetry && (
                            <GradientButton style={styles.button} title="Done" onPress={goHome} colors_={usdtColors} />
                        )}
                    </>
                ) : (
                    <>
                        {before.kind === 'ready' && (
                            <>
                                <Text style={styles.caution}>
                                    Check the address. Once USDT is sent on Tron, it cannot be recalled.
                                </Text>
                                <GradientButton style={styles.button} title="Send" onPress={onSend} colors_={usdtColors} />
                            </>
                        )}
                        {before.kind === 'refused' && before.retry && (
                            <GradientButton style={styles.button} title="Try again" onPress={() => void check()} colors_={usdtColors} />
                        )}
                        {before.kind === 'refused' && !before.retry && (
                            <GradientButton style={styles.button} title="Home" onPress={() => dispatchReset('HomeScreen')} colors_={usdtColors} />
                        )}
                    </>
                )}
            </View>
        </ScreenLayout>
    );
}
