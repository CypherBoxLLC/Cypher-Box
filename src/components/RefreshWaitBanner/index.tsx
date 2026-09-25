import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, TouchableOpacity, View } from 'react-native';

import { Text } from '@Cypher/component-library';
import { colors } from '@Cypher/style-guide';

/**
 * Extracted from ArkCapsules so the home screen can show the same banner.
 *
 * It was a private function component in that screen, which meant a refresh
 * round in flight was only visible to a user who had navigated into the
 * Capsules tab. The round takes up to an hour and needs the app open for the
 * completion sync to land, so the one place it must be visible is the screen
 * people actually sit on.
 *
 * Kept behaviourally identical: same window, same countdown, same stuck
 * escalation. The only difference is that a caller with no cancel path of its
 * own (the home screen) passes an `onCancel` that routes to Capsules rather
 * than cancelling in place.
 */
/** A round that has not finalised within this window is treated as stuck. */
export const REFRESH_WAIT_WINDOW_MS = 60 * 60 * 1000;

/** How many additional in-flight rounds to list below the headline. */
const MAX_EXTRA_REFRESH_LINES = 3;

// Format a remaining-ms value as H:MM:SS (e.g. 0:59:59). Clamped at 0.
function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Green pulsing reminder shown while a refresh round is in flight. A round can
 * take up to a few hours to finalise (or time out) server-side, and the user
 * must be back in the app for the completion sync to land, so we nudge them to
 * return, with a live countdown per in-flight round.
 *
 * `roundStarts` is the set of round first-seen timestamps (ms) from
 * `arkPendingRoundFirstSeen`, one per in-flight round. Each gets a 3h
 * countdown; the soonest-to-elapse (oldest round) is shown inline in the
 * headline and the rest stack below as "Refresh 2 / 3 / ...". A line drops
 * when its round completes (pruned from the map upstream). If a round is still
 * present after its 3h window is up it hasn't completed, so the banner switches
 * to a "stuck" state with a Cancel action; cancelling clears the round, which
 * unmounts the banner via the caller's in-flight gate. Self-contained pulse +
 * 1s tick so only this component re-renders each second, not the capsule list.
 */
export default function RefreshWaitBanner({
    roundStarts,
    cancelling,
    onCancel,
}: {
    roundStarts: number[];
    cancelling: boolean;
    onCancel: () => void;
}) {
    const pulse = useRef(new Animated.Value(0.6)).current;
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 900,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 0.6,
                    duration: 900,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ]),
        );
        loop.start();
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => {
            loop.stop();
            clearInterval(tick);
        };
    }, [pulse]);

    // A round still tracked after its 3h window has elapsed hasn't completed:
    // treat it as stuck. Otherwise render the per-round countdowns, soonest-to-
    // elapse first (the oldest round is the headline timer; the rest stack).
    const isStuck = roundStarts.some((start) => now - start >= REFRESH_WAIT_WINDOW_MS);
    const counting = roundStarts
        .map((start) => ({ start, remaining: start + REFRESH_WAIT_WINDOW_MS - now }))
        .filter((x) => x.remaining > 0)
        .sort((a, b) => a.remaining - b.remaining);
    const primary = counting[0];
    const extras = counting.slice(1);

    // Always amber: this is a "come back and check" warning whether the round
    // is still counting down or already stuck.
    const accent = '#FFD54F';
    const tint = 'rgba(255, 213, 79, 0.10)';

    return (
        <Animated.View
            style={{
                // Steady (no pulse) once stuck so the amber warning reads as a
                // fixed alert and the Cancel button stays easy to tap.
                opacity: isStuck ? 1 : pulse,
                marginHorizontal: 24,
                marginBottom: 12,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: tint,
                borderWidth: 1,
                borderColor: accent,
            }}
        >
            {isStuck ? (
                <>
                    <Text bold center style={{ fontSize: 12, color: accent, letterSpacing: 0.5, lineHeight: 17 }}>
                        This refresh is stuck. You can cancel the refresh and try again later.
                    </Text>
                    <TouchableOpacity
                        onPress={cancelling ? undefined : onCancel}
                        style={{ marginTop: 10, paddingVertical: 8, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: accent }}
                    >
                        <Text bold style={{ fontSize: 12, color: accent }}>
                            {cancelling ? 'Cancelling…' : 'Cancel refresh'}
                        </Text>
                    </TouchableOpacity>
                </>
            ) : (
                <>
                    <Text bold center style={{ fontSize: 12, color: accent, letterSpacing: 0.5, lineHeight: 17 }}>
                        {`PLEASE COME BACK IN 1 HOUR TO MAKE SURE THE REFRESH HAS COMPLETED${primary ? ` (${formatCountdown(primary.remaining)})` : ''}`}
                    </Text>
                    {extras.slice(0, MAX_EXTRA_REFRESH_LINES).map((x, i) => (
                        <Text
                            key={x.start}
                            center
                            style={{ fontSize: 11, color: accent, marginTop: 4 }}
                        >
                            {`- Refresh ${i + 2}: ${formatCountdown(x.remaining)}`}
                        </Text>
                    ))}
                    {extras.length > MAX_EXTRA_REFRESH_LINES && (
                        <Text center style={{ fontSize: 11, color: accent, marginTop: 4 }}>
                            {`+${extras.length - MAX_EXTRA_REFRESH_LINES} more`}
                        </Text>
                    )}
                </>
            )}
        </Animated.View>
    );
}
