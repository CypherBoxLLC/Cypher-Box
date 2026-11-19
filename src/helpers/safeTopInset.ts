import { initialWindowMetrics } from 'react-native-safe-area-context';

/**
 * The gap to keep above a screen's content on iOS (status bar and notch), in points: the provider's live top inset,
 * never less than the one measured at launch.
 *
 * Screens used to get it from react-native-safe-area-context's native SafeAreaView, which keeps the last inset it
 * applied. On an iPhone XR (2026-11-13/14) it was left at 0, first on Home, then on the send and amount screens: the
 * header sat under the clock and battery.
 *
 * The app is portrait-only on iPhone, where the top inset never legitimately drops below the launch value, so that is
 * the floor: a momentary 0 from the provider cannot move a screen either. A larger live inset still wins.
 */
export function safeTopInset(
  liveTop: number | null | undefined,
  launchTop: number | null | undefined = initialWindowMetrics?.insets.top,
): number {
  const live = typeof liveTop === 'number' && Number.isFinite(liveTop) ? liveTop : 0;
  const launch = typeof launchTop === 'number' && Number.isFinite(launchTop) ? launchTop : 0;
  return Math.max(live, launch);
}
