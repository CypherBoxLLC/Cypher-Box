import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    AppState,
    AppStateStatus,
    BackHandler,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import SimpleToast from 'react-native-simple-toast';

import { Button, Text } from '@Cypher/component-library';
import { arabicFont, colors, ltr, rtl } from '@Cypher/style-guide';
import { formatCapsuleAmount } from '@Cypher/helpers/bitcoinUnits';
import {
    MAX_CAPSULE_LABEL_LENGTH,
    capsulePresetLabels,
    cleanCapsuleLabel,
    labelHasPreset,
    saveCapsuleLabel,
    togglePresetLabel,
} from '@Cypher/helpers/capsuleLabels';
import useCapsuleWatcher from '@Cypher/custom-hooks/useCapsuleWatcher';
import useAuthStore from '@Cypher/stores/authStore';
import useCapsuleReceivedStore, { ReceivedCapsule } from '@Cypher/stores/capsuleReceivedStore';
import VaultCapsules from '../VaultCapsules';
import styles from './styles';
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../../blue_modules/hapticFeedback';
import { navigationRef } from '../../../NavigationService';
import loc from '../../../loc';

const fireShield = require('@Cypher/assets/images/fireShield.png');
const coldShield = require('@Cypher/assets/images/coldShield.png');

// Shown only here, so it never covers a send, signing or seed screen, nor the
// unlock screen; on any other screen the capsule waits in the queue.
const POPUP_ROUTES = ['HomeScreen', 'HotStorageVault'];

const currentRouteName = () => (navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined);

function useCurrentRouteName() {
    const [name, setName] = useState(currentRouteName);
    useEffect(() => {
        const update = () => setName(currentRouteName());
        update();
        return navigationRef.addListener('state', update);
    }, []);
    return name;
}

const isForeground = (state: AppStateStatus | null | undefined) => state !== 'background' && state !== 'inactive';

function useAppInForeground() {
    const [foreground, setForeground] = useState(() => isForeground(AppState.currentState));
    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => setForeground(isForeground(state)));
        return () => subscription.remove();
    }, []);
    return foreground;
}

function useKeyboardShown() {
    const [shown, setShown] = useState(false);
    useEffect(() => {
        const ios = Platform.OS === 'ios';
        const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true));
        const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false));
        return () => {
            show.remove();
            hide.remove();
        };
    }, []);
    return shown;
}

// The capsule as its vault card draws it, and its amount. Memoized so typing a
// label doesn't redraw it.
const CapsuleShape = React.memo(({ sats }: { sats: number }) => (
    <View style={styles.capsuleRow}>
        <View style={styles.capsuleSlot}>
            <VaultCapsules item={sats} />
        </View>
        <Text bold style={StyleSheet.flatten([styles.amount, rtl.ltrText])}>
            {ltr(formatCapsuleAmount(sats))}
        </Text>
    </View>
));
CapsuleShape.displayName = 'CapsuleShape';

type CardProps = {
    capsule: ReceivedCapsule;
    wallet: any;
    index: number;
    total: number;
    /** capsules in the queue, this one included */
    waiting: number;
    saveToDisk: () => Promise<unknown>;
    onDone: () => void;
    onIgnoreAll: () => void;
};

function CapsuleCard({ capsule, wallet, index, total, waiting, saveToDisk, onDone, onIgnoreAll }: CardProps) {
    const isCold = capsule.vault === 'cold';
    const accent = isCold ? colors.coldBlue : colors.green;
    const separator = loc.cypherbox.components.capsule_received.label_separator;
    const presets = useMemo(capsulePresetLabels, []);
    const keyboardShown = useKeyboardShown();
    const [saving, setSaving] = useState(false);
    // a label set earlier, in coin control for example, is kept
    const [label, setLabel] = useState<string>(() => {
        try {
            return wallet.getUTXOMetadata(capsule.txid, capsule.vout)?.memo || '';
        } catch (_) {
            return '';
        }
    });

    // JS-driven fade: under RN 0.77 Fabric a natively animated opacity can be
    // repainted stale when the keyboard resizes the view.
    const opacity = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: false }).start();
    }, [opacity]);

    const ignore = useCallback(() => {
        Keyboard.dismiss();
        onDone();
    }, [onDone]);

    const ignoreAll = useCallback(() => {
        Keyboard.dismiss();
        onIgnoreAll();
    }, [onIgnoreAll]);

    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            ignore();
            return true;
        });
        return () => subscription.remove();
    }, [ignore]);

    // the first tap outside only closes the keyboard, so a typed label isn't lost
    const onBackdrop = () => (keyboardShown ? Keyboard.dismiss() : ignore());

    const canSave = cleanCapsuleLabel(label).length > 0 && !saving;
    const save = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            await saveCapsuleLabel(wallet, capsule.txid, capsule.vout, label, saveToDisk);
            Keyboard.dismiss();
            onDone();
        } catch (_) {
            setSaving(false);
            SimpleToast.show(loc.cypherbox.components.capsule_received.save_failed, SimpleToast.SHORT);
        }
    };

    // from the latest label, not this render's: quick taps on two chips must both count
    const togglePreset = (text: string, excludes: string[]) =>
        setLabel(current => {
            const next = togglePresetLabel(current, text, excludes, separator);
            return next.length <= MAX_CAPSULE_LABEL_LENGTH ? next : current;
        });

    return (
        <Animated.View style={[styles.overlay, { opacity }]} pointerEvents="box-none">
            <Pressable
                style={styles.backdrop}
                onPress={onBackdrop}
                accessibilityRole="button"
                accessibilityLabel={loc.cypherbox.components.capsule_received.ignore}
            />
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.center}
                pointerEvents="box-none"
            >
                <Pressable
                    onPress={Keyboard.dismiss}
                    accessible={false}
                    accessibilityViewIsModal
                    style={[styles.card, { borderColor: accent, shadowColor: accent }]}
                    testID="CapsuleReceivedPopup"
                >
                    <View style={styles.header}>
                        <Image source={isCold ? coldShield : fireShield} style={styles.shield} resizeMode="contain" />
                        <View style={styles.headerText}>
                            <Text bold style={styles.title}>
                                {loc.cypherbox.components.capsule_received.title}
                            </Text>
                            <Text bold style={StyleSheet.flatten([styles.vault, { color: accent }])}>
                                {isCold
                                    ? loc.cypherbox.components.capsule_received.in_cold_vault
                                    : loc.cypherbox.components.capsule_received.in_hot_vault}
                            </Text>
                        </View>
                        {total > 1 && (
                            <Text style={styles.count}>
                                {loc.formatString(loc.cypherbox.components.capsule_received.count, {
                                    index: String(index),
                                    count: String(total),
                                })}
                            </Text>
                        )}
                    </View>

                    <CapsuleShape sats={capsule.sats} />

                    <TextInput
                        testID="CapsuleLabelInput"
                        value={label}
                        onChangeText={setLabel}
                        placeholder={loc.cypherbox.components.capsule_received.label_placeholder}
                        placeholderTextColor={colors.gray.placeholder}
                        accessibilityLabel={loc.cypherbox.components.capsule_received.label_placeholder}
                        maxLength={MAX_CAPSULE_LABEL_LENGTH}
                        autoCorrect={false}
                        returnKeyType="done"
                        keyboardAppearance="dark"
                        selectionColor={accent}
                        style={[styles.input, arabicFont(styles.input)]}
                    />

                    <View style={styles.presets}>
                        {presets.map(preset => {
                            const selected = labelHasPreset(label, preset.text);
                            return (
                                <TouchableOpacity
                                    key={preset.key}
                                    testID={`CapsulePreset-${preset.key}`}
                                    onPress={() => togglePreset(preset.text, preset.excludes)}
                                    style={[styles.chip, selected && { backgroundColor: accent, borderColor: accent }]}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected }}
                                >
                                    <Text style={selected ? [styles.chipText, styles.chipTextSelected] : styles.chipText}>
                                        {preset.text}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    <Button
                        text={loc.cypherbox.components.capsule_received.save}
                        onPress={save}
                        loading={saving}
                        disabled={!canSave && !saving}
                        style={{ backgroundColor: accent, borderColor: accent }}
                        textStyle={{ color: colors.primary }}
                    />
                    <View style={styles.secondaryRow}>
                        <TouchableOpacity style={styles.secondaryButton} onPress={ignore} accessibilityRole="button" testID="CapsuleIgnore">
                            <Text style={styles.secondaryText}>{loc.cypherbox.components.capsule_received.ignore}</Text>
                        </TouchableOpacity>
                        {waiting > 1 && (
                            <TouchableOpacity style={styles.secondaryButton} onPress={ignoreAll} accessibilityRole="button" testID="CapsuleIgnoreAll">
                                <Text style={styles.secondaryText}>{loc.cypherbox.components.capsule_received.ignore_all}</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </Pressable>
            </KeyboardAvoidingView>
        </Animated.View>
    );
}

/**
 * The capsule-received popup. Mounted once at the app root: it runs the vault
 * watcher and shows the queued capsules one by one, each with its amount,
 * vault, shape and a label field with preset labels. Drawn as an overlay, not a
 * Modal, so it can't fail to open while a bottom sheet is up; it appears once
 * the sheet closes.
 */
export default function CapsuleReceivedPopup() {
    useCapsuleWatcher();
    const { wallets, walletsInitialized, saveToDisk } = useContext(BlueStorageContext);
    const walletID = useAuthStore(s => s.walletID);
    const coldStorageWalletID = useAuthStore(s => s.coldStorageWalletID);
    const signingMode = useAuthStore(s => s.signingMode);
    const queue = useCapsuleReceivedStore(s => s.queue);
    const dequeue = useCapsuleReceivedStore(s => s.dequeue);
    const clearQueue = useCapsuleReceivedStore(s => s.clearQueue);
    const routeName = useCurrentRouteName();
    const foreground = useAppInForeground();
    // how many were labeled or ignored in this run of popups, for "2 of 3"
    const [handled, setHandled] = useState(0);

    // capsules of the vaults the app has now; those of a deleted vault wait
    const pending = useMemo(
        () => queue.filter(c => c.walletId === (c.vault === 'hot' ? walletID : coldStorageWalletID)),
        [queue, walletID, coldStorageWalletID],
    );

    useEffect(() => {
        if (pending.length === 0) setHandled(0);
    }, [pending.length]);

    // the first capsule whose wallet is loaded, so one that can't show doesn't hold up the rest
    const findWallet = (walletId: string) => (walletsInitialized ? wallets.find((w: any) => w.getID() === walletId) : undefined);
    const capsule = pending.find(c => findWallet(c.walletId));
    const wallet = capsule ? findWallet(capsule.walletId) : undefined;
    const visible = !!capsule && !!wallet && !signingMode && foreground && !!routeName && POPUP_ROUTES.includes(routeName);

    const onDone = useCallback(() => {
        if (!capsule) return;
        setHandled(n => n + 1);
        dequeue(capsule.walletId, capsule.id);
    }, [capsule, dequeue]);

    if (!visible) return null;
    return (
        <CapsuleCard
            key={`${capsule.walletId}:${capsule.id}`}
            capsule={capsule}
            wallet={wallet}
            index={handled + 1}
            total={handled + pending.length}
            waiting={pending.length}
            saveToDisk={saveToDisk}
            onDone={onDone}
            onIgnoreAll={clearQueue}
        />
    );
}
