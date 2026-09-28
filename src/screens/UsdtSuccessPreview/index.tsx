import React, { useState } from "react";
import { TouchableOpacity, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { UsdtSuccess } from "@Cypher/components";
import { Bitcoin, Check, Electricity } from "@Cypher/assets/images";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { ONCHAIN_CONFIRM_NOTE } from "@Cypher/services/tron/swapMessages";
import { colors } from "@Cypher/style-guide";

import styles from "./styles";

/**
 * The three finished states of the USDT feature, side by side, for looking at.
 *
 * Development only. Registered behind __DEV__ and reached by a long press on
 * the USDT card's label, because the real ones cannot be reached on demand: a
 * send needs a Tron transfer the backend does not sponsor yet, and a swap
 * needs a real hundred-dollar conversion to settle. Neither is a reasonable
 * way to check that two rings pulse at the right size.
 *
 * Delete this, its route and the long press once the animations are settled.
 * It is not behind a feature flag on purpose: a flag would be a thing to
 * maintain, and this should not outlive the review it was built for.
 */
type Variant = 'send' | 'lightning' | 'onchain';

const VARIANTS: readonly { key: Variant; label: string }[] = [
    { key: 'send', label: 'USDT sent' },
    { key: 'lightning', label: 'Swap, Lightning' },
    { key: 'onchain', label: 'Swap, on chain' },
];

export default function UsdtSuccessPreview() {
    const [variant, setVariant] = useState<Variant>('send');
    const goHome = () => dispatchReset('HomeScreen');

    const common = { onHome: goHome, homeLabel: 'Done' };

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title="Success preview">
            <View style={styles.switcher}>
                {VARIANTS.map((v) => (
                    <TouchableOpacity
                        key={v.key}
                        onPress={() => setVariant(v.key)}
                        style={[styles.tab, variant === v.key && styles.tabActive]}
                        accessibilityRole="button"
                    >
                        <Text style={variant === v.key ? [styles.tabLabel, styles.tabLabelActive] : styles.tabLabel}>
                            {v.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {variant === 'send' && (
                <UsdtSuccess
                    key="send"
                    title="Sent"
                    amount="250 USDT"
                    glyph={Check}
                    detail={
                        <>
                            <Text style={styles.label}>To</Text>
                            <Text style={styles.value}>TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t</Text>
                        </>
                    }
                    networkLabel="Tron network, TRC-20"
                    {...common}
                />
            )}

            {variant === 'lightning' && (
                <UsdtSuccess
                    key="lightning"
                    title="Swap complete"
                    amount="224,512 sats"
                    glyph={Electricity}
                    detail={
                        <>
                            <Text style={styles.label}>Paid to</Text>
                            <Text style={styles.value}>lnbc1pvjlue...qypqsyqcyq</Text>
                        </>
                    }
                    networkLabel="Lightning Network"
                    {...common}
                />
            )}

            {variant === 'onchain' && (
                <UsdtSuccess
                    key="onchain"
                    title="Swap complete"
                    amount="224,512 sats"
                    glyph={Bitcoin}
                    accent={colors.bitcoin}
                    detail={
                        <>
                            <Text style={styles.label}>Sent to</Text>
                            <Text style={styles.value}>bc1qar0srrr...zzwf5mdq</Text>
                        </>
                    }
                    networkLabel="Bitcoin network"
                    note={ONCHAIN_CONFIRM_NOTE}
                    {...common}
                />
            )}
        </ScreenLayout>
    );
}
