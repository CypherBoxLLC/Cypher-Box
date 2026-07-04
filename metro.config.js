/**
 * Metro configuration for React Native
 * https://reactnative.dev/docs/metro
 *
 * @format
 */
const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    blockList: exclusionList([
      // This stops "react-native run-windows" from causing the metro server to crash if its already running
      new RegExp(`${path.resolve(__dirname, 'windows').replace(/[/\\]/g, '/')}.*`),
      // This prevents "react-native run-windows" from hitting: EBUSY: resource busy or locked, open msbuild.ProjectImports.zip
      /.*\.ProjectImports\.zip/,
      // Exclude Claude Code worktrees to avoid duplicate module errors
      new RegExp(`${path.resolve(__dirname, '.claude').replace(/[/\\]/g, '/')}.*`),
    ]),
    // bbqr package has no 'main' field — tell Metro to check 'module' field in package.json
    resolverMainFields: ['react-native', 'browser', 'main', 'module'],
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'react-native-neomorph-shadows') {
        return {
          filePath: path.resolve(__dirname, 'shims/react-native-neomorph-shadows/index.js'),
          type: 'sourceFile',
        };
      }
      // @realm/fetch@0.1.1 ships package.json with `"module": "true"` (a string literal, not a path),
      // which breaks Metro's entry resolution. Redirect to the actual RN entry.
      if (moduleName === '@realm/fetch') {
        return {
          filePath: path.resolve(__dirname, 'node_modules/@realm/fetch/dist/react-native/react-native.js'),
          type: 'sourceFile',
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(defaultConfig, config);
