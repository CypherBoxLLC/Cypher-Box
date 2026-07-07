import { createContext } from 'react';

/**
 * True when the enclosing wallet-carousel page is the one currently on
 * screen. Provided per-page by WalletsView's renderItem; defaults to true
 * so components rendered outside the carousel (detail screens, sheets)
 * behave as always-visible.
 *
 * Consumers combine this with useIsFocused() to decide whether a
 * balance-driven animation should play now or hold until the user can
 * actually see it (see useEasedProgress).
 */
export const CarouselPageVisibilityContext = createContext(true);
