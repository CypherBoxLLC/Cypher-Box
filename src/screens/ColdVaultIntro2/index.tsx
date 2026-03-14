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
            <Text style={styles.title}>Cold Storage</Text>
            <Text h4 style={styles.descption}>To create a Cold Storage Vault you need to purchase a new hardware device. It will also create a new key and give you a backup copy in case you lose access to your device. The backup looks like a series of 12 or 24 words. You need to write them down on a piece of paper or a steal plate to increase the durability and resilience of your backups.
              {'\n\n'}
              This{' '}
              <TouchableOpacity onPress={() => Linking.openURL('https://bitcoinpizza.substack.com/p/these-are-the-only-7-hardware-wallets')}>
                <Text style={[styles.guideText, {textDecorationLine: 'underline', color: colors.coldGreen}]}>
                  guide
                </Text>
              </TouchableOpacity> 
              {' '}can help you choose between out most reccomended wallets in Bitcoin sorted by; security, price, and ease of use, and how to connect them to Cypher Box. It also contains security tips and discount links. 
              {/* {'\n\n'}
              Your Hot and Cold Vaults can work in conjunction. You can use your Hot Vault as a heating funnel that melts your small capsules and transfer them to your Cold Vault as one large cold capsule thereby reducing future fee costs (UTXO consolidation). */}
            </Text>
            <Image source={Cold2} style={{ marginTop: 25, width: 320, height: 190, resizeMode: "contain"}} />
          </View>
          <Button text="Connect Device" onPress={createWallet} loading={isLoading} style={styles.button} textStyle={styles.btnText} />
        </View>
      </ScreenLayout>
    )
}
