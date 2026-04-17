// react-native.config.js
module.exports = {
  assets: ['./src/assets/fonts/'],
  dependencies: {
    'rn-ldk': {
      platforms: {
        ios: null, // Disable autolinking for ios
        // android: null, // Uncomment if you also want to disable autolinking for Android
      },
    },
    '@react-native-community/art': {
      platforms: {
        android: null, // Removed in RN 0.76, shimmed via shims/react-native-neomorph-shadows
        ios: null,
      },
    },
  },
};
