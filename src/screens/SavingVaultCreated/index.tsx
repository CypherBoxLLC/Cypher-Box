import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import styles from "./styles";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import { PrivateKeyGenerater, SavingVault } from "@Cypher/components";
import useAuthStore from "@Cypher/stores/authStore";
import { dispatchReset } from "@Cypher/helpers/navigation";
import loc from "../../../loc";

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
                <Text style={[styles.title, vaultTab ? { color: colors.coldGreen } : { }]} center>{vaultTab ? loc.cypherbox.vault.saving_vault_created.cold_title : signingMode ? loc.cypherbox.vault.saving_vault_created.seed_title : loc.cypherbox.vault.saving_vault_created.hot_title}</Text>
                <View style={styles.inner}>
                    {/* a seed-signer's seed isn't a vault, so no vault picture or capsules */}
                    {signingMode && !vaultTab ? null : <SavingVault title={vaultTab ? "Cold Vault" : "Hot Vault"} />}
                    <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
                        {signingMode && !vaultTab ? (
                            <Text h4 style={styles.descption}>{loc.cypherbox.vault.saving_vault_created.seed_next_1}
                                {'\n\n'}
                                {loc.cypherbox.vault.saving_vault_created.seed_next_2}
                            </Text>
                        ) : vaultTab ?
                            <>
                                <Text h4 style={[styles.descption, { fontSize: 14, marginTop: 15 }]}>{loc.cypherbox.vault.saving_vault_created.cold_para_1}
                                    {'\n\n'}
                                    {loc.cypherbox.vault.saving_vault_created.cold_warning}
                                    {'\n\n'}
                                    {loc.cypherbox.vault.saving_vault_created.cold_para_3}
                                </Text>
                            </>
                        :
                            <Text h4 style={styles.descption}>{loc.cypherbox.vault.saving_vault_created.seed_reminder}
                                {'\n\n'}
                                {loc.cypherbox.vault.saving_vault_created.hot_para_2}{'\n\n'}{loc.cypherbox.vault.saving_vault_created.hot_para_3}
                            </Text>
                        }
                    </ScrollView>
                </View>
            </View>
            <Button text={loc.cypherbox.vault.saving_vault_created.home}
                onPress={nextClickHandler}
                style={{...styles.button, ...{ backgroundColor: vaultTab ? colors.coldGreen : colors.green, marginTop: vaultTab ? 30 : 0 } }}
                textStyle={styles.btnText}
            />
        </ScreenLayout>
    )
}
