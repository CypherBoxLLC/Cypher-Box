// react-native.config.js
const path = require('path');
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
    // Force-register react-native-config on Android. RN's autolinker reads
    // each node_module's package.json `react-native` field to discover
    // platform configs. Our `postinstall` runs `rn-nodeify --hack`, which
    // overwrites that field with Node-builtin shims (crypto, path, stream,
    // etc.) for browserify-style polyfills. After rn-nodeify, the autolinker
    // sees `{"crypto":"react-native-crypto",...}` instead of the expected
    // `{"platforms":{"android":{...}}}` shape, so it registers the package
    // as `android: null` and the RNCConfigPackage never gets added to
    // PackageList.java — JS sees `require('react-native-config')` succeed
    // but the native bridge throws on `getConfig()`. Hardcoding the link
    // here bypasses package.json sniffing entirely.
    'react-native-config': {
      platforms: {
        android: {
          // Absolute path is mandatory — autolinking's Gradle plugin uses
          // this to wire up `implementation project(...)` for the lib's AAR
          // in the app's classpath. With a relative path, the AAR builds
          // (BuildConfig/RNCConfigPackage classes exist) but never gets
          // linked into the app DEX, so TurboModuleRegistry.get returns
          // null at runtime and the JS-side eager `.getConfig()` in
          // node_modules/react-native-config/index.js throws.
          // Compare with google-signin's auto-discovered config which
          // uses absolute paths via the package.json sniff path.
          sourceDir: path.resolve(__dirname, 'node_modules/react-native-config/android'),
          packageImportPath: 'import com.lugg.RNCConfig.RNCConfigPackage;',
          packageInstance: 'new RNCConfigPackage()',
        },
      },
    },
  },
};
