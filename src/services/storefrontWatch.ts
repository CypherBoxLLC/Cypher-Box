import { AppState, Platform } from 'react-native';

import { getStorefrontCountry, refreshStorefrontCountry } from './featureFlags';

/*
 * Keeps the App Store storefront current on iOS after the launch read.
 *
 * index.js reads the storefront once at launch, and that read can come back
 * empty: an offline launch, a background launch from a silent push or a
 * background fetch, or StoreKit not ready yet. The region gates fail closed
 * on an unknown storefront, so with no further read Strike stayed hidden for
 * the whole run and a connected user's card stayed read-only as "not
 * available in your region".
 *
 * So the storefront is read again each time the app comes to the foreground
 * (where it can also have changed, with the Apple Account country) and,
 * while it is still unknown, after 1, 3, 10 and 30 seconds. A return to the
 * foreground starts those waits over. refreshStorefrontCountry() wakes the
 * gated screens only when the value actually changes, so the extra reads
 * cost no renders.
 */

/** Waits between reads while the storefront is unknown; after the last, only a foreground reads again. */
const RETRY_MS: readonly number[] = [1_000, 3_000, 10_000, 30_000];

let watching = false;
/** The one pending retry, if any. */
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** Index into RETRY_MS of the next wait. */
let retryStep = 0;

function known(): boolean {
    return getStorefrontCountry() !== null;
}

function stopRetrying(): void {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
    retryStep = 0;
}

/** Runs `retry` after the next wait, unless a retry is already waiting or none are left. */
function retryLater(retry: () => void): void {
    if (retryTimer !== undefined || retryStep >= RETRY_MS.length) return;
    retryTimer = setTimeout(() => {
        retryTimer = undefined;
        retry();
    }, RETRY_MS[retryStep]);
    retryStep += 1;
}

/**
 * Reads the storefront and, while it stays unknown, reads again later. A
 * retry skips the read when another read answered in the meantime.
 */
async function read(isPaused: () => boolean, isRetry = false): Promise<void> {
    if (isPaused()) return;
    if (!(isRetry && known())) await refreshStorefrontCountry();
    if (known()) stopRetrying();
    else retryLater(() => void read(isPaused, true));
}

/**
 * Starts keeping the storefront current. Call once at startup, right after
 * the launch read; later calls, and any call on Android, do nothing.
 * `isPaused` is asked before every read, so a phone turned into an Offline
 * Seed-Signer while the app runs stops asking too.
 */
export function watchStorefrontCountry(isPaused: () => boolean): void {
    if (Platform.OS !== 'ios' || watching) return;
    watching = true;
    AppState.addEventListener('change', state => {
        if (state !== 'active') return;
        stopRetrying();
        void read(isPaused);
    });
    // The launch read is already under way. Look again shortly if it does
    // not answer.
    if (!known()) retryLater(() => void read(isPaused, true));
}
