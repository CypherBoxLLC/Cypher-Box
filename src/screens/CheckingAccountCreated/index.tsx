import React, { useState } from "react";
import { ScrollView, View, Text as RNText, TouchableOpacity } from "react-native";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import { SavingVault } from "@Cypher/components";
import useAuthStore from "@Cypher/stores/authStore";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { formatNumber } from "@Cypher/helpers/coinosHelper";
import { Picker } from "@react-native-picker/picker";
import Modal from "react-native-modal";
import { useRoute } from "@react-navigation/native";
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
    } = useAuthStore();

    const isStrike = accountType === 'strike';
    const isArk = accountType === 'ark';

    // Pick the right default threshold + title color per provider.
    const accentColor = isArk
        ? colors.ark.light
        : colors.pink.light;
    const titleText = isArk
        ? 'Ark Vault Created!'
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
                    <LightningVaultCreate title={isArk ? "Ark Vault" : "Lightning Account"} />
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

                        {isArk ? (
                            <>
                                <Text h4 style={[styles.descption, { fontSize: 14, marginTop: 16 }]}>Your Ark wallet is live. Ark is a non-custodial Bitcoin L2 — faster and cheaper than opening Lightning channels, but the server operator (Second.tech) coordinates rounds.</Text>
                                <Text h4 style={[styles.descption, { fontSize: 14, marginTop: 12, color: accentColor }]}>⚠ Experimental: wallet recovery from seed is not yet supported. Use small amounts only.</Text>
                                <Text h4 style={[styles.descption, { fontSize: 14, marginTop: 12 }]}>The withdraw threshold tells Cypher Box when to suggest moving funds on-chain (exit) to your hot or cold vault.</Text>
                            </>
                        ) : (
                            <>
                                <Text h4 style={[styles.descption, { fontSize: 14, marginTop: 16 }]}>The interactive bar display helps you visualize your Lightning Account's balance, showing a threshold above which storing bitcoin in an exchange carries increased counter-party risk. This threshold will also determine the size of the withdrawn UTXO coin.</Text>
                                <Text h4 style={[styles.descption, { fontSize: 14, marginTop: 12 }]}>Note: You can deposit money beyond the threshold. It will just give you a reminder message if your balance reaches it. It won't withdraw automatically.</Text>
                            </>
                        )}

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
                </View>
            </View>
            <Button text="Home"
                onPress={nextClickHandler}
                style={{...styles.button, ...{ backgroundColor: accentColor, marginTop: vaultTab ? 30 : 0 , marginBottom: 15} }}
                textStyle={styles.btnText}
            />
        </ScreenLayout>
    )
}
