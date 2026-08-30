import React, { useReducer, useState } from 'react';
import PropTypes from 'prop-types';
import BN from 'bignumber.js';
import {
  Alert,
  Dimensions,
  PixelRatio,
  View,
  ScrollView,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useNavigation, useRoute } from '@react-navigation/native';

import crypto from 'crypto';
import { randomBytes } from '../../class/rng';
import loc from '../../loc';
import { BlueCurrentTheme, useTheme } from '../../components/themes';
import { FContainer, FButton } from '../../components/FloatButtons';
import { BlueSpacing20, BlueTabs } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import SafeArea from '../../components/SafeArea';

const ENTROPY_LIMIT = 256;

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

const Coin = ({ push }) => (
  <View style={styles.coinRoot}>
    <TouchableOpacity accessibilityRole="button" onPress={() => push(getEntropy(0, 2))} style={styles.coinBody}>
      <Image style={styles.coinImage} source={require('../../img/coin1.png')} />
    </TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" onPress={() => push(getEntropy(1, 2))} style={styles.coinBody}>
      <Image style={styles.coinImage} source={require('../../img/coin2.png')} />
    </TouchableOpacity>
  </View>
);

Coin.propTypes = {
  push: PropTypes.func.isRequired,
};

const Dice = ({ push, sides }) => {
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const diceWidth = width / 4;
  const stylesHook = StyleSheet.create({
    dice: {
      borderColor: colors.buttonBackgroundColor,
    },
    diceText: {
      color: colors.foregroundColor,
    },
    diceContainer: {
      backgroundColor: colors.elevated,
    },
  });
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
    <ScrollView contentContainerStyle={[styles.diceContainer, stylesHook.diceContainer]}>
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
      {[...Array(sides)].map((_, i) => (
        <TouchableOpacity accessibilityRole="button" key={i} onPress={() => push(getEntropy((i + 1) % sides, sides))}>
          <View style={[styles.diceRoot, { width: diceWidth }]}>
            {sides === 6 ? (
              <Icon style={styles.diceIcon} name={diceIcon(i + 1)} size={70} color="grey" type="font-awesome-5" />
            ) : (
              <View style={[styles.dice, stylesHook.dice]}>
                <Text style={stylesHook.diceText}>{i + 1}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

Dice.propTypes = {
  sides: PropTypes.number.isRequired,
  push: PropTypes.func.isRequired,
};

const buttonFontSize =
  PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26) > 22
    ? 22
    : PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26);

const Buttons = ({ pop, save, colors }) => (
  <FContainer>
    <FButton
      onPress={pop}
      icon={
        <View style={styles.buttonsIcon}>
          <Icon name="undo" size={buttonFontSize} type="font-awesome" color={colors.buttonAlternativeTextColor} />
        </View>
      }
      text={loc.entropy.undo}
    />
    <FButton
      onPress={save}
      icon={
        <View style={styles.buttonsIcon}>
          <Icon name="arrow-down" size={buttonFontSize} type="font-awesome" color={colors.buttonAlternativeTextColor} />
        </View>
      }
      text={loc.entropy.save}
    />
  </FContainer>
);

Buttons.propTypes = {
  pop: PropTypes.func.isRequired,
  save: PropTypes.func.isRequired,
  colors: PropTypes.shape.isRequired,
};

const Entropy = () => {
  const [entropy, dispatch] = useReducer(eReducer, initialState);
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
  const { onGenerated, minBits, limit, instruction, mixWithRng } = useRoute().params;
  const navigation = useNavigation();
  const [tab, setTab] = useState(1);
  const [show, setShow] = useState(false);
  const { colors } = useTheme();
  const stylesHook = StyleSheet.create({
    entropy: {
      backgroundColor: colors.inputBackgroundColor,
    },
    entropyText: {
      color: colors.foregroundColor,
    },
  });

  // The raw face sequence, kept alongside the bit counter. The counter cannot
  // see degeneracy: `getEntropy(face, 6)` maps a face to the same value every
  // time, so N taps of one button push N*2 zero bits and the counter reports
  // them as full entropy.
  const [faces, setFaces] = useState([]);
  // Set once the mix has run; holds every input to the derivation so the user
  // can reproduce it. Never persisted and never leaves this screen.
  const [verify, setVerify] = useState(null);
  const [showVerify, setShowVerify] = useState(false);
  const push = v => {
    if (!v) return;
    // Once the target is reached the reducer refuses the roll, so stop
    // recording it too. Keeps `faces` meaning "rolls that counted", which is
    // what the degeneracy check below is judging.
    if (entropy.bits >= (limit || ENTROPY_LIMIT)) return;
    setFaces(f => [...f, `${v.value}:${v.bits}`]);
    dispatch({ type: 'push', value: v.value, bits: v.bits, limit: limit || ENTROPY_LIMIT });
  };
  const pop = () => {
    setFaces(f => f.slice(0, -1));
    dispatch({ type: 'pop' });
  };
  const save = async () => {
    if (minBits && entropy.bits < minBits) {
      Alert.alert(
        loc.entropy.title,
        `Not enough yet. You are at ${entropy.bits} of ${minBits}. Keep rolling until it gets there.`,
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
        distinct <= 1
          ? 'Every tap is the same number, so there is no randomness here at all. Roll a real die and tap what it lands on.'
          : 'These taps only use two numbers, so there is almost no randomness here. Roll a real die and tap what it lands on.',
      );
      return;
    }
    const buf = convertToBuffer(entropy);
    if (!mixWithRng) {
      navigation.pop();
      onGenerated(buf);
      return;
    }
    // Show the derivation before committing to it. The user rolled dice
    // precisely because they wanted to see where their key came from, so
    // handing back a key they cannot check defeats the exercise.
    const userBytes = buf.slice(0, 16);
    const rng = await randomBytes(16);
    setVerify({ user: userBytes, rng, final: mixEntropy(userBytes, rng) });
  };

  const acceptVerified = () => {
    navigation.pop();
    onGenerated(verify.final);
  };

  const hex = entropyToHex(entropy);
  const limitDisplay = limit || ENTROPY_LIMIT;

  // Wording and the expected number of throws, per tab. The counter above
  // measures BITS PUSHED, which is exactly the thing that misled people here
  // before: it cannot tell a real roll from a repeated tap. So the screen has
  // to say in words what the number cannot.
  //
  // AVG_BITS_PER_THROW is the real yield of `getEntropy`, not log2(sides).
  // A d6 maps faces 1-4 to 2 bits and faces 5-6 to 1 bit, averaging 10/6, and
  // a d20 maps 16 values to 4 bits and 4 values to 2 bits, averaging 3.6. The
  // encoding is lossy but sound: the bits it does emit are uniform, so 128 of
  // them from real throws really are 128 bits.
  const isCoin = tab === 0;
  const sourceNoun = isCoin ? 'coin' : 'die';
  const landedNoun = isCoin ? 'side' : 'face';
  const throwsNoun = isCoin ? 'flips' : 'rolls';
  const AVG_BITS_PER_THROW = [1, 10 / 6, 3.6];
  const typicalThrows = Math.ceil(limitDisplay / AVG_BITS_PER_THROW[tab]);
  let bits = Math.min(entropy.bits, limitDisplay).toString();
  bits = ' '.repeat(bits.length < 3 ? 3 - bits.length : 0) + bits;

  if (verify) {
    const row = (label, buf) => (
      <View style={styles.verifyRow}>
        <Text style={[styles.verifyLabel, stylesHook.entropyText]}>{label}</Text>
        <Text style={[styles.verifyHex, stylesHook.entropyText]}>{showVerify ? buf.toString('hex') : '.'.repeat(32)}</Text>
      </View>
    );
    return (
      <SafeArea>
        <ScrollView contentContainerStyle={styles.verifyScroll}>
          <Text style={[styles.verifyTitle, stylesHook.entropyText]}>Check where this key came from</Text>
          <Text style={[styles.guidanceCalm, stylesHook.entropyText]}>
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

          <Text style={styles.verifyWarning}>
            Do this with practice rolls, not your real ones. Typing your real rolls into a website gives away one of the two things
            protecting this key, and it would then rest on your phone's secure entropy generator only. Either do a practice run with rolls you
            throw away afterwards, or download Ian Coleman's tool and run it with this device offline.
          </Text>
          <Text style={[styles.verifyHow, stylesHook.entropyText]}>
            To check your rolls: type them into Ian Coleman's BIP39 tool and choose Dice. What it shows should match "Your rolls" above. That
            is what proves this screen read your dice correctly.
          </Text>
          <Text style={[styles.verifyHow, stylesHook.entropyText]}>
            To check the result: it is a SHA-256 hash of your rolls followed by your phone's randomness, shortened to 16 bytes. Paste it into
            the same tool as hex entropy to see the 12 words you are about to get.
          </Text>
          <Text style={styles.verifyWarning}>
            These values are your key. Anyone who copies them can spend your money. Do not photograph them.
          </Text>
        </ScrollView>
        <FContainer>
          <FButton onPress={acceptVerified} text="Continue" />
        </FContainer>
      </SafeArea>
    );
  }

  return (
    <SafeArea>
      <BlueSpacing20 />
      <TouchableOpacity accessibilityRole="button" onPress={() => setShow(!show)}>
        <View style={[styles.entropy, stylesHook.entropy]}>
          <Text style={[styles.entropyText, stylesHook.entropyText]}>{show ? hex : `${bits} of ${limitDisplay} bits`}</Text>
        </View>
      </TouchableOpacity>

      <BlueTabs
        active={tab}
        onSwitch={setTab}
        tabs={[
          // eslint-disable-next-line react/no-unstable-nested-components
          ({ active }) => (
            <Icon name="toll" type="material" color={active ? colors.buttonAlternativeTextColor : colors.buttonBackgroundColor} />
          ),
          // eslint-disable-next-line react/no-unstable-nested-components
          ({ active }) => (
            <Icon name="dice" type="font-awesome-5" color={active ? colors.buttonAlternativeTextColor : colors.buttonBackgroundColor} />
          ),
          // eslint-disable-next-line react/no-unstable-nested-components
          ({ active }) => (
            <Icon name="dice-d20" type="font-awesome-5" color={active ? colors.buttonAlternativeTextColor : colors.buttonBackgroundColor} />
          ),
        ]}
      />

      {tab === 0 && <Coin push={push} />}
      {tab === 1 && <Dice sides={6} push={push} />}
      {tab === 2 && <Dice sides={20} push={push} />}

      <View style={styles.guidance}>
        {instruction ? <Text style={[styles.instructionText, stylesHook.entropyText]}>{instruction}</Text> : null}
        <Text style={[styles.guidanceHow, stylesHook.entropyText]}>
          {`${isCoin ? 'Flip' : 'Roll'} a real ${sourceNoun}, then tap the ${landedNoun} it landed on. It takes about ${typicalThrows} ${throwsNoun}.`}
        </Text>
        <Text style={styles.guidanceWarning}>
          {`Tapping the same ${landedNoun} again and again, or any pattern you make up yourself, does not count as random. The number above still goes up, but your key gets no safer.`}
        </Text>
        <Text style={[styles.guidanceCalm, stylesHook.entropyText]}>
          Your phone always adds randomness of its own as well, so doing this can only make your key safer, never weaker.
        </Text>
      </View>

      <Buttons pop={pop} save={save} colors={colors} />
    </SafeArea>
  );
};

Entropy.navigationOptions = navigationStyle({}, opts => ({ ...opts, headerTitle: loc.entropy.title }));

const styles = StyleSheet.create({
  entropy: {
    padding: 5,
    marginLeft: 10,
    marginRight: 10,
    borderRadius: 9,
    minHeight: 49,
    paddingHorizontal: 8,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
  },
  entropyText: {
    fontSize: 15,
    fontFamily: 'Courier',
  },
  guidance: {
    marginHorizontal: 20,
    marginBottom: 90,
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
  instructionText: {
    fontSize: 13,
    textAlign: 'center',
    opacity: 0.7,
  },
  guidanceHow: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    opacity: 0.9,
  },
  guidanceWarning: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
    fontWeight: '600',
    color: '#E0A030',
  },
  guidanceCalm: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
    opacity: 0.6,
  },
  coinRoot: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  coinBody: {
    flex: 0.33,
    justifyContent: 'center',
    alignItems: 'center',
    aspectRatio: 1,
    borderWidth: 1,
    borderRadius: 5,
    borderColor: BlueCurrentTheme.colors.lightButton,
    margin: 10,
    padding: 10,
    maxWidth: 100,
    maxHeight: 100,
  },
  coinImage: {
    aspectRatio: 1,
    width: '100%',
    height: '100%',
    borderRadius: 75,
  },
  diceContainer: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingBottom: 100,
  },
  diceRoot: {
    aspectRatio: 1,
    maxWidth: 100,
    maxHeight: 100,
  },
  dice: {
    margin: 3,
    borderWidth: 1,
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
    aspectRatio: 1,
    borderColor: BlueCurrentTheme.colors.buttonBackgroundColor,
  },
  diceIcon: {
    margin: 3,
    justifyContent: 'center',
    alignItems: 'center',
    aspectRatio: 1,
    color: 'grey',
  },
  buttonsIcon: {
    backgroundColor: 'transparent',
    transform: [{ rotate: '-45deg' }],
    alignItems: 'center',
  },
});

export default Entropy;
