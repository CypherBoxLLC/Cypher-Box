import React, {useContext, useReducer, useState} from "react";
import { Image, View } from "react-native";
import styles from "./styles";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import { HDSegwitBech32Wallet, HDSegwitP2SHWallet } from "../../../class";
import loc from '../../../loc';
import { initialState, walletReducer } from "../../../screen/wallets/add";
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import triggerHapticFeedback, {
    HapticFeedbackTypes,
  } from "../../../blue_modules/hapticFeedback";
import useAuthStore from "@Cypher/stores/authStore";
import { Cold1 } from "@Cypher/assets/images";

export default function ColdVaultIntro() {
    const [isLoading, setIsLoading] = useState(false)

    const nextClickHandler = () => {
        console.log('next click');
        dispatchNavigate('SavingVault');
    }

    const [state, dispatch] = useReducer(walletReducer, initialState);
    const label = state.label;
    const { addWallet, saveToDisk, isAdvancedModeEnabled, wallets } = useContext(BlueStorageContext);
    const A = require('../../../blue_modules/analytics');
    const { setWalletID } = useAuthStore();

    const createWallet = async () => {
      dispatchNavigate("ColdVaultIntro2")
    };
  
    return (
      <ScreenLayout showToolbar color={[colors.green, colors.green]}>
        <View style={styles.container}>
          <View style={styles.innerView}>
            <Text style={styles.title}>{loc.cypherbox.vault.cold_vault_intro.title}</Text>
            <Text h4 style={styles.descption}>{loc.cypherbox.vault.cold_vault_intro.para_1}
              {'\n\n'}
              {loc.cypherbox.vault.cold_vault_intro.para_2}
              {'\n\n'}
              {loc.cypherbox.vault.cold_vault_intro.para_3}
            </Text>
            <Image source={Cold1} style={{ marginTop: 25, width: 165, height: 150, resizeMode: 'contain'}} />
          </View>
          <Button text={loc.cypherbox.vault.cold_vault_intro.explore_button} onPress={createWallet} loading={isLoading} style={styles.button} textStyle={styles.btnText} />
        </View>
      </ScreenLayout>
    )
}
