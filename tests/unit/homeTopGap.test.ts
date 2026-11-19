/**
 * Home's top gap on iOS.
 *
 * iPhone XR, 2026-11-13: ScreenLayout's native SafeAreaView was left at a top inset of 0 on Home, which stays mounted
 * for the whole session. The whole page sat 48pt too high, with the header under the clock and battery. Home now pads
 * its own top from the provider's insets, never below the inset measured at launch.
 */

import fs from 'fs';
import path from 'path';
import { homeTopGap } from '../../src/screens/HomeScreen/topGap';

// the launch metrics of an iPhone XR (Jest hoists this above the imports)
jest.mock('react-native-safe-area-context', () => ({
  initialWindowMetrics: {
    frame: { x: 0, y: 0, width: 414, height: 896 },
    insets: { top: 48, left: 0, right: 0, bottom: 34 },
  },
}));

describe('homeTopGap', () => {
  it('keeps the launch inset when the live inset drops to 0', () => {
    expect(homeTopGap(0, 48)).toBe(48);
  });

  it('is the inset itself when nothing went wrong', () => {
    expect(homeTopGap(48, 48)).toBe(48);
    expect(homeTopGap(59, 59)).toBe(59);
  });

  it('follows a larger live inset', () => {
    expect(homeTopGap(59, 48)).toBe(59);
  });

  it('uses the live inset when no launch inset was measured', () => {
    expect(homeTopGap(48, null)).toBe(48);
    expect(homeTopGap(48, undefined)).toBe(48);
    expect(homeTopGap(20, NaN)).toBe(20);
  });

  it('never returns NaN', () => {
    expect(homeTopGap(NaN, 48)).toBe(48);
    expect(homeTopGap(NaN, null)).toBe(0);
  });

  it('takes the floor from the launch metrics by default', () => {
    expect(homeTopGap(0)).toBe(48);
    expect(homeTopGap(59)).toBe(59);
  });
});

describe('Home wiring', () => {
  const REPO = path.join(__dirname, '..', '..');
  const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
  const home = read('src/screens/HomeScreen/index.tsx');
  const layout = read('src/component-library/ScreenLayout/index.tsx');

  it('pads only the sides natively on iOS and sets the top from homeTopGap', () => {
    expect(home).toMatch(/const HOME_IOS_EDGES = \['right', 'left'\];/);
    expect(home).toMatch(/const iosTopGap = homeTopGap\(useSafeAreaInsets\(\)\.top\);/);
    const start = home.indexOf('<ScreenLayout');
    const opening = home.slice(start, home.indexOf('RefreshControl={', start));
    expect(opening).toContain("edges={Platform.OS === 'ios' ? HOME_IOS_EDGES : undefined}");
    expect(opening).toContain("style={Platform.OS === 'ios' ? { paddingTop: iosTopGap } : undefined}");
  });

  it('gets that padding on the container around the scroll view', () => {
    // ScreenLayout hands `style` to the SafeAreaView that wraps the ScrollView (and its pull-to-refresh spinner), so
    // the scroll view still starts below the status bar; with no 'top' in `edges` it adds no inset of its own
    // (screenLayoutTopInset.test.tsx renders that case).
    expect(layout).toMatch(/const containerStyle = StyleSheet\.flatten\(\[styles\.inner, style\]\)/);
    expect(layout).toMatch(
      /style=\{topFromInsets \? \[containerStyle, \{ paddingTop: ownTop \+ safeTopInset\(insets\?\.top\) \}\] : containerStyle\}>\s+<StatusBar[^>]*\/>\s+\{renderContent\(\)\}/,
    );
  });
});
