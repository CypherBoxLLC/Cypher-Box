import React, { useState } from "react";
import { View, TouchableOpacity, Image } from "react-native";
import { useNavigation } from "@react-navigation/native";
import LinearGradient from "react-native-linear-gradient";
import { Text } from "@Cypher/component-library";
import { StrikeFull, CoinOs } from "@Cypher/assets/images";
import { colors } from "@Cypher/style-guide";
import useAuthStore from "@Cypher/stores/authStore";
import styles from "./styles";

type Service = 'strike' | 'coinos' | null;

export default function SwapScreen() {
    const navigation = useNavigation();
    const { user, strikeMe, isAuth, isStrikeAuth } = useAuthStore();
    const [swapFrom, setSwapFrom] = useState<Service>(null);
    const [sendTo, setSendTo] = useState<Service>(null);

    const handleSelectFrom = (service: Service) => {
        setSwapFrom(service);
        // Auto-select the other as destination
        if (service === 'strike') setSendTo('coinos');
        else if (service === 'coinos') setSendTo('strike');
    };

    const handleSelectTo = (service: Service) => {
        setSendTo(service);
        // Auto-select the other as source
        if (service === 'strike') setSwapFrom('coinos');
        else if (service === 'coinos') setSwapFrom('strike');
    };

    const canProceed = swapFrom && sendTo && swapFrom !== sendTo;

    const handleNext = () => {
        if (!canProceed) return;

        const fromAddress = swapFrom === 'coinos'
            ? `${user}@coinos.io`
            : `${strikeMe?.username}@strike.me`;
        const toAddress = sendTo === 'coinos'
            ? `${user}@coinos.io`
            : `${strikeMe?.username}@strike.me`;

        navigation.navigate('SwapAmount' as never, {
            swapFrom,
            sendTo,
            fromAddress,
            toAddress,
        } as never);
    };

    const renderOption = (
        service: 'strike' | 'coinos',
        selected: boolean,
        onPress: () => void,
        disabled: boolean,
    ) => (
        <TouchableOpacity
            style={[
                styles.optionButton,
                selected && styles.optionButtonSelected,
                disabled && { opacity: 0.4 },
            ]}
            onPress={onPress}
            disabled={disabled}
        >
            <Image
                source={service === 'strike' ? StrikeFull : CoinOs}
                style={[styles.logo, service === 'strike' ? styles.strikeLogo : styles.coinosLogo]}
            />
        </TouchableOpacity>
    );

    return (
        <View style={styles.container}>
            <View style={{ flex: 1 }} />
            <LinearGradient
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                colors={[colors.pink.extralight, colors.pink.default]}
                style={{ height: 3, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}
            />
            <View style={styles.sheet}>
                <Text style={styles.sectionTitle}>SWAP FROM</Text>
                <View style={styles.row}>
                    {renderOption('strike', swapFrom === 'strike', () => handleSelectFrom('strike'), !isStrikeAuth)}
                    {renderOption('coinos', swapFrom === 'coinos', () => handleSelectFrom('coinos'), !isAuth)}
                </View>

                <Text style={styles.sectionTitle}>SEND TO</Text>
                <View style={styles.row}>
                    {renderOption('strike', sendTo === 'strike', () => handleSelectTo('strike'), !isStrikeAuth)}
                    {renderOption('coinos', sendTo === 'coinos', () => handleSelectTo('coinos'), !isAuth)}
                </View>

                <TouchableOpacity
                    style={[styles.nextButton, canProceed && styles.nextButtonActive]}
                    onPress={handleNext}
                    disabled={!canProceed}
                >
                    <Text style={[styles.nextText, !canProceed && { opacity: 0.4 }]}>Next</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}
