/**
 * The gap above Home's content on iOS (status bar and notch), in points.
 *
 * Home sets its own top padding from this (see HomeScreen): the provider's insets, never below the inset measured at
 * launch. ScreenLayout now does the same for every screen on iOS; the rule lives in src/helpers/safeTopInset.ts.
 */
export { safeTopInset as homeTopGap } from '../../helpers/safeTopInset';
