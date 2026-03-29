import { colors } from '@Cypher/style-guide';
import React, { useState } from 'react';
import { Animated, Pressable } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import styles from './styles';

interface Props {
    colors_? : string[]
}

const GradientSwitch = ({colors_ =[colors.pink.light, colors.pink.default] }:Props) => {
  const [isOn, setIsOn] = useState(false);
  const translateX = useState(new Animated.Value(0))[0];

  const toggleSwitch = () => {
    setIsOn(!isOn);
    Animated.timing(translateX, {
      toValue: isOn ? 0 : 24, // Adjust according to the knob position
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable onPress={toggleSwitch}>
      <LinearGradient
        colors={colors_}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.container, isOn ? styles.containerOn : styles.containerOff]}
      >
        <Animated.View
          style={[
            styles.knob,
            {
              transform: [{ translateX }],
              shadowColor: colors.black.default,
              shadowOffset: { width: 2, height: 2 },
              shadowOpacity: 0.4,
              shadowRadius: 3,
              elevation: 5,
            },
          ]}
        />
      </LinearGradient>
    </Pressable>
  );
};

export default GradientSwitch;
