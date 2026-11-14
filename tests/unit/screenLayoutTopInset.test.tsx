/**
 * The top gap of every ScreenLayout screen on iOS.
 *
 * iPhone XR, 2026-11-14: after Home (fixed on its own), the send ("Construct transaction") and amount screens sat with
 * their back arrow and title under the clock and battery: the native SafeAreaView's top inset was 0. ScreenLayout now
 * sets the top padding itself on iOS, from the provider's insets and never below the inset measured at launch.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

jest.mock('react-native-safe-area-context', () => {
  const { createContext, createElement } = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaInsetsContext: createContext(null),
    // records the props ScreenLayout hands the native view
    SafeAreaView: (props: any) => createElement(View, { ...props, testID: 'safe-area' }),
    // an iPhone XR at launch
    initialWindowMetrics: { frame: { x: 0, y: 0, width: 414, height: 896 }, insets: { top: 48, left: 0, right: 0, bottom: 34 } },
  };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn() }) }));
jest.mock('react-native-keyboard-aware-scroll-view', () => ({ KeyboardAwareScrollView: require('react-native').ScrollView }));
jest.mock('react-native-elements/dist/helpers', () => ({ isIOS: true }));
jest.mock('@Cypher/components', () => ({ Progress: () => null }));
jest.mock('@Cypher/assets/images', () => ({ Back: 1, Close: 2 }));

// eslint-disable-next-line import/first
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
// eslint-disable-next-line import/first
import ScreenLayout from '../../src/component-library/ScreenLayout';

const insets = (top: number) => ({ top, left: 0, right: 0, bottom: 34 });

function safeArea(element: React.ReactElement, providerTop: number | null) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      providerTop === null ? element : (
        <SafeAreaInsetsContext.Provider value={insets(providerTop)}>{element}</SafeAreaInsetsContext.Provider>
      ),
    );
  });
  const view = tree.root.findByProps({ testID: 'safe-area' });
  return { edges: view.props.edges, paddingTop: StyleSheet.flatten(view.props.style)?.paddingTop };
}

describe('ScreenLayout top gap on iOS', () => {
  const screen = (props: any = {}) => (
    <ScreenLayout {...props}>
      <Text>content</Text>
    </ScreenLayout>
  );

  it('keeps the launch gap when the inset reads 0, as it did on the XR', () => {
    expect(safeArea(screen(), 0)).toEqual({ edges: ['right', 'left'], paddingTop: 48 });
  });

  it('is the inset itself when nothing went wrong, and follows a larger one', () => {
    expect(safeArea(screen(), 48).paddingTop).toBe(48);
    expect(safeArea(screen(), 59).paddingTop).toBe(59);
  });

  it('keeps the launch gap with no provider at all', () => {
    expect(safeArea(screen(), null).paddingTop).toBe(48);
  });

  it("adds a screen's own top padding, as the native view did", () => {
    expect(safeArea(screen({ style: { paddingTop: 10 } }), 48).paddingTop).toBe(58);
    expect(safeArea(screen({ style: { padding: 6 } }), 48).paddingTop).toBe(54);
  });

  it("leaves a screen that asks for no top inset alone (Home pads its own top)", () => {
    expect(safeArea(screen({ edges: ['right', 'left'], style: { paddingTop: 48 } }), 0)).toEqual({ edges: ['right', 'left'], paddingTop: 48 });
  });

  it('hands the other requested sides to the native view', () => {
    expect(safeArea(screen({ edges: ['top', 'bottom'] }), 0)).toEqual({ edges: ['bottom'], paddingTop: 48 });
  });
});
