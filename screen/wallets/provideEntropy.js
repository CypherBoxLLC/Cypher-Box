import React, { useEffect, useReducer, useState } from 'react';
import PropTypes from 'prop-types';
import BN from 'bignumber.js';
import { Alert, I18nManager, View, ScrollView, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { Icon } from 'react-native-elements';
import { useNavigation, useRoute } from '@react-navigation/native';

import crypto from 'crypto';
import { randomBytes } from '../../class/rng';
import { assertNativeRngHealthy } from '../../class/rngHealth';
import safetyErrorText from '../../src/helpers/safetyErrorText';
import { ROLLS_RECOMMENDED, rollsOnlyEntropy, rollsOnlyRefusal } from '../../src/helpers/diceSeed';
import loc from '../../loc';
import { useTheme } from '../../components/themes';
import { FContainer, FButton } from '../../components/FloatButtons';
import navigationStyle from '../../components/navigationStyle';
import SafeArea from '../../components/SafeArea';
import useProtectSecret from '../../src/custom-hooks/useProtectSecret';

const ENTROPY_LIMIT = 256;

// Every navigator that shows this screen gives it a header, and that header already clears the status bar. On iOS the
// SafeAreaView pads with the app's top inset wherever it sits, so a 'top' edge here repeated the status-bar gap under
// the header (an empty 48 pt band on an iPhone XR). The header keeps the top; the other edges stay with the SafeAreaView.
const SAFE_EDGES = ['left', 'right', 'bottom'];

const shiftLeft = (value, places) => value.multipliedBy(2 ** places);
const shiftRight = (value, places) => value.div(2 ** places).dp(0, BN.ROUND_DOWN);

const initialState = { entropy: BN(0), bits: 0, items: [] };
export const eReducer = (state = initialState, action) => {
  switch (action.type) {
    case 'push': {
      let { value, bits } = action;
      if (value >= 2 ** bits) {
        throw new TypeError("Can't push value exceeding size in bits");
      }
      if (action.limit) {
        // A caller target (the vault flow passes 128). Stop by REFUSING the
        // roll rather than truncating it, which is what keeps the result
        // reproducible in an external tool.
        //
        // Direction is why. Our convertToBuffer keeps trailing bytes, and Ian
        // Coleman keeps trailing bits (index.js: start = bits.length -
        // bitsToUse). Truncating the last roll to land on exactly 128 would
        // instead keep the LEADING 128 bits and the two would disagree by a
        // bit shift. Letting the roll complete and refusing the next keeps the
        // total in [target, target + 1], where his 32-bit rounding and our
        // 8-bit rounding select the same trailing 128 bits. Without any stop
        // the total can pass 135, where he keeps 16 bytes and we keep 17.
        if (state.bits >= action.limit) return state;
      } else {
        // No target: upstream's behaviour at the hard 256-bit ceiling, which
        // truncates the final push so the total lands exactly on the limit.
        // Preserved for the legacy add-wallet caller, which passes no limit.
        if (state.bits === ENTROPY_LIMIT) return state;
        if (state.bits + bits > ENTROPY_LIMIT) {
          value = shiftRight(BN(value), bits + state.bits - ENTROPY_LIMIT);
          bits = ENTROPY_LIMIT - state.bits;
        }
      }
      const entropy = shiftLeft(state.entropy, bits).plus(value);
      const items = [...state.items, bits];
      return { entropy, bits: state.bits + bits, items };
    }
    case 'pop': {
      if (state.bits === 0) return state;
      const bits = state.items.pop();
      const entropy = shiftRight(state.entropy, bits);
      return { entropy, bits: state.bits - bits, items: [...state.items] };
    }
    default:
      return state;
  }
};

export const entropyToHex = ({ entropy, bits }) => {
  if (bits === 0) return '0x';
  const hex = entropy.toString(16);
  const hexSize = Math.floor((bits - 1) / 4) + 1;
  return '0x' + '0'.repeat(hexSize - hex.length) + hex;
};

export const getEntropy = (number, base) => {
  if (base === 1) return null;
  let maxPow = 1;
  while (2 ** (maxPow + 1) <= base) {
    maxPow += 1;
  }

  let bits = maxPow;
  let summ = 0;
  while (bits >= 1) {
    const block = 2 ** bits;
    if (summ + block > base) {
      bits -= 1;
      continue;
    }
    if (number < summ + block) {
      return { value: number - summ, bits };
    }
    summ += block;
    bits -= 1;
  }
  return null;
};

/**
 * Combine the user's collected entropy with device CSPRNG bytes.
 *
 * Hashing rather than concatenating, because concatenation would leave the
 * user's bytes verbatim in the key and upstream's version pads to 32 bytes,
 * emitting a 24-word seed against this app's fixed 12-word recovery flow.
 * SHA-256 is a vetted conditioning function for exactly this (NIST SP 800-90B).
 *
 * The result is unpredictable if EITHER input is sound, which is the whole
 * point: bad dice are carried by the RNG, and an attacker who controls the RNG
 * still cannot predict the key without the dice.
 */
export const mixEntropy = (userBytes, rngBytes) =>
  crypto
    .createHash('sha256')
    .update(Buffer.concat([userBytes, rngBytes]))
    .digest()
    .slice(0, 16);

/**
 * The screen's state after these rolls, for the seed-signer's coming back to its dice: the bits and counted faces as if
 * each roll were tapped again (stopping at the bit target, as tapping does), and every roll.
 */
export const replayRolls = (previous, limit) => {
  let entropy = initialState;
  const faces = [];
  for (const r of previous || []) {
    const v = getEntropy(r.sides === 2 ? r.face - 1 : r.face % r.sides, r.sides);
    if (!v || entropy.bits >= limit) continue;
    faces.push(`${v.value}:${v.bits}`);
    entropy = eReducer(entropy, { type: 'push', value: v.value, bits: v.bits, limit });
  }
  return { entropy, faces, rolls: [...(previous || [])] };
};

// cut entropy to bytes, convert to Buffer
export const convertToBuffer = ({ entropy, bits }) => {
  if (bits < 8) return Buffer.from([]);
  const bytes = Math.floor(bits / 8);

  // convert to byte array
  let arr = [];
  const ent = entropy.toString(16).split('').reverse();
  ent.forEach((v, index) => {
    if (index % 2 === 1) {
      arr[0] = v + arr[0];
    } else {
      arr.unshift(v);
    }
  });
  arr = arr.map(i => parseInt(i, 16));

  if (arr.length > bytes) {
    arr.shift();
  } else if (arr.length < bytes) {
    const zeros = [...Array(bytes - arr.length)].map(() => 0);
    arr = [...zeros, ...arr];
  }
  return Buffer.from(arr);
};

// Six-sided dice only. The coin and the 20-sided die are gone from this screen until each has been tested through on
// its own; the encoding below still knows them (replayRolls, getEntropy) for any rolls kept from before.
const SIDES = 6;

const Dice = ({ push }) => {
  const { width } = useWindowDimensions();
  // three dice to a row, two rows
  const diceWidth = Math.min(width / 4, 100);
  const diceIcon = i => {
    switch (i) {
      case 1:
        return 'dice-one';
      case 2:
        return 'dice-two';
      case 3:
        return 'dice-three';
      case 4:
        return 'dice-four';
      case 5:
        return 'dice-five';
      default:
        return 'dice-six';
    }
  };

  return (
    <View style={styles.diceContainer}>
      {/*
        Face -> digit uses (i + 1) % sides, so the HIGHEST face is digit zero:
        a d6 showing 6 is 0 in base 6. That is Ian Coleman's convention in
        src/js/entropy.js, which rewrites die 6 to base-6 digit 0 and leaves
        1 to 5 alone.

        The bit scheme was already his. He maps four digits to two bits and two
        to one, averaging (4*2 + 2*1)/6 bits per roll, which is the exact table
        and the exact figure `getEntropy` produces. Only the labelling differed:
        upstream used the 0-based index, making our die 1 his die 6. Rotating by
        one makes the collected entropy byte-identical to his tool, so a user
        can retype their rolls there and confirm this screen is honest.

        No compatibility break. Seeds are stored as words, and the CSPRNG mix
        already means no existing seed is reproducible from its rolls, so
        nothing depends on the old labelling.
      */}
      {[...Array(SIDES)].map((_, i) => (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={String(i + 1)}
          key={i}
          onPress={() => push(getEntropy((i + 1) % SIDES, SIDES), { sides: SIDES, face: i + 1 })}
        >
          <View style={[styles.diceRoot, { width: diceWidth }]}>
            <Icon style={styles.diceIcon} name={diceIcon(i + 1)} size={70} color="grey" type="font-awesome-5" />
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
};

Dice.propTypes = {
  push: PropTypes.func.isRequired,
};

// Undo and Continue, right under the dice and the text, not floating at the bottom of the screen.
const Buttons = ({ pop, save, colors }) => {
  const button = [styles.actionButton, { backgroundColor: colors.buttonBackgroundColor }];
  const label = [styles.actionText, { color: colors.buttonAlternativeTextColor }];
  return (
    <View style={styles.actionRow}>
      <TouchableOpacity accessibilityRole="button" onPress={pop} style={button}>
        <View style={styles.undoIcon}>
          <Icon name="undo" size={16} type="font-awesome" color={colors.buttonAlternativeTextColor} />
        </View>
        <Text style={label}>{loc.entropy.undo}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" onPress={save} style={button}>
        <Text style={label}>{loc._.continue}</Text>
        <Icon
          name={I18nManager.isRTL ? 'arrow-left' : 'arrow-right'}
          size={16}
          type="font-awesome"
          color={colors.buttonAlternativeTextColor}
        />
      </TouchableOpacity>
    </View>
  );
};

Buttons.propTypes = {
  pop: PropTypes.func.isRequired,
  save: PropTypes.func.isRequired,
  colors: PropTypes.shape.isRequired,
};

const Entropy = () => {
  // The rolls, the entropy hex and the check screen's values are the key
  // itself, so keep them out of screenshots and the app-switcher preview.
  useProtectSecret();
  // Optional params (all default to legacy BlueWallet behaviour when absent):
  //   minBits     — Save refuses below this many collected bits. BlueWallet
  //                 happily saves ANY amount (even 0 bytes, silently padded
  //                 with device RNG downstream) — for the Cypher Box hot-vault
  //                 flow that low-entropy path is a footgun, so the caller
  //                 passes 128 and Save hard-blocks under it.
  //   limit       — display target for the counter ("N of {limit} bits").
  //   instruction — one-line how-to rendered under the dice grid.
  //   mixWithRng  — hash the collected entropy with 16 CSPRNG bytes and hand
  //                 back the RESULT, showing the user every input so the
  //                 derivation can be checked by hand. Off by default, so the
  //                 legacy add-wallet caller still receives raw entropy for
  //                 generateFromEntropy (which does its own concatenation).
  //   rollsOnlyFrom — the seed-signer's: from this many rolls of a six-sided
  //                 die that look like real rolls, the seed is the rolls'
  //                 own hash (src/helpers/diceSeed), so EntropyLab, SeedSigner
  //                 and COLDCARD make the same words from the same rolls.
  //                 Otherwise (fewer rolls, or rolls that look made up) it's
  //                 the mix above, as before. minBits doesn't
  //                 apply then: few rolls are carried by the phone's randomness.
  //                 onGenerated gets a second argument saying which it was,
  //                 with the rolls, and the screen goes straight back: the
  //                 caller's backup screen shows the cross-check.
  //   initialRolls — the seed-signer's rolls from before, when it comes back
  //                 to the dice to add or take back rolls.
  const { onGenerated, minBits, limit, instruction, mixWithRng, rollsOnlyFrom, initialRolls } = useRoute().params;
  const [start] = useState(() => replayRolls(initialRolls, limit || ENTROPY_LIMIT));
  const [entropy, dispatch] = useReducer(eReducer, start.entropy);
  const navigation = useNavigation();
  // the seed-signer's dice are rolls, not "Entropy"
  useEffect(() => {
    if (rollsOnlyFrom) navigation.setOptions?.({ headerTitle: loc.cypherbox.seed_signer.dice.title });
  }, [navigation, rollsOnlyFrom]);
  const [show, setShow] = useState(false);
  const { colors } = useTheme();
  const stylesHook = StyleSheet.create({
    entropyText: {
      color: colors.foregroundColor,
    },
  });

  // The raw face sequence, kept alongside the bit counter. The counter cannot
  // see degeneracy: `getEntropy(face, 6)` maps a face to the same value every
  // time, so N taps of one button push N*2 zero bits and the counter reports
  // them as full entropy.
  const [faces, setFaces] = useState(start.faces);
  // Every counted roll as it came up, die and face: what a seed from the rolls
  // alone is made of, and what the user types into EntropyLab to check it.
  const [rolls, setRolls] = useState(start.rolls);
  // Set once the mix has run; holds every input to the derivation so the user
  // can reproduce it. Never persisted and never leaves this screen.
  const [verify, setVerify] = useState(null);
  const [showVerify, setShowVerify] = useState(false);
  const push = (v, roll) => {
    if (!v) return;
    // The seed-signer's rolls all count towards a seed from the rolls alone,
    // past the bit target too: EntropyLab hashes every roll it is given.
    if (rollsOnlyFrom && roll) setRolls(r => [...r, roll]);
    // Once the target is reached the reducer refuses the roll, so stop
    // recording it too. Keeps `faces` meaning "rolls that counted", which is
    // what the degeneracy check below is judging.
    if (entropy.bits >= (limit || ENTROPY_LIMIT)) return;
    setFaces(f => [...f, `${v.value}:${v.bits}`]);
    dispatch({ type: 'push', value: v.value, bits: v.bits, limit: limit || ENTROPY_LIMIT });
  };
  const pop = () => {
    // a roll past the bit target is only in `rolls`
    if (rollsOnlyFrom && rolls.length > faces.length) {
      setRolls(r => r.slice(0, -1));
      return;
    }
    if (rollsOnlyFrom) setRolls(r => r.slice(0, -1));
    setFaces(f => f.slice(0, -1));
    dispatch({ type: 'pop' });
  };
  const save = async () => {
    // the signer's dice are optional: saving before any roll adds nothing
    if (rollsOnlyFrom && !rolls.length) {
      navigation.pop();
      return;
    }
    if (minBits && !rollsOnlyFrom && entropy.bits < minBits) {
      Alert.alert(
        loc.entropy.title,
        String(loc.formatString(loc.cypherbox.safety_checks.dice_not_enough, { bits: entropy.bits, min: minBits })),
      );
      return;
    }
    // Refuse input that plainly carries no entropy, however many bits it
    // pushed. This is a usability guard, not the security boundary: the seed
    // is hashed with the device CSPRNG regardless, so a degenerate sequence is
    // no longer dangerous. It is here so someone who believes they contributed
    // 128 bits actually did, rather than being quietly carried by the RNG.
    //
    // Deliberately crude. It catches the cases a real die cannot produce and a
    // bored finger easily can, and does not try to judge randomness beyond
    // that: rejecting a legitimate but unlucky roll would be worse than
    // accepting a lazy one that the mix already protects.
    const distinct = new Set(faces).size;
    if (faces.length >= 8 && distinct <= 2) {
      Alert.alert(
        loc.entropy.title,
        distinct <= 1 ? loc.cypherbox.safety_checks.dice_same_number : loc.cypherbox.safety_checks.dice_two_numbers,
      );
      return;
    }
    const buf = convertToBuffer(entropy);
    // The seed-signer's: enough real-looking rolls of a six-sided die make the
    // seed by themselves, checkable in EntropyLab and Ian Coleman's tool;
    // anything else is mixed with the phone's randomness below. Either way it
    // goes straight back, and Create a Seed's backup screen has the cross-check.
    let refusal = null;
    if (rollsOnlyFrom) {
      refusal = rollsOnlyRefusal(rolls, rollsOnlyFrom);
      if (!refusal) {
        navigation.pop();
        onGenerated(rollsOnlyEntropy(rolls.map(r => r.face)), { source: 'rolls', count: rolls.length, rolls });
        return;
      }
    }
    if (!mixWithRng) {
      navigation.pop();
      onGenerated(buf);
      return;
    }
    // Show the derivation before committing to it. The user rolled dice
    // precisely because they wanted to see where their key came from, so
    // handing back a key they cannot check defeats the exercise.
    const userBytes = buf.slice(0, 16);
    // The mix is safe if either source is sound only while the phone's randomness is checked: with it returning
    // zeros, the seed would be the hash of the taps alone, and patterned taps get past the guard above.
    try {
      await assertNativeRngHealthy();
    } catch (e) {
      Alert.alert(loc.cypherbox.safety_checks.create_failed_title, safetyErrorText(e, loc.cypherbox.safety_checks.rng_unavailable));
      return;
    }
    const rng = await randomBytes(16);
    const final = mixEntropy(userBytes, rng);
    if (rollsOnlyFrom) {
      navigation.pop();
      onGenerated(final, { source: 'mix', reason: refusal, rolls });
      return;
    }
    setVerify({ user: userBytes, rng, final });
  };

  const acceptVerified = () => {
    navigation.pop();
    onGenerated(verify.final);
  };

  const hex = entropyToHex(entropy);
  const limitDisplay = limit || ENTROPY_LIMIT;

  // The counter below measures BITS PUSHED, which is exactly the thing that
  // misled people here before: it cannot tell a real roll from a repeated tap.
  // So the screen has to say in words what the number cannot.
  //
  // 10/6 bits per roll is the real yield of `getEntropy` for a d6, not
  // log2(6): it maps faces 1-4 to 2 bits and faces 5-6 to 1 bit. The encoding
  // is lossy but sound: the bits it does emit are uniform, so 128 of them from
  // real rolls really are 128 bits. That is about 77 rolls, the same count the
  // top recommends (ROLLS_RECOMMENDED).
  const typicalThrows = Math.ceil(limitDisplay / (10 / 6));
  const bits = Math.min(entropy.bits, limitDisplay);
  // what the top shows: the rolls against the recommended count, since "3 of 128 bits" read like three rolls. The
  // seed-signer counts every roll it keeps; the Hot Vault, the rolls the bit counter took.
  const throws = String(
    loc.formatString(loc.cypherbox.seed_signer.dice.count, {
      count: rollsOnlyFrom ? rolls.filter(r => r.sides === SIDES).length : faces.length,
      recommended: ROLLS_RECOMMENDED,
    }),
  );

  if (verify) {
    const row = (label, buf) => (
      <View style={styles.verifyRow}>
        <Text style={[styles.verifyLabel, stylesHook.entropyText]}>{label}</Text>
        <Text style={[styles.verifyHex, stylesHook.entropyText]}>{showVerify ? buf.toString('hex') : '.'.repeat(32)}</Text>
      </View>
    );
    return (
      <SafeArea edges={SAFE_EDGES}>
        <ScrollView contentContainerStyle={styles.verifyScroll}>
          <Text style={[styles.verifyTitle, stylesHook.entropyText]}>Check where this key came from</Text>
          <Text style={[styles.guidanceText, stylesHook.entropyText]}>
            None of this is saved or sent anywhere. It is shown once, so you can check for yourself that this screen really used your rolls.
          </Text>

          <TouchableOpacity accessibilityRole="button" onPress={() => setShowVerify(!showVerify)} style={styles.verifyReveal}>
            <Text bold style={styles.verifyRevealText}>
              {showVerify ? 'Hide values' : 'Tap to reveal'}
            </Text>
          </TouchableOpacity>

          {row('Your rolls', verify.user)}
          {row("Your phone's randomness", verify.rng)}
          {row('The result, which becomes your key', verify.final)}

          {/* Right under the values, so it is never below the fold or behind the Continue button, whatever the screen size. */}
          <Text style={styles.verifyWarning}>
            These values are your key. Anyone who copies them can spend your money. Do not photograph them.
          </Text>
          <Text style={styles.verifyWarning}>
            Do this with practice rolls, not your real ones. Typing your real rolls into a website gives away one of the two things
            protecting this key, and it would then rest on your phone's secure entropy generator only. The safe way is a practice run: roll
            a few times, check those, then throw them away and start again for real. If you do want to check your real rolls, use a
            downloaded copy of Ian Coleman's BIP39 tool or EntropyLab, checked against its published SHA-256, on a computer you disconnect
            from the internet first. If this phone is a signing phone that stays offline for good, you can open the file in its browser in
            Airplane mode instead. Never on a website.
          </Text>
          {/*
            The rolls are checked by comparing words. Ian Coleman's page shows no hex for dice, only binary and the words, and
            any Mnemonic Length other than "Use Raw Entropy" hashes the input first, so those words would not match. EntropyLab
            starts at 24 words, which needs 64 hex digits and refuses the 32 shown here.
          */}
          <Text style={[styles.verifyHow, stylesHook.entropyText]}>
            To check your rolls: in Ian Coleman's BIP39 tool, tick "Show entropy details", choose Dice and type the same rolls in the same
            order. Leave Mnemonic Length on "Use Raw Entropy" and note the 12 words. Then choose Hex and enter "Your rolls" from above. If
            the 12 words stay the same, this screen read your dice correctly. Use Ian Coleman's tool for this step: EntropyLab hashes dice
            rolls, so its words will differ.
          </Text>
          <Text style={[styles.verifyHow, stylesHook.entropyText]}>
            To check the result: it is a SHA-256 hash of your rolls followed by your phone's randomness, shortened to 16 bytes. Enter it as
            hex entropy in either tool to see the 12 words you are about to get. In EntropyLab, set Seed phrase length to 12 words first; in
            Ian Coleman's tool, keep "Use Raw Entropy". EntropyLab then also shows the master fingerprint and the Native SegWit addresses,
            which should match what Cypher Box shows once the vault is made.
          </Text>
        </ScrollView>
        <FContainer>
          <FButton onPress={acceptVerified} text="Continue" />
        </FContainer>
      </SafeArea>
    );
  }

  // One text style for everything under the dice, and the whole block (count, dice, text, bits, buttons) kept
  // together in the middle of the screen. It scrolls on a small screen.
  const line = [styles.guidanceText, stylesHook.entropyText];
  return (
    <SafeArea edges={SAFE_EDGES}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={[styles.countText, stylesHook.entropyText]}>{throws}</Text>

        <Dice push={push} />

        <View style={styles.guidance}>
          {instruction ? <Text style={line}>{instruction}</Text> : null}
          {/* The same lines for the Hot Vault and the seed-signer, in the app's language, apart from what really differs:
              the Hot Vault always mixes in the phone's randomness, while the seed-signer's rolls make the seed alone from
              rollsOnlyFrom on, so nothing else covers for made-up ones, and are written down for the cross-check. */}
          <Text style={line}>
            {String(loc.formatString(loc.cypherbox.seed_signer.dice.how, { count: rollsOnlyFrom ? ROLLS_RECOMMENDED : typicalThrows }))}
          </Text>
          {rollsOnlyFrom ? (
            <>
              <Text style={line}>{String(loc.formatString(loc.cypherbox.seed_signer.dice.real_dice, { min: rollsOnlyFrom }))}</Text>
              <Text style={line}>
                {String(loc.formatString(loc.cypherbox.seed_signer.dice.rule, { min: rollsOnlyFrom, recommended: ROLLS_RECOMMENDED }))}
              </Text>
              <Text style={line}>{loc.cypherbox.seed_signer.dice.paper}</Text>
            </>
          ) : (
            <>
              <Text style={line}>{loc.cypherbox.vault.saving_vault_intro.dice_made_up}</Text>
              <Text style={line}>{loc.cypherbox.vault.saving_vault_intro.dice_phone_adds}</Text>
            </>
          )}
          {/* the bits: tapping shows them in hex, except for the seed-signer, whose seed from rolls alone isn't these bits */}
          <TouchableOpacity accessibilityRole="button" disabled={!!rollsOnlyFrom} onPress={() => setShow(!show)}>
            <Text style={line}>
              {!rollsOnlyFrom && show ? hex : String(loc.formatString(loc.cypherbox.seed_signer.dice.bits, { bits, limit: limitDisplay }))}
            </Text>
          </TouchableOpacity>
        </View>

        <Buttons pop={pop} save={save} colors={colors} />
      </ScrollView>
    </SafeArea>
  );
};

Entropy.navigationOptions = navigationStyle({}, opts => ({ ...opts, headerTitle: loc.entropy.title }));

const styles = StyleSheet.create({
  // the dice screen: count, dice, text, bits and buttons as one block in the middle, scrolling on a small screen
  page: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  countText: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  diceContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignSelf: 'center',
    maxWidth: 330,
  },
  guidance: {
    marginTop: 8,
  },
  // the one style for every line of text under the dice
  guidanceText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    opacity: 0.85,
    marginTop: 8,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  actionButton: {
    flex: 1,
    maxWidth: 170,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 25,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginHorizontal: 6,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '600',
    marginHorizontal: 8,
  },
  undoIcon: {
    transform: [{ rotate: '-45deg' }],
  },
  verifyScroll: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 110,
  },
  verifyTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  verifyReveal: {
    alignSelf: 'center',
    marginTop: 14,
    marginBottom: 6,
  },
  verifyRevealText: {
    fontSize: 13,
    color: '#4a90d9',
  },
  verifyRow: {
    marginTop: 12,
  },
  verifyLabel: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 3,
  },
  verifyHex: {
    fontSize: 13,
    fontFamily: 'Courier',
  },
  verifyHow: {
    fontSize: 12,
    marginTop: 14,
    opacity: 0.75,
    lineHeight: 17,
  },
  verifyWarning: {
    fontSize: 12,
    marginTop: 16,
    fontWeight: '600',
    color: '#E0A030',
    lineHeight: 17,
  },
  diceRoot: {
    aspectRatio: 1,
    maxWidth: 100,
    maxHeight: 100,
  },
  diceIcon: {
    margin: 3,
    justifyContent: 'center',
    alignItems: 'center',
    aspectRatio: 1,
    color: 'grey',
  },
});

export default Entropy;
