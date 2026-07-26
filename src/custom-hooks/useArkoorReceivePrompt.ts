import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';

import SimpleToast from 'react-native-simple-toast';

import {
    ARK_ARKOOR_ASSUMED_DAYS,
    ArkRefreshInFlightError,
    cancelVtxoExpiryWarnings,
    refreshArkVtxosDelegatedAndSync,
    scheduleVtxoExpiryWarnings,
} from '@Cypher/services/ark';
import { SPEND_GRACE_MS } from '@Cypher/services/ark/refreshDeferral';
import useAuthStore from '@Cypher/stores/authStore';
import { recordEvent } from '@Cypher/stores/eventLogStore';

/**
 * Foreground orchestrator for the "new Arkoor received" prompt.
 *
 * Why this exists
 * ---------------
 * Lightning receives into Ark materialise as arkoor VTXOs with a hard ~3-day
 * TTL (see ARK_ARKOOR_ASSUMED_DAYS in services/ark/config.ts for the
 * empirical source). The SDK does not expose the TTL via `expiryHeight` —
 * arkoor VTXOs report `expiryHeight === 0`, which the existing
 * useArkSync scheduler explicitly skips (it can't compute a wall-clock
 * expiry from height=0). So small Lightning receives silently sit with a
 * 3-day fuse and zero in-app warning.
 *
 * This hook closes that gap by:
 *   1. Detecting new arkoor VTXOs (kind === 'arkoor') the moment they
 *      appear in zustand (useArkSync writes vtxos every 30s — that's our
 *      detection cadence; sub-30s latency is fine for a popup UI).
 *   2. Showing a foreground Alert.alert with the educational copy + two
 *      explicit choices. Refresh now → locks the VTXO into the next round
 *      (~1h on mainnet) but extends the TTL by another full lifetime.
 *      Use immediately → keeps the VTXO spendable but accepts the 3-day
 *      fuse, and schedules OS-level 24h+2h push warnings as a fallback.
 *
 * The hook is intentionally self-contained — no changes to
 * movementWatcher or useArkSync. State lives in zustand
 * (arkArkoorPromptState) so a kill-and-relaunch doesn't re-prompt for a
 * VTXO the user already saw, and the dismissed list survives across the
 * arkoor's lifetime so the 24h push can still fire from a cold boot.
 *
 * Limitations called out in advance
 * ---------------------------------
 * - One Alert.alert at a time. If multiple arkoors arrive simultaneously
 *   (rare — would require two near-instant Lightning receives) the second
 *   prompt waits until the first is dismissed. UX is acceptable; per-vtxo
 *   queueing keeps the user from being stacked into modal hell.
 * - Foreground-only: if the user is backgrounded when the arkoor arrives,
 *   the popup fires on next foreground because the state is persisted.
 *   The 24h push (scheduled at first observation, not at dismissal) is the
 *   safety net for users who never return.
 * - "Refresh now" calls refreshArkVtxosDelegatedAndSync, which returns as
 *   soon as the ASP accepts the delegation (seconds); the round then
 *   completes in the background. We fire and forget either way. The existing
 *   per-row spinning refresh icon on the Capsules tab surfaces in-flight
 *   state if the user navigates there.
 */
export default function useArkoorReceivePrompt(): void {
    const arkVtxos = useAuthStore((s) => s.arkVtxos);
    const arkArkoorPromptState = useAuthStore((s) => s.arkArkoorPromptState);
    const setArkArkoorPromptState = useAuthStore((s) => s.setArkArkoorPromptState);
    const bgRefreshEnabled = useAuthStore((s) => s.arkBgRefreshEnabled);
    const isArkAuth = useAuthStore((s) => s.isArkAuth);
    // NB: `arkArkoorPromptEnabled` exists in the store for back-compat but
    // is no longer read. The popup is always on — see the field's
    // deprecation comment in authStore.ts for the user-feedback rationale.

    // Single-flight guard: at most one Alert.alert visible at a time. The
    // ref protects against the effect running twice in fast succession
    // (StrictMode dev double-invoke, or a vtxo write landing while a
    // previous prompt is still being shown).
    const promptInFlight = useRef(false);
    // Tracks the current foreground state. Alert.alert is foreground-only;
    // attempting to fire while backgrounded creates a phantom modal that
    // surfaces on next foreground without the user's context. Gate on this.
    //
    // STATE, not a ref, deliberately: the documented contract is "popup
    // fires on next foreground", and that requires the foreground
    // transition itself to re-run the prompt effect. With a ref, the
    // effect only re-evaluated when something else changed — usually the
    // 30s sync tick's arkVtxos write, which pauses while HomeScreen is
    // unfocused. Net effect observed live 2026-07-07: tap the
    // payment-received notification (deep-links to Capsules), and the
    // pending prompt never fires until the user wanders back to Home.
    const [appIsActive, setAppIsActive] = useState(
        AppState.currentState === 'active',
    );

    useEffect(() => {
        const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
            setAppIsActive(status === 'active');
        });
        return () => sub.remove();
    }, []);

    // Step 1a: schedule OS-level expiry warnings the moment a new
    // 'pending' entry appears (regardless of where it came from — almost
    // always from movementWatcher's real-time receive notification).
    //
    // Detection itself is no longer this hook's job — movementWatcher
    // pushes new entries into arkArkoorPromptState as soon as Bark emits
    // MovementUpdated subsystem=receive status=successful. That gives us
    // sub-second latency, which is required because useArkSync's
    // auto-refresh trigger fires within ~2 seconds of the receive
    // settling. A 30s-poll-based detector loses that race and the popup
    // shows up about a VTXO that's already Locked in a round.
    //
    // Each entry's OS-push schedule fires once per (vtxoId, schedule-call)
    // pair — scheduleVtxoExpiryWarnings is idempotent on the OS layer, but
    // we track an in-process Set so we don't call the bridge on every
    // render. Reset across reloads is fine; OS dedups by notification id.
    const scheduledRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!isArkAuth) return;
        for (const [id, entry] of Object.entries(arkArkoorPromptState)) {
            if (entry.status !== 'pending' && entry.status !== 'dismissed') continue;
            if (scheduledRef.current.has(id)) continue;
            const assumedExpiryAtMs =
                entry.observedAt + ARK_ARKOOR_ASSUMED_DAYS * 24 * 60 * 60 * 1000;
            // Sats may not be populated on legacy entries; fall back to the
            // arkVtxos read for the live record. Either way the notification
            // formatter handles the undefined path gracefully.
            const satsForNotif =
                entry.sats ??
                arkVtxos.find((v) => v.id === id)?.sats ??
                undefined;
            try {
                scheduleVtxoExpiryWarnings(id, assumedExpiryAtMs, satsForNotif);
                scheduledRef.current.add(id);
                if (__DEV__) {
                    console.log(
                        '[useArkoorReceivePrompt] scheduled arkoor expiry warnings for',
                        id.slice(0, 12),
                        'assumedExpiryAt=', new Date(assumedExpiryAtMs).toISOString(),
                    );
                }
            } catch (err) {
                console.warn(
                    '[useArkoorReceivePrompt] scheduleVtxoExpiryWarnings threw:',
                    err,
                );
            }
        }
    }, [arkArkoorPromptState, isArkAuth]);

    // Step 1b: prune entries whose vtxo no longer exists in the wallet
    // (spent, exited, refreshed-and-replaced). Keeps the map from growing
    // unbounded over the wallet's lifetime and cancels any phantom OS
    // pushes for vtxos that already moved.
    useEffect(() => {
        if (!isArkAuth) return;
        // RACE GUARD. There's a window between boot and the first
        // useArkSync read where arkVtxos is still []. Without this guard,
        // when movementWatcher pushes a new arkoor entry during that
        // window, the prune effect re-runs (because arkArkoorPromptState
        // changed), sees an empty livingIds set, and immediately wipes
        // the just-added entry. The alert effect never gets a chance.
        // Empirically: this swallowed the first Strike→Ark test on a
        // fresh reload and produced no Activity-feed event at all.
        if (arkVtxos.length === 0) return;
        const livingIds = new Set(arkVtxos.map((v) => v.id));
        const next: typeof arkArkoorPromptState = {};
        let mutated = false;
        for (const [id, entry] of Object.entries(arkArkoorPromptState)) {
            if (livingIds.has(id)) {
                next[id] = entry;
            } else {
                mutated = true;
                scheduledRef.current.delete(id);
                try {
                    cancelVtxoExpiryWarnings(id);
                } catch (err) {
                    console.warn('[useArkoorReceivePrompt] cancel on prune threw:', err);
                }
            }
        }
        if (mutated) setArkArkoorPromptState(next);
    }, [arkVtxos, arkArkoorPromptState, isArkAuth, setArkArkoorPromptState]);

    // Step 2: when at least one entry is 'pending' AND enabled AND
    // foreground, fire the prompt for the first pending one. The Alert
    // resolves asynchronously via button callbacks; promptInFlight ensures
    // we don't race a second alert on top.
    // Per-vtxo per-reason skip-log dedupe. Without this, the effect fires
    // a skip event on every render of the host screen while a pending
    // vtxo is queued — that floods the activity feed with duplicate
    // "skipped" rows. We log a skip reason at most once per
    // (vtxoId, reason) pair until the entry's status changes or it's
    // pruned.
    const loggedSkipRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!isArkAuth) return;
        // Find the oldest pending entry (FIFO so the user always sees
        // arkoors in the order they arrived).
        const pendingIds = Object.entries(arkArkoorPromptState)
            .filter(([, e]) => e.status === 'pending')
            .sort((a, b) => a[1].observedAt - b[1].observedAt)
            .map(([id]) => id);
        if (pendingIds.length === 0) return;
        const firstId = pendingIds[0];
        const entry = arkArkoorPromptState[firstId];
        const vtxoIdPrefix = firstId.slice(0, 12);
        // Sats source order:
        //   1. movementWatcher's push wrote it onto the prompt-state entry — preferred.
        //   2. If a legacy entry has no `sats` (persisted before that field
        //      existed), fall back to looking it up in arkVtxos.
        //   3. If still unknown, the alert renders with "your new sats"
        //      copy without a number — better than dropping the prompt.
        const vtxoFromList = arkVtxos.find((v) => v.id === firstId);
        const sats =
            entry?.sats ??
            vtxoFromList?.sats ??
            null;

        // Skip-reason logging. Record once per (id, reason) so we don't
        // spam the activity feed on every host re-render.
        const logSkip = (
            outcome: 'skipped-background' | 'skipped-in-flight',
        ) => {
            const dedupeKey = `${firstId}:${outcome}`;
            if (loggedSkipRef.current.has(dedupeKey)) return;
            loggedSkipRef.current.add(dedupeKey);
            recordEvent({
                kind: 'arkoor-prompt',
                outcome,
                vtxoIdPrefix,
                sats: sats ?? undefined,
            });
        };
        if (!appIsActive) {
            logSkip('skipped-background');
            return;
        }
        if (promptInFlight.current) {
            logSkip('skipped-in-flight');
            return;
        }

        // Past every skip gate — actually fire the alert. Clear stale
        // skip log entries for this id so a future status change (e.g.
        // user backgrounds the app then returns and we re-fire) is
        // observable.
        for (const r of ['skipped-background', 'skipped-in-flight']) {
            loggedSkipRef.current.delete(`${firstId}:${r}`);
        }
        promptInFlight.current = true;
        recordEvent({
            kind: 'arkoor-prompt',
            outcome: 'fired',
            vtxoIdPrefix,
            sats: sats ?? undefined,
        });
        const autoRefreshNote = bgRefreshEnabled
            ? '\n\nAuto-refresh is on, so this will refresh on its own before expiry. You can still lock it in now if you want certainty.'
            : '';
        const amountPhrase = sats != null ? `${sats.toLocaleString()} sats` : `sats`;
        const body =
            `You just received ${amountPhrase} to your Bark Vault.\n\n` +
            `These sats expire in about ${ARK_ARKOOR_ASSUMED_DAYS} days unless they're refreshed into a long-life capsule. ` +
            `Refreshing locks these sats for up to an hour while it finishes in the background, and you don't need to keep the app open.` +
            autoRefreshNote;
        const dontRefreshLabel =
            sats != null
                ? `Don't refresh the ${sats.toLocaleString()} sats — I'll spend them now`
                : `Don't refresh — I'll spend them now`;

        Alert.alert(
            'New sats in your Bark Vault',
            body,
            [
                {
                    text: dontRefreshLabel,
                    style: 'destructive',
                    onPress: () => {
                        try {
                            recordEvent({
                                kind: 'arkoor-prompt',
                                outcome: 'use-immediately',
                                vtxoIdPrefix,
                                sats: sats ?? undefined,
                            });
                            const cur = useAuthStore.getState().arkArkoorPromptState;
                            const existing = cur[firstId];
                            const nowTs = Date.now();
                            // Create-or-update so the "spend immediately" grace always
                            // holds, even if the pending entry is somehow missing.
                            // deferUntil holds auto-refresh off this vtxo for
                            // SPEND_GRACE_MS, then it refreshes normally.
                            setArkArkoorPromptState({
                                ...cur,
                                [firstId]: {
                                    ...(existing ?? { observedAt: nowTs, sats: sats ?? undefined }),
                                    status: 'dismissed',
                                    dismissedAt: nowTs,
                                    deferUntil: nowTs + SPEND_GRACE_MS,
                                },
                            });
                            console.log(
                                '[useArkoorReceivePrompt] use-immediately grace stamped',
                                firstId.slice(0, 12),
                                'deferUntil=now+', Math.round(SPEND_GRACE_MS / 3600000), 'h',
                                'existingFound=', !!existing,
                            );
                            // Re-arm OS push warnings — idempotent per id, so this
                            // is a no-op if they were already scheduled at
                            // observation time. Belt + suspenders in case the
                            // observation-time schedule was lost (uninstalled
                            // notif app, denied permissions then re-granted, etc).
                            const exp = (existing?.observedAt ?? Date.now()) +
                                ARK_ARKOOR_ASSUMED_DAYS * 24 * 60 * 60 * 1000;
                            try {
                                scheduleVtxoExpiryWarnings(firstId, exp, sats ?? undefined);
                            } catch (err) {
                                console.warn(
                                    '[useArkoorReceivePrompt] re-schedule on dismiss threw:',
                                    err,
                                );
                            }
                        } finally {
                            promptInFlight.current = false;
                        }
                    },
                },
                {
                    text: 'Refresh now (recommended)',
                    onPress: () => {
                        try {
                            recordEvent({
                                kind: 'arkoor-prompt',
                                outcome: 'refresh-now',
                                vtxoIdPrefix,
                                sats: sats ?? undefined,
                            });
                            const cur = useAuthStore.getState().arkArkoorPromptState;
                            const existing = cur[firstId];
                            if (existing) {
                                setArkArkoorPromptState({
                                    ...cur,
                                    [firstId]: { ...existing, status: 'refreshed' },
                                });
                            }
                            // We're committing to refresh — the OS-queued 24h/2h
                            // pushes for this arkoor are now phantom warnings (the
                            // funds will be safe once the round completes).
                            // Cancel them. If refresh ends up failing, the user
                            // can retry from the Capsules tab; we accept the
                            // tradeoff of "no fallback push on a failed refresh"
                            // for "no phantom warning on a successful refresh"
                            // because failed refreshes are visible in-app.
                            try {
                                cancelVtxoExpiryWarnings(firstId);
                            } catch (err) {
                                console.warn(
                                    '[useArkoorReceivePrompt] cancel on refresh threw:',
                                    err,
                                );
                            }
                            // Fire-and-forget. refreshArkVtxosDelegatedAndSync
                            // resolves as soon as the ASP accepts the delegation
                            // (seconds); the round then completes in the
                            // background. The per-row spinning icon on the
                            // Capsules tab is the user-visible in-flight signal,
                            // and we don't block here so the dismissal feels
                            // immediate.
                            refreshArkVtxosDelegatedAndSync([firstId], sats ?? undefined).catch((err) => {
                                console.warn(
                                    '[useArkoorReceivePrompt] refreshArkVtxosDelegatedAndSync threw:',
                                    err?.message ?? err,
                                );
                                // Don't roll status back to 'pending' — that would
                                // re-prompt the user on the next render, which is
                                // worse than silent failure. The existing per-row
                                // refresh affordance lets them retry manually.
                                //
                                // EXCEPT for the round-in-flight rejection: nothing
                                // was submitted, and we already cancelled this
                                // capsule's expiry warnings above in anticipation of
                                // the refresh. Restore the warnings and mark the
                                // entry dismissed (spendable, protected, no
                                // re-prompt) so the capsule isn't left with no
                                // safety net.
                                if (err instanceof ArkRefreshInFlightError) {
                                    const cur = useAuthStore.getState().arkArkoorPromptState;
                                    const existing2 = cur[firstId];
                                    if (existing2) {
                                        setArkArkoorPromptState({
                                            ...cur,
                                            [firstId]: {
                                                ...existing2,
                                                status: 'dismissed',
                                                dismissedAt: Date.now(),
                                            },
                                        });
                                    }
                                    const exp2 = (existing2?.observedAt ?? Date.now()) +
                                        ARK_ARKOOR_ASSUMED_DAYS * 24 * 60 * 60 * 1000;
                                    try {
                                        scheduleVtxoExpiryWarnings(firstId, exp2, sats ?? undefined);
                                    } catch (schedErr) {
                                        console.warn(
                                            '[useArkoorReceivePrompt] re-schedule after in-flight reject threw:',
                                            schedErr,
                                        );
                                    }
                                    SimpleToast.show(
                                        'A refresh is already running. These sats stay spendable, refresh them from Capsules once it finishes.',
                                        SimpleToast.LONG,
                                    );
                                }
                            });
                        } finally {
                            promptInFlight.current = false;
                        }
                    },
                },
            ],
            { cancelable: false },
        );
    }, [
        arkArkoorPromptState,
        isArkAuth,
        arkVtxos,
        bgRefreshEnabled,
        setArkArkoorPromptState,
        appIsActive,
    ]);
}
