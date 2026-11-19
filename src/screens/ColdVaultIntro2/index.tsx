import React, {useContext, useReducer, useState} from "react";
import { Image, Linking, TouchableOpacity, View } from "react-native";
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
import { Cold1, Cold2 } from "@Cypher/assets/images";

export default function ColdVaultIntro2() {
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
      dispatchNavigate("ConnectColdStorage")
    };
  
    return (
      <ScreenLayout disableScroll showToolbar progress={0} color={[colors.cold.gradient1, colors.cold.gradient2]}>
      {/* <ScreenLayout showToolbar color={[colors.green, colors.green]}> */}
        <View style={styles.container}>
          <View style={styles.innerView}>
            <Text style={styles.title}>{loc.cypherbox.vault.cold_vault_intro2.title}</Text>
            <Text h4 style={styles.descption}>{loc.cypherbox.vault.cold_vault_intro2.para_1}
              {'\n\n'}
              {loc.formatString(loc.cypherbox.vault.cold_vault_intro2.guide_sentence, { guide: (
              <TouchableOpacity onPress={() => Linking.openURL('https://bitcoinpizza.substack.com/p/these-are-the-only-7-hardware-wallets')}>
                <Text style={[styles.guideText, {textDecorationLine: 'underline', color: colors.coldGreen}]}>
                  {loc.cypherbox.vault.cold_vault_intro2.guide}
                </Text>
              </TouchableOpacity> 
              ) })} 
              {/* {'\n\n'}
              Your Hot and Cold Vaults can work in conjunction. You can use your Hot Vault as a heating funnel that melts your small capsules and transfer them to your Cold Vault as one large cold capsule thereby reducing future fee costs (UTXO consolidation). */}
            </Text>
            <Image source={Cold2} style={{ marginTop: 25, width: 320, height: 190, resizeMode: "contain"}} />
          </View>
          <Button text={loc.cypherbox.vault.cold_vault_intro2.connect_device} onPress={createWallet} loading={isLoading} style={styles.button} textStyle={styles.btnText} />
        </View>
      </ScreenLayout>
    )
}
