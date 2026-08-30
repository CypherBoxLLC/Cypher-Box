import React, {useContext, useReducer, useState, useRef, useEffect} from "react";
import { View, Image, InteractionManager, Switch, TouchableOpacity, Animated, Keyboard, KeyboardEvent, Platform } from "react-native";
import * as bip39 from 'bip39';
import SimpleToast from "react-native-simple-toast";
import styles from "./styles";
import { Button, Input, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import { HDSegwitBech32Wallet } from "../../../class";
import { randomBytes } from "../../../class/rng";
import crypto from 'crypto';
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
    // BIP39 passphrase ("25th word"), strictly opt-in via the toggle so
    // nothing is ever typed (or applied) without a deliberate choice. The
    // passphrase is used exactly as typed (case-sensitive, spaces count),
    // never trimmed, never stored anywhere — it only feeds setPassphrase()
    // at generation time. Confirm-field guards the create-time typo that
    // would otherwise strand funds on a wallet nobody can recover.
    const [usePassphrase, setUsePassphrase] = useState(false);
    const [passphrase, setPassphrase] = useState('');
    const [passphraseConfirm, setPassphraseConfirm] = useState('');
    // Dice entropy (BlueWallet's ProvideEntropy screen). When set, the seed
    // is derived from EXACTLY the first 16 bytes (128 bits) of user rolls —
    // no device-RNG padding, that's the point of the feature. The screen
    // itself hard-blocks Save under 128 bits (minBits param), so a set
    // buffer here is always >= 16 bytes; the length check in createWallet
    // is defense-in-depth.
    const [diceEntropy, setDiceEntropy] = useState<Buffer | null>(null);

    // Keyboard-avoidance for the passphrase fields. They sit low on the
    // screen, so on focus the keyboard covers them. A KeyboardAwareScrollView
    // can't help: the content is flex:1 (exactly viewport height), so there's
    // no scroll overflow to lift into. Instead we translate the whole content
    // up by exactly the overlap between the focused field and the keyboard
    // top, measured live so it's correct on any device and for BOTH fields
    // (confirm sits lower than passphrase and needs a bigger lift).
    const contentLift = useRef(new Animated.Value(0)).current;
    // Last target we animated to. Native-driver animations don't fire JS
    // value listeners, so we track the target ourselves to recover a field's
    // resting position from its (already-lifted) measured position.
    const currentLift = useRef(0);
    const keyboardTop = useRef<number | null>(null);
    const focusedField = useRef<View | null>(null);
    const passWrapRef = useRef<View>(null);
    const confirmWrapRef = useRef<View>(null);

    const animateLift = (to: number, duration: number) => {
        currentLift.current = to;
        Animated.timing(contentLift, {
            toValue: to,
            duration: duration > 0 ? duration : 220,
            useNativeDriver: true,
        }).start();
    };

    // Solve for the ABSOLUTE translateY that puts the focused field ~16pt
    // above the keyboard. measureInWindow returns the field's current
    // (already-lifted) position, so add back the current lift to recover its
    // resting position first, otherwise switching fields double-counts the
    // shift already applied.
    const recomputeLift = (kbTop: number, duration: number) => {
        const target = focusedField.current;
        if (!target) return;
        target.measureInWindow((_x, y, _w, h) => {
            const restingBottom = y + h - currentLift.current;
            const desired = kbTop - 16 - restingBottom; // negative => lift up
            animateLift(desired < 0 ? desired : 0, duration);
        });
    };

    useEffect(() => {
        const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const onShow = (e: KeyboardEvent) => {
            keyboardTop.current = e.endCoordinates.screenY;
            recomputeLift(keyboardTop.current, e.duration ?? 220);
        };
        const onHide = (e: KeyboardEvent) => {
            keyboardTop.current = null;
            animateLift(0, e?.duration ?? 220);
        };
        const s = Keyboard.addListener(showEvt, onShow);
        const hd = Keyboard.addListener(hideEvt, onHide);
        return () => { s.remove(); hd.remove(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // While the keyboard is already up, switching between the two fields must
    // re-solve the lift (keyboardWillShow won't fire a second time).
    const handleFieldFocus = (ref: React.RefObject<View>) => {
        focusedField.current = ref.current;
        if (keyboardTop.current != null) recomputeLift(keyboardTop.current, 180);
    };
    const handleFieldBlur = () => {
        focusedField.current = null;
    };

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

      // Passphrase gate BEFORE the spinner: a validation bounce should not
      // flash the loading state. Empty toggle-on is treated as a mistake
      // (turn it off to create without a passphrase), and both entries must
      // match exactly — there is no recovery from a create-time typo.
      if (usePassphrase) {
        if (!passphrase) {
          SimpleToast.show('Enter a passphrase, or turn the passphrase toggle off', SimpleToast.LONG);
          return;
        }
        if (passphrase !== passphraseConfirm) {
          SimpleToast.show('Passphrases do not match', SimpleToast.LONG);
          return;
        }
      }
      setIsLoading(true);

      // Hand the UI one frame to actually paint the spinner. Without this,
      // React batches setIsLoading(true) with subsequent state updates and
      // the navigation fires before the button ever repaints — user sees
      // the tap, then instantly the transition, which looks like a lag.
      await new Promise(resolve => requestAnimationFrame(resolve));

      const w = new HDSegwitBech32Wallet();
      w.setLabel(label || loc.wallets.details_title);
      if (diceEntropy && diceEntropy.length >= 16) {
        // 12-word seed from the user's dice rolls MIXED WITH THE DEVICE CSPRNG.
        //
        // The mix is not optional. The entropy screen counts BITS PUSHED, not
        // entropy, and `getEntropy(face, 6)` returns the same value for the
        // same face every time. So 64 taps of one button satisfied the 128-bit
        // gate with 128 zero bits, and this line produced, verbatim:
        //
        //   abandon abandon abandon ... abandon about
        //
        // the all-zeros BIP39 test vector, which is swept within seconds of
        // being funded. Tapping one face is also the FASTEST way to fill the
        // counter, so this was reachable by impatience alone.
        //
        // Upstream never had that hole: generateFromEntropy concatenates
        // randomBytes(32 - user.length), so all-zero dice still yielded a seed
        // with 128 real bits. We dropped it by accident, not by design, because
        // that concat forces 32 bytes and would emit a 24-word seed against
        // this app's fixed-12-word recovery flow.
        //
        // Hashing gets both: 16 bytes out, 12 words, two sources. It also
        // preserves the reason for rolling in the first place, since an
        // attacker who fully controls the RNG still cannot predict the result
        // without the dice. Safe if EITHER source is sound, rather than only if
        // the dice are.
        const rngBytes = await randomBytes(16);
        const mixed = crypto
          .createHash('sha256')
          .update(Buffer.concat([diceEntropy.slice(0, 16), rngBytes]))
          .digest()
          .slice(0, 16);
        w.setSecret(bip39.entropyToMnemonic(mixed.toString('hex')));
      } else {
        await w.generate();   // BIP39 mnemonic — ~5ms on device
      }
      // MUST run before getID()/addWallet(): the wallet ID hash includes the
      // passphrase, so setting it later would silently change the vault's
      // identity out from under everything that captured the ID.
      if (usePassphrase && passphrase) {
        w.setPassphrase(passphrase);
      }
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
            <Animated.View style={[styles.container, { transform: [{ translateY: contentLift }] }]}>
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

                    {/* Opt-in BIP39 passphrase. Toggle-gated so the fields
                        (and the feature) only exist for users who ask for
                        them; default flow is untouched. */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18 }}>
                        <Text bold style={{ color: '#FFF', fontSize: 15, flex: 1 }}>
                            Optional Passphrase
                        </Text>
                        <Switch
                            value={usePassphrase}
                            onValueChange={setUsePassphrase}
                            trackColor={{ false: '#3a3a3a', true: colors.green }}
                            thumbColor={'#FFF'}
                        />
                    </View>
                    {usePassphrase && (
                        <View style={{ marginTop: 8 }}>
                            <Text h4 style={{ color: '#CCC', fontSize: 12, lineHeight: 17 }}>
                                Adds a secret "25th word" to your vault: anyone who finds your 12 words alone cannot spend your funds, and the seed copy stored on this phone stays useless without it.
                            </Text>
                            <Text h4 style={{ color: '#FFD54F', fontSize: 12, lineHeight: 17, marginTop: 6 }}>
                                ⚠ Losing the passphrase means irrecoverably losing your Hot Vault funds, even if you possess the 12-word seed phrase. It is case-sensitive and spaces count. You should be able to memorise it, and include it on your seed phrase paper.
                            </Text>
                            <View ref={passWrapRef} collapsable={false}>
                                <Input
                                    onChange={setPassphrase}
                                    value={passphrase}
                                    label="Passphrase"
                                    autoCapitalize="none"
                                    secureTextEntry
                                    textInputStyle={{ color: '#FFF' }}
                                    style={{ marginTop: 10 }}
                                    onFocus={() => handleFieldFocus(passWrapRef)}
                                    onBlur={handleFieldBlur}
                                />
                            </View>
                            <View ref={confirmWrapRef} collapsable={false}>
                                <Input
                                    onChange={setPassphraseConfirm}
                                    value={passphraseConfirm}
                                    label="Confirm passphrase"
                                    autoCapitalize="none"
                                    secureTextEntry
                                    textInputStyle={{ color: '#FFF' }}
                                    style={{ marginTop: 8 }}
                                    onFocus={() => handleFieldFocus(confirmWrapRef)}
                                    onBlur={handleFieldBlur}
                                />
                            </View>
                        </View>
                    )}

                    {/* Opt-in dice entropy via BlueWallet's entropy screen.
                        The 128-bit floor is enforced in the screen itself;
                        the badge shows the armed state and ✗ discards back
                        to the phone's RNG. */}
                    {diceEntropy ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
                            <Text bold style={{ color: colors.green, fontSize: 13, flex: 1 }}>
                                ✓ Dice rolls added, mixed with your phone's randomness
                            </Text>
                            <TouchableOpacity
                                onPress={() => setDiceEntropy(null)}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                accessibilityLabel="Discard dice entropy"
                            >
                                <Text bold style={{ color: '#888', fontSize: 16 }}>✗</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <TouchableOpacity
                            onPress={() =>
                                dispatchNavigate('ProvideEntropy', {
                                    minBits: 128,
                                    limit: 128,
                                    onGenerated: (buf: Buffer) => {
                                        if (buf && buf.length >= 16) setDiceEntropy(buf);
                                    },
                                })
                            }
                            style={{ marginTop: 14 }}
                        >
                            <Text bold style={{ color: colors.green, fontSize: 14 }}>
                                Optional: create your own entropy via your dice rolls 🎲
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>
                <Button text="Generate Private Key" onPress={createWallet} loading={isLoading} style={styles.button} textStyle={styles.btnText} />
            </Animated.View>
        </ScreenLayout>
    )
}
