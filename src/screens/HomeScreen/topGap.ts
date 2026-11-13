import { initialWindowMetrics } from 'react-native-safe-area-context';

/**
 * The gap above Home's content on iOS (status bar and notch), in points.
 *
 * Other screens get it from ScreenLayout's SafeAreaView, a native view that keeps the last inset it applied. Home
 * stays mounted for the whole session, and on an iPhone XR (2026-11-13) that view was left at 0: the whole page sat
 * 48pt too high, with the header under the clock and battery. Home now sets its own top padding from the provider's
 * insets instead.
 *
 * The app is portrait-only on iPhone, where the top inset never legitimately drops below the one measured at launch,
 * so that is the floor: a momentary 0 from the provider cannot move the page either. A larger live inset still wins.
 */
export function homeTopGap(liveTop: number, launchTop: number | null | undefined = initialWindowMetrics?.insets.top): number {
  const live = Number.isFinite(liveTop) ? liveTop : 0;
  const launch = typeof launchTop === 'number' && Number.isFinite(launchTop) ? launchTop : 0;
  return Math.max(live, launch);
}
