import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@Cypher/component-library';
import { colors } from '@Cypher/style-guide';
import loc from '../../../loc';

/**
 * "Good Luck, Have Fun!" and "START" on the welcome screens are English artwork. In any other language the same
 * words are drawn as text, in the space the artwork takes. Read when drawn: the language is set after start-up.
 */
export const welcomeArtFits = () => loc.getLanguage() === 'en';

export function GoodLuckWords() {
  return (
    <View style={styles.goodLuck}>
      <Text bold style={styles.goodLuckLine}>
        {loc.cypherbox.welcome.good_luck}
      </Text>
      <Text bold style={styles.goodLuckLine}>
        {loc.cypherbox.welcome.have_fun}
      </Text>
    </View>
  );
}

/** START as the artwork draws it: a pink outline once it can be pressed, grey until then. */
export function StartWord({ active }: { active: boolean }) {
  return (
    <View style={active ? styles.startFrame : [styles.startFrame, styles.startFrameOff]}>
      <Text bold style={active ? styles.startWord : [styles.startWord, styles.startWordOff]}>
        {loc.cypherbox.welcome.start}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  goodLuck: {
    width: 177,
    height: 113,
    justifyContent: 'center',
    alignItems: 'center',
  },
  goodLuckLine: {
    fontSize: 32,
    lineHeight: 48,
    textAlign: 'center',
  },
  startFrame: {
    width: 190,
    height: 57,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: colors.pink.main,
    backgroundColor: colors.primary,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
  },
  startFrameOff: {
    borderColor: '#5A5A5A',
    backgroundColor: '#141414',
  },
  startWord: {
    fontSize: 28,
    lineHeight: 40,
    color: colors.white,
    textAlign: 'center',
  },
  startWordOff: {
    color: '#8C8C8C',
  },
});
