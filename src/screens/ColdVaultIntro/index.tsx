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
            <Text style={styles.title}>Cold Storage</Text>
            <Text h4 style={styles.descption}>For enhanced security, we recommend setting up the Cold Storage Vault where the cryptographic keys that secure it are isolated from internet.
              {'\n\n'}
              The Hot Vault offers moderate security  suitable for medium-term savings, while the Cold Vault is much more robust and is used for long term savings.
              {'\n\n'}
              Your Hot and Cold Vaults can work in conjunction. You can use your Hot Vault as a heating funnel that melts your small capsules and transfer them to your Cold Vault as a single large consolidated cold capsule thereby reducing future fee costs (UTXO consolidation).
            </Text>
            <Image source={Cold1} style={{ marginTop: 25, width: 165, height: 150, resizeMode: 'contain'}} />
          </View>
          <Button text="Explore Cold Storage" onPress={createWallet} loading={isLoading} style={styles.button} textStyle={styles.btnText} />
        </View>
      </ScreenLayout>
    )
}
