import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, TouchableOpacity, View } from 'react-native';

import { Text } from '@Cypher/component-library';
import { arkStuckRoundThresholdMs } from '@Cypher/services/ark/roundStuck';
import useAuthStore from '@Cypher/stores/authStore';
import { colors } from '@Cypher/style-guide';
import loc from '../../../loc';

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
 * than cancelling in place, and `compact` so the stuck state fits its slot.
 */
/**
 * The countdown each round gets: the "1 hour" in the come-back copy, one
 * mainnet round. Not the stuck threshold. A round past this is slow, and is
 * only called stuck at arkStuckRoundThresholdMs, the point where the sync loop
 * also raises it, so the two never disagree about the same round.
 */
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
 * `arkPendingRoundFirstSeen`, one per in-flight round. Each gets a 1h
 * countdown; the soonest-to-elapse (oldest round) is shown inline in the
 * headline and the rest stack below as "Refresh 2 / 3 / ...". A line drops
 * when its round completes (pruned from the map upstream), or when its hour
 * is up and it is merely slow. If a round is still present past the shared
 * stuck threshold (twice the round interval) it hasn't completed, so the banner
 * switches to a "stuck" state with a Cancel action; cancelling clears the
 * round, which unmounts the banner via the caller's in-flight gate.
 * Self-contained pulse + 1s tick so only this component re-renders each second,
 * not the capsule list.
 *
 * `compact` is for a caller that places the banner over a fixed gap, as the
 * home screen does above Top-up and Withdraw: the stuck state becomes one
 * tappable line that calls `onCancel`, and the extra per-round lines are left
 * to the Capsules tab. Without it the stuck box ran over those buttons.
 */
export default function RefreshWaitBanner({
    roundStarts,
    cancelling,
    onCancel,
    compact = false,
}: {
    roundStarts: number[];
    cancelling: boolean;
    onCancel: () => void;
    compact?: boolean;
}) {
    const arkRoundIntervalSecs = useAuthStore((s) => s.arkRoundIntervalSecs);
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

    // A round still tracked past the stuck threshold hasn't completed: treat it
    // as stuck. Otherwise render the per-round countdowns, soonest-to-elapse
    // first (the oldest round is the headline timer; the rest stack).
    const stuckAfterMs = arkStuckRoundThresholdMs(arkRoundIntervalSecs);
    const isStuck = roundStarts.some((start) => now - start >= stuckAfterMs);
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

    if (compact && isStuck) {
        // One line in the size of the countdown, no box: the home slot has
        // room for the countdown's lines and no more. The tap reaches Cancel
        // through onCancel, which the home screen routes to the Capsules tab.
        return (
            <TouchableOpacity
                onPress={cancelling ? undefined : onCancel}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={loc.cypherbox.ark.refresh_banner.stuck_compact}
                style={compactStyles.line}
            >
                <Text h4 bold center numberOfLines={1} style={[compactStyles.text, { color: accent }]}>
                    {cancelling ? loc.cypherbox.ark.refresh_banner.cancelling : loc.cypherbox.ark.refresh_banner.stuck_compact}
                </Text>
            </TouchableOpacity>
        );
    }

    return (
        <Animated.View
            style={[
                {
                    // Steady (no pulse) once stuck so the amber warning reads as a
                    // fixed alert and the Cancel button stays easy to tap.
                    opacity: isStuck ? 1 : pulse,
                    marginHorizontal: 24,
                    marginBottom: 12,
                },
                // While counting down it is one plain line in the size of the
                // wallet card's "+ Refreshing" status: a boxed, capitalised
                // banner ran over the Top-up and Withdraw buttons on the home
                // screen. Only the stuck state, which carries a Cancel button,
                // keeps the box.
                isStuck && {
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderRadius: 10,
                    backgroundColor: tint,
                    borderWidth: 1,
                    borderColor: accent,
                },
            ]}
        >
            {isStuck ? (
                <>
                    <Text bold center style={{ fontSize: 12, color: accent, letterSpacing: 0.5, lineHeight: 17 }}>
                        {loc.cypherbox.ark.refresh_banner.stuck}
                    </Text>
                    <TouchableOpacity
                        onPress={cancelling ? undefined : onCancel}
                        style={{ marginTop: 10, paddingVertical: 8, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: accent }}
                    >
                        <Text bold style={{ fontSize: 12, color: accent }}>
                            {cancelling ? loc.cypherbox.ark.refresh_banner.cancelling : loc.cypherbox.ark.refresh_banner.cancel_refresh}
                        </Text>
                    </TouchableOpacity>
                </>
            ) : (
                <>
                    <Text h4 bold center style={{ color: accent }}>
                        {`${loc.cypherbox.ark.refresh_banner.come_back}${primary ? ` (${formatCountdown(primary.remaining)})` : ''}`}
                    </Text>
                    {!compact && extras.slice(0, MAX_EXTRA_REFRESH_LINES).map((x, i) => (
                        <Text
                            key={x.start}
                            center
                            style={{ fontSize: 11, color: accent, marginTop: 4 }}
                        >
                            {loc.formatString(loc.cypherbox.ark.refresh_banner.extra_round, { number: i + 2, time: formatCountdown(x.remaining) })}
                        </Text>
                    ))}
                    {!compact && extras.length > MAX_EXTRA_REFRESH_LINES && (
                        <Text center style={{ fontSize: 11, color: accent, marginTop: 4 }}>
                            {loc.formatString(loc.cypherbox.ark.refresh_banner.more, { count: extras.length - MAX_EXTRA_REFRESH_LINES })}
                        </Text>
                    )}
                </>
            )}
        </Animated.View>
    );
}

// Same side margins as the full banner, so the compact line sits where the
// countdown did.
const compactStyles = StyleSheet.create({
    line: { marginHorizontal: 24, marginBottom: 12 },
    text: { textDecorationLine: 'underline' },
});
