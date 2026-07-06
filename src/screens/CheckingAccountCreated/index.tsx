import React, { useState } from "react";
import { Alert, ScrollView, Switch, View, Text as RNText, TouchableOpacity } from "react-native";
import * as Keychain from "react-native-keychain";
import Ionicons from "react-native-vector-icons/Ionicons";
import SimpleToast from "react-native-simple-toast";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import { Card, SavingVault } from "@Cypher/components";
import useAuthStore from "@Cypher/stores/authStore";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { formatNumber } from "@Cypher/helpers/coinosHelper";
import { Picker } from "@react-native-picker/picker";
import Modal from "react-native-modal";
import { useRoute } from "@react-navigation/native";
import { setArkBackgroundRefreshEnabled } from "@Cypher/services/ark";
import styles from "./styles";
import LightningVaultCreate from "@Cypher/components/LightningVaultCreate/LightningVaultCreate";

const thresholdOptions = [
    100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000,
    1000000, 2000000, 3000000, 4000000, 5000000, 6000000, 7000000, 8000000, 9000000, 10000000,
];

export default function CheckingAccountCreated() {
    const [isValidate, setIsValidate] = useState(false);
    const [pickerVisible, setPickerVisible] = useState(false);
    const route = useRoute();
    const { accountType } = (route.params as { accountType?: string }) || {};
    const {
        vaultTab, strikeMe, FirstTimeLightning, setFirstTimeLightning,
        FirstTimeCoinOS, setFirstTimeCoinOS,
        setFirstTimeArk,
        withdrawThreshold, setWithdrawThreshold,
        withdrawStrikeThreshold, setWithdrawStrikeThreshold,
        withdrawArkThreshold, setWithdrawArkThreshold,
        arkBgRefreshEnabled,
    } = useAuthStore();
    const [togglingBgRefresh, setTogglingBgRefresh] = useState(false);

    // Same enable/disable pattern as the Settings tab toggle. No seed
    // needed on either path — enabling just flips the flag and requests
    // notification permission.
    const handleToggleBgRefresh = async (next: boolean) => {
        if (togglingBgRefresh) return;
        setTogglingBgRefresh(true);
        try {
            await setArkBackgroundRefreshEnabled(next);
        } catch (err: any) {
            console.warn("[Ark vault created] bg-refresh toggle failed:", err);
            SimpleToast.show(
                `Toggle failed: ${err?.message ?? "unknown error"}`,
                SimpleToast.LONG,
            );
        } finally {
            setTogglingBgRefresh(false);
        }
    };

    const isStrike = accountType === 'strike';
    const isArk = accountType === 'ark';

    // Pick the right default threshold + title color per provider.
    const accentColor = isArk
        ? colors.ark.light
        : colors.pink.light;
    const titleText = isArk
        ? 'Bark Vault Created!'
        : 'Lightning Account Created!';

    const initialThreshold = isArk
        ? (Number(withdrawArkThreshold) || 500000)
        : isStrike
            ? (Number(withdrawStrikeThreshold) || 1000000)
            : (Number(withdrawThreshold) || 500000);
    const [selectedThreshold, setSelectedThreshold] = useState(initialThreshold);

    const persistThreshold = (value: number) => {
        if (isArk) {
            setWithdrawArkThreshold(value);
        } else if (isStrike) {
            setWithdrawStrikeThreshold(value);
        } else {
            setWithdrawThreshold(value);
        }
    };

    const nextClickHandler = () => {
        console.log('next click');
        if (isArk) {
            setFirstTimeArk(false);
        } else if (isStrike) {
            setFirstTimeLightning(false);
        } else {
            setFirstTimeCoinOS(false);
        }
        if(vaultTab){
            dispatchReset('HomeScreen');
        } else {
            dispatchReset('HomeScreen', {
                isComplete: true
            });
        }
    }

    const nextClickInitiate = () => {
        setIsValidate(true);
    }

    console.log('strikeMe: ', strikeMe)
    return (
        <ScreenLayout disableScroll showToolbar progress={2} color={[accentColor, accentColor]} isBackButton={false} isClose onBackPress={nextClickHandler}>
            <View style={styles.container}>
                <Text style={[styles.title, { color: accentColor }]} center>{titleText}</Text>
                <View style={styles.inner}>
                    {isArk ? (
                        <>
                            {/* Reuse the same Card box the home screen +
                                Ark Vault tab use, with two preview-only
                                tweaks via Card props:
                                  - hideBalance: a freshly created wallet
                                    has nothing — "0 sats ~ $0.00" is noise.
                                  - arkCapsuleSlots: decorative full row
                                    of 10 colored pills (green / yellow /
                                    orange / red — same palette as the
                                    real capsule expiry bands) so the box
                                    actually LOOKS like an Ark vault visual,
                                    not an empty placeholder.
                                Card hides its threshold bar for wallet ===
                                'ARK', so threshold props are placeholders. */}
                            <View style={{ marginTop: 8, alignItems: 'center' }}>
                                <Card
                                    wallet="ARK"
                                    title="Bark Vault"
                                    balance={0}
                                    currency="USD"
                                    matchedRate={0}
                                    convertedRate={0}
                                    reserveAmount={0}
                                    withdrawThreshold={0}
                                    refreshingInfo={null}
                                    hideBalance
                                    arkCapsuleSlots={[
                                        { color: '#4ADE80', refreshing: false }, // green
                                        { color: '#4ADE80', refreshing: false },
                                        { color: '#4ADE80', refreshing: false },
                                        { color: '#F2C94C', refreshing: false }, // yellow
                                        { color: '#F2C94C', refreshing: false },
                                        { color: '#FB923C', refreshing: false }, // orange
                                        { color: '#FB923C', refreshing: false },
                                        { color: '#FF6B6B', refreshing: false }, // red
                                        { color: '#FF6B6B', refreshing: false },
                                        { color: '#FF6B6B', refreshing: false },
                                    ]}
                                />
                            </View>
                            <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
                                {/* The capsules-must-be-refreshed contract — the most
                                    important thing for newbies to internalize. */}
                                <Text bold style={{ fontSize: 15, marginTop: 18, marginHorizontal: 10, color: accentColor }}>
                                    Capsules must be refreshed
                                </Text>
                                <Text h4 style={[styles.descption, { fontSize: 14, marginTop: 6 }]}>
                                    To keep your balance available and self-custodial, your lightning capsules (VTXOs) need to be refreshed.
                                </Text>

                                {/* Toggle. Default ON (armed during create);
                                    user can flip OFF but a red warning then
                                    appears explaining the consequence. */}
                                <View style={{ backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginTop: 12, marginHorizontal: 10 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <RNText style={{ fontSize: 14, fontWeight: '700', color: colors.white, flex: 1, marginRight: 12 }}>
                                            Capsule expiry reminders
                                        </RNText>
                                        <Switch
                                            value={arkBgRefreshEnabled}
                                            onValueChange={handleToggleBgRefresh}
                                            disabled={togglingBgRefresh}
                                            trackColor={{ false: '#3a3a3a', true: colors.green }}
                                            thumbColor={colors.white}
                                        />
                                    </View>
                                    <Text style={{ fontSize: 12, color: arkBgRefreshEnabled ? '#888' : colors.redLight, marginTop: 6, lineHeight: 16 }}>
                                        {arkBgRefreshEnabled
                                            ? 'Recommended. Cypher Box sends 5 reminders before any capsule expires (4 days, 2 days, 24 hours, 12 hours, and 6 hours before). Tap a reminder to open Cypher Box and refresh automatically. Without a refresh, expired capsules cannot be recovered.'
                                            : '⚠ Reminders are OFF. You must open Cypher Box yourself and refresh capsules before they expire. Expired capsules cannot be recovered.'}
                                    </Text>
                                </View>

                                {/* Long-term safety reminders */}
                                <Text bold style={{ fontSize: 15, marginTop: 22, marginHorizontal: 10, color: accentColor }}>
                                    Keep these safe
                                </Text>
                                <Text h4 style={[styles.descption, { fontSize: 14, marginTop: 6 }]}>
                                    • Your 12-word seed phrase. Write it down somewhere only you can access.
                                </Text>
                                <Text h4 style={[styles.descption, { fontSize: 14, marginTop: 6 }]}>
                                    • Your encrypted backup file (.cbark). Periodically check on it via Bark Vault → Settings. Both the seed AND the backup file are required to recover funds.
                                </Text>

                                <Text h4 style={[styles.descption, { fontSize: 13, marginTop: 18, color: accentColor }]}>
                                    ⚠ Experimental, use as novel hot wallet software.
                                </Text>
                            </ScrollView>
                        </>
                    ) : (
                        <>
                            <LightningVaultCreate title="Lightning Account" />
                            <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
                                <Text h4 style={[styles.descption, { fontSize: 16, marginTop: 16, fontWeight: 'bold', textAlign: 'center' }]}>Set Withdraw Threshold</Text>
                                <TouchableOpacity
                                    onPress={() => setPickerVisible(true)}
                                    activeOpacity={0.7}
                                    style={{ backgroundColor: colors.gray.dark, borderRadius: 14, padding: 14, marginTop: 8, marginHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#3A3A3A' }}>
                                    <Text bold style={{ fontSize: 16 }}>{formatNumber(selectedThreshold)} sats</Text>
                                    <Text style={{ fontSize: 13, color: '#AAAAAA' }}>Tap to change</Text>
                                </TouchableOpacity>

                                {isStrike && strikeMe?.username ? (
                                    <Text style={{ width: '100%', fontSize: 20, paddingTop: 16, fontWeight: 'bold', textAlign: 'center' }}>{strikeMe.username + '@strike.me'}</Text>
                                ) : null}

                                <Text h4 style={[styles.descption, { fontSize: 14, marginTop: 16 }]}>The interactive bar display helps you visualize your Lightning Account's balance, showing a threshold above which storing bitcoin in an exchange carries increased counter-party risk. This threshold will also determine the size of the withdrawn UTXO coin.</Text>
                                <Text h4 style={[styles.descption, { fontSize: 14, marginTop: 12 }]}>Note: You can deposit money beyond the threshold. It will just give you a reminder message if your balance reaches it. It won't withdraw automatically.</Text>

                                <Modal isVisible={pickerVisible} onBackdropPress={() => setPickerVisible(false)}>
                                    <View style={{ backgroundColor: colors.gray.dark, borderRadius: 20, padding: 16 }}>
                                        <Picker
                                            selectedValue={selectedThreshold}
                                            onValueChange={(itemValue) => {
                                                const next = Number(itemValue);
                                                setSelectedThreshold(next);
                                                persistThreshold(next);
                                            }}
                                            itemStyle={{ color: '#FFFFFF', fontSize: 20 }}
                                        >
                                            {thresholdOptions.map((sats) => (
                                                <Picker.Item
                                                    key={sats}
                                                    label={`${formatNumber(sats)} sats`}
                                                    value={sats}
                                                />
                                            ))}
                                        </Picker>
                                    </View>
                                </Modal>
                            </ScrollView>
                        </>
                    )}
                </View>
            </View>
            <Button text="Home"
                onPress={nextClickHandler}
                style={{...styles.button, ...{ backgroundColor: accentColor, marginTop: vaultTab ? 30 : 0 , marginBottom: 15} }}
                // Ark's accent moved yellow -> white, so white btnText blends
                // into the white Ark button. Use black text for the Ark case;
                // Strike/CoinOS keep white text on their pink button.
                textStyle={isArk ? { ...styles.btnText, color: '#000000' } : styles.btnText}
            />
        </ScreenLayout>
    )
}
