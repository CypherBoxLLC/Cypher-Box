import React, {useContext, useReducer, useState} from "react";
import { View, Image, InteractionManager } from "react-native";
import styles from "./styles";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import { HDSegwitBech32Wallet } from "../../../class";
import loc from '../../../loc';
import { initialState, walletReducer } from "../../../screen/wallets/add";
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import triggerHapticFeedback, {
    HapticFeedbackTypes,
  } from "../../../blue_modules/hapticFeedback";
import AsyncStorage from "@react-native-async-storage/async-storage";
import useAuthStore from "@Cypher/stores/authStore";

export default function SavingVaultIntro() {
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

    /**
     * Create a fresh HDSegwitBech32 hot vault — and get out of the user's
     * way as fast as possible.
     *
     * The old flow awaited `saveToDisk()` before navigating. That is a
     * surprisingly heavy call: BlueApp's `saveToDisk` loops every wallet,
     * offloads each one's entire transaction history into Realm, and — if
     * the user has an encryption password set — does a bucket-search +
     * scrypt re-encrypt over the full encrypted blob before writing it
     * to AsyncStorage AND backing the same data into a Realm key-value
     * store. For a brand-new wallet with zero tx history that's all
     * pure overhead; the only thing the next screen actually needs is
     * the in-memory wallet (already available via `addWallet`) so it
     * can render the 12 words.
     *
     * New order of operations:
     *
     *   1. setIsLoading(true) + yield a frame → spinner actually paints
     *   2. generate() + addWallet()          → in-memory, ~5ms total
     *   3. setWalletID()                      → zustand (AsyncStorage async)
     *   4. navigate (button still spinning)   → no black flash between screens
     *   5. fire-and-forget saveToDisk         → runs in background
     *
     * Why we don't clear isLoading before navigation:
     *   Calling setIsLoading(false) right before dispatchNavigate would
     *   make the button "un-spin" for one frame right as the transition
     *   starts — that flash reads as a jank/black-flicker to the user.
     *   Leaving the button in its loading state until the screen
     *   unmounts gives the eye a continuous "we're working on it" cue
     *   through the entire transition. The component is unmounted by
     *   React Navigation anyway so there's no leak.
     *
     * Safety of fire-and-forget:
     *   - `savingInProgress` in BlueApp serializes concurrent saves, so a
     *     second save kicked off later (e.g. from SavingVault's backup)
     *     will wait rather than clobber this one.
     *   - If the app is killed mid-save, the user still has their paper
     *     backup (they're literally looking at it) and — if they opted
     *     in — the Keychain copy written by SavingVault's Continue tap.
     *     Both are authoritative; the disk wallet can be re-imported.
     *   - On save failure we log; we deliberately don't toast the user
     *     mid-"write down your seed" — panicking them would be worse
     *     than the actual risk (in-memory wallet survives this session).
     */
    const createWallet = async () => {
      if (isLoading) return; // guard against double-tap racing the transition
      setIsLoading(true);

      // Hand the UI one frame to actually paint the spinner. Without this,
      // React batches setIsLoading(true) with subsequent state updates and
      // the navigation fires before the button ever repaints — user sees
      // the tap, then instantly the transition, which looks like a lag.
      await new Promise(resolve => requestAnimationFrame(resolve));

      const w = new HDSegwitBech32Wallet();
      w.setLabel(label || loc.wallets.details_title);
      await w.generate();   // BIP39 mnemonic — ~5ms on device
      addWallet(w);          // in-memory push; next screen finds wallet by ID
      const id = w.getID();  // sha256 over type+secret+path — trivially fast
      setWalletID(id);
      A(A.ENUM.CREATED_WALLET);
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);

      // Navigate with the button still visibly spinning — no setIsLoading(false)
      // here. This screen unmounts as the transition completes; leaving the
      // spinner on means the user never sees a "nothing is happening" frame.
      dispatchNavigate('SavingVault', { walletID: id });

      // Background persist, deferred until after the navigation transition
      // has kicked off so JS-thread work doesn't fight the animation.
      // The paper + optional Keychain backups are the real recovery paths,
      // so errors are logged but not surfaced mid-"write down your seed".
      InteractionManager.runAfterInteractions(() => {
        saveToDisk().catch((e: unknown) => {
          console.warn('[HotVault] background saveToDisk failed:', e);
        });
      });
    };
  
    return (
        <ScreenLayout showToolbar progress={0} color={[colors.green, colors.green]}>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <Text style={styles.title}>Hot Savings Vault</Text>
                    <Text h4 style={styles.descption}>Hot Vault, commonly known as a ‘hot wallet’, allows you to become the sole owner of your bitcoin, as the saying goes: Not your keys, not your coins. Money stored in this vault will be secured by the main Bitcoin network, not by a third party custodian.
                        {'\n\n'}
                        To create a Hot Vault, you first need to generate your keys: your phone will  create the private key, encrypt it, and store it in its memory. It will also create a backup copy (12 words), just in case you lose access to your phone.
                        
                        {'\n\n'}
                        Caution: while it offers a much more secure storage environment than the Lightning Account, the keys to your Hot Vault are generated and stored on an internet-connect device. As your balance and technical skills increase, you should think about investing in an offline hardware signing device for enhanced security.
                    </Text>

                    <Image
                      source={require('@Cypher/assets/images/fireShield.png')}
                      style={{height: 80}}
                      resizeMode="contain"
                    />
                </View>
                <Button text="Generate Private Key" onPress={createWallet} loading={isLoading} style={styles.button} textStyle={styles.btnText} />
            </View>
        </ScreenLayout>
    )
}
