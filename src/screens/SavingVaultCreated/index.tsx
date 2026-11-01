import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import styles from "./styles";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import { PrivateKeyGenerater, SavingVault } from "@Cypher/components";
import useAuthStore from "@Cypher/stores/authStore";
import { dispatchReset } from "@Cypher/helpers/navigation";

export default function SavingVaultCreated() {
    const [isValidate, setIsValidate] = useState(false);
    const { vaultTab, signingMode } = useAuthStore();

    const nextClickHandler = () => {
        console.log('next click');
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

    return (
        <ScreenLayout disableScroll showToolbar progress={2} color={vaultTab ? [colors.cold.gradient1, colors.cold.gradient2] : [colors.green, colors.green]} isBackButton={false} isClose onBackPress={nextClickHandler}>
            <View style={styles.container}>
                <Text style={[styles.title, vaultTab ? { color: colors.coldGreen } : { }]} center>{vaultTab ? "Cold Storage Vault Created!" : signingMode ? "Seed Created!" : "Savings Vault Created!"}</Text>
                <View style={styles.inner}>
                    {/* a seed-signer's seed isn't a vault, so no vault picture or capsules */}
                    {signingMode && !vaultTab ? null : <SavingVault title={vaultTab ? "Cold Vault" : "Hot Vault"} />}
                    <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
                        {signingMode && !vaultTab ? (
                            <Text h4 style={styles.descption}>Next, on the signer: make a SeedQR backup, give your watch-only wallet this seed's public key and check the first addresses match.
                                {'\n\n'}
                                Then wipe the seed from this phone, and sign by scanning the SeedQR.
                            </Text>
                        ) : vaultTab ?
                            <>
                                <Text h4 style={[styles.descption, { fontSize: 14, marginTop: 15 }]}>Remember to keep your seed phrase safe, it's your responsibility!
                                    This Cold Vault is watch & broadcast only: it shows your balance, gives you addresses to receive on, prepares transactions and broadcasts them once signed. Signing happens on your signing device: a hardware wallet, or an offline phone with Cypher Box as your signing wallet.
                                    {'\n\n'}
                                    ⚠️ DO NOT use any of its addresses without checking them on your signing device!
                                    {'\n\n'}
                                    When Bitcoin Network fees become moderately low, you can select the capsules accumulated in your Hot Vault and transfer them to your Cold Storage Vault using the “Move to Cold Vault” button.
                                </Text>
                            </>
                        :
                            <Text h4 style={styles.descption}>Remember to keep your seed phrase safe, it's your responsibility!
                                {'\n\n'}
                                Each slot represents  a materialized Bitcoin capsule (UTXO). You can tap inside the vault to browse its addresses, capsules, transaction history seedphrase, and so on. {'\n\n'}It's recommended that you deposit small to medium sized capsules, and once network fees are low, you can either move them to your Cold Vault, or 'consolidate' them together to save on future network fees.
                            </Text>
                        }
                    </ScrollView>
                </View>
            </View>
            <Button text="Home"
                onPress={nextClickHandler}
                style={{...styles.button, ...{ backgroundColor: vaultTab ? colors.coldGreen : colors.green, marginTop: vaultTab ? 30 : 0 } }}
                textStyle={styles.btnText}
            />
        </ScreenLayout>
    )
}
