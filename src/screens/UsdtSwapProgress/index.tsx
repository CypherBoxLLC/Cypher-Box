import Clipboard from "@react-native-clipboard/clipboard";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect } from "react";
import { ActivityIndicator, Alert, AppState, ScrollView, TouchableOpacity, View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientButton } from "@Cypher/components";
import { dispatchReset, resetAndNavigate } from "@Cypher/helpers/navigation";
import { getChainSwapProvider } from "@Cypher/services/chainSwap";
import { describeUsdtSwap, type SwapStep } from "@Cypher/services/tron/swapMessages";
import useUsdtSwapStore, { usdtSwapRunner, whenUsdtSwapStoreReady } from "@Cypher/stores/usdtSwapStore";
import { colors } from "@Cypher/style-guide";

import styles from "./styles";

/**
 * Remedies after which the same swap can be quoted again straight away. Not
 * "wait" or "retry_later": those say when to come back, and a retry now would
 * only be refused again.
 */
const RETRY_NOW = new Set(['retry', 'requote']);

function StepRow({ step }: { step: SwapStep }) {
    const dotStyle =
        step.state === 'done' ? styles.dotDone : step.state === 'active' ? styles.dotActive : styles.dotPending;
    return (
        <View style={styles.step}>
            <View style={[styles.dot, dotStyle]} />
            <Text style={step.state === 'pending' ? [styles.stepLabel, styles.stepLabelPending] : styles.stepLabel}>
                {step.label}
            </Text>
        </View>
    );
}

/**
 * Swap USDT to bitcoin, step four: the swap as it goes through.
 *
 * Everything here is read from the stored swap (stores/usdtSwapStore), which
 * the runner keeps up to date, so the screen can close and reopen, from the
 * card's Swap button, at any point. Opening it, and the app coming back to
 * the foreground, resume the swap: an interrupted send is settled against the
 * chain, and a landed deposit's order is followed.
 *
 * It offers nothing that could pay twice. While a deposit could still land
 * (sending, checking, unconfirmed) the only ways out are Home and, when the
 * outcome is unknown, Check again. A swap is forgotten only once it ended,
 * sent nothing, or has its deposit in a block.
 */
export default function UsdtSwapProgress() {
    const record = useUsdtSwapStore((s) => s.record);

    const resume = useCallback(() => {
        void whenUsdtSwapStoreReady().then(() => usdtSwapRunner.resume());
    }, []);

    useFocusEffect(resume);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') resume();
        });
        return () => subscription.remove();
    }, [resume]);

    const goHome = () => dispatchReset('HomeScreen');

    const onDone = () => {
        usdtSwapRunner.dismiss();
        goHome();
    };

    const onTryAgain = () => {
        if (!record) return;
        const { usdtAmount, destination } = record.request;
        if (!usdtSwapRunner.dismiss()) return;
        resetAndNavigate('HomeScreen', 'UsdtSwapConfirm', { amount: usdtAmount, destination });
    };

    const onStopFollowing = () => {
        Alert.alert(
            'Stop following this swap?',
            'The swap carries on at Flashnet, but this app stops showing it. Copy the reference first if you may need support.',
            [
                { text: 'Keep following', style: 'cancel' },
                {
                    text: 'Stop following',
                    style: 'destructive',
                    onPress: () => {
                        if (usdtSwapRunner.dismiss()) goHome();
                    },
                },
            ],
        );
    };

    const copy = (value: string, what: string) => {
        Clipboard.setString(value);
        SimpleToast.show(`${what} copied`, SimpleToast.SHORT);
    };

    if (!record) {
        return (
            <ScreenLayout disableScroll showToolbar isBackButton title="USDT swap">
                <View style={styles.main}>
                    <Text bold style={styles.title}>No swap under way</Text>
                    <View style={styles.spacer} />
                    <View style={styles.footer}>
                        <GradientButton
                            style={styles.button}
                            title="Home"
                            onPress={goHome}
                            colors_={[colors.usdt.gradient1, colors.usdt.gradient2]}
                        />
                    </View>
                </View>
            </ScreenLayout>
        );
    }

    const view = describeUsdtSwap(record);
    const ended = record.phase === 'finished' || record.phase === 'not_sent';
    const canRetry = record.phase === 'not_sent' && RETRY_NOW.has(record.sendError?.remedy ?? '');
    const canCheckAgain = record.phase === 'unconfirmed' || (record.phase === 'following' && !!record.followError);
    const canStopFollowing =
        record.phase === 'following' && (view.showSupport || !!record.followError);
    // The landed deposit, or until one is known the newest transfer signed,
    // which is the one support would look for. None once nothing was sent.
    const landedTxId = record.order.depositTxId;
    const depositTxId =
        record.phase === 'not_sent' ? undefined : landedTxId ?? record.transfers[record.transfers.length - 1]?.txID;
    const support = getChainSwapProvider('flashnet').supportUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const titleColor =
        view.tone === 'success' ? colors.usdt.light : view.tone === 'problem' ? colors.redLight : colors.white;

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title="USDT swap">
            <ScrollView style={styles.main} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <Text bold style={[styles.title, { color: titleColor }]}>{view.title}</Text>
                {view.busy && <ActivityIndicator style={styles.spinner} size="small" color={colors.usdt.light} />}
                <Text style={styles.detail}>{view.detail}</Text>
                {!!view.notice && <Text style={styles.notice}>{view.notice}</Text>}

                {view.steps && (
                    <View style={styles.steps}>
                        {view.steps.map((step) => (
                            <StepRow key={step.label} step={step} />
                        ))}
                    </View>
                )}

                {(view.showSupport || !!depositTxId) && (
                    <View style={styles.references}>
                        <TouchableOpacity onPress={() => copy(record.order.id, 'Reference')} activeOpacity={0.8}>
                            <Text style={styles.referenceLabel}>Reference</Text>
                            <Text style={styles.referenceValue}>{record.order.id}</Text>
                        </TouchableOpacity>
                        {!!depositTxId && (
                            <TouchableOpacity onPress={() => copy(depositTxId, 'Deposit id')} activeOpacity={0.8}>
                                <Text style={styles.referenceLabel}>
                                    {landedTxId ? 'Deposit on Tron' : 'Deposit on Tron, not confirmed yet'}
                                </Text>
                                <Text style={styles.referenceValue}>{depositTxId}</Text>
                            </TouchableOpacity>
                        )}
                        {view.showSupport && (
                            <Text style={styles.supportLine}>{`Cypher Box support: ${support}`}</Text>
                        )}
                        <Text style={styles.copyHint}>Tap a reference to copy it.</Text>
                    </View>
                )}
            </ScrollView>

            <View style={styles.footer}>
                {canCheckAgain && (
                    <GradientButton
                        style={styles.button}
                        title="Check again"
                        onPress={resume}
                        colors_={[colors.usdt.gradient1, colors.usdt.gradient2]}
                    />
                )}
                {canRetry && (
                    <GradientButton
                        style={styles.button}
                        title="Try again"
                        onPress={onTryAgain}
                        colors_={[colors.usdt.gradient1, colors.usdt.gradient2]}
                    />
                )}
                <GradientButton
                    style={canCheckAgain || canRetry ? [styles.button, styles.secondButton] : styles.button}
                    title={ended ? 'Done' : 'Home'}
                    onPress={ended ? onDone : goHome}
                    colors_={[colors.usdt.gradient1, colors.usdt.gradient2]}
                />
                {canStopFollowing && (
                    <TouchableOpacity style={styles.textButton} onPress={onStopFollowing} accessibilityRole="button">
                        <Text style={styles.textButtonLabel}>Stop following this swap</Text>
                    </TouchableOpacity>
                )}
            </View>
        </ScreenLayout>
    );
}
