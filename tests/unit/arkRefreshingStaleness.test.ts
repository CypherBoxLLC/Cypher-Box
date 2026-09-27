/**
 * The net that stops a capsule animating "Refreshing" forever.
 *
 * The reported case: a refresh finishes, the user backgrounds the app, and on
 * return the animation is still running an hour later. A cold start shows it
 * finished. The ids are persisted, so a cold start is not forgetting them, it
 * is reconciling them, which means the sync tick completes on boot and not on
 * resume.
 *
 * These cases pin the two directions that matter. Cutting the animation early
 * tells a user their refresh stopped when it did not, which is worse than the
 * bug. Never cutting it is the bug.
 */

import {
    computeRefreshingSweep,
    REFRESHING_MAX_AGE_FLOOR_MS,
    REFRESHING_MAX_AGE_CEILING_MS,
} from '../../src/services/ark/refreshingStaleness';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('computeRefreshingSweep', () => {
    it('keeps an id through a round that is genuinely still running', () => {
        // Our own copy tells users a refresh takes about an hour, so an hour
        // in is normal, not stuck.
        const res = computeRefreshingSweep({
            tracked: ['a'],
            since: { a: NOW - HOUR },
            roundIntervalSecs: 60,
            now: NOW,
        });
        expect(res.kept).toEqual(['a']);
        expect(res.dropped).toBe(0);
    });

    it('keeps an id right up to the bound', () => {
        const res = computeRefreshingSweep({
            tracked: ['a'],
            since: { a: NOW - (REFRESHING_MAX_AGE_FLOOR_MS - MINUTE) },
            roundIntervalSecs: 60,
            now: NOW,
        });
        expect(res.dropped).toBe(0);
    });

    it('drops an id past the bound', () => {
        const res = computeRefreshingSweep({
            tracked: ['a', 'b'],
            since: { a: NOW - (REFRESHING_MAX_AGE_FLOOR_MS + MINUTE), b: NOW - MINUTE },
            roundIntervalSecs: 60,
            now: NOW,
        });
        expect(res.kept).toEqual(['b']);
        expect(res.dropped).toBe(1);
    });

    it('treats a missing stamp as ancient, so an upgrade clears a stuck user', () => {
        // Ids written by a build with no `arkRefreshingVtxoSince` must not have
        // their clock restarted by the upgrade that fixes them.
        const res = computeRefreshingSweep({
            tracked: ['legacy'],
            since: {},
            roundIntervalSecs: 60,
            now: NOW,
        });
        expect(res.kept).toEqual([]);
        expect(res.dropped).toBe(1);
    });

    it('never goes below the floor, however short the round interval', () => {
        const res = computeRefreshingSweep({
            tracked: [],
            since: {},
            roundIntervalSecs: 1,
            now: NOW,
        });
        expect(res.maxAgeMs).toBe(REFRESHING_MAX_AGE_FLOOR_MS);
    });

    it('scales with a long round interval but stops at the ceiling', () => {
        const long = computeRefreshingSweep({
            tracked: [],
            since: {},
            roundIntervalSecs: 3600, // 1h rounds -> 24h bound
            now: NOW,
        });
        expect(long.maxAgeMs).toBe(REFRESHING_MAX_AGE_CEILING_MS);

        const absurd = computeRefreshingSweep({
            tracked: [],
            since: {},
            roundIntervalSecs: 86_400,
            now: NOW,
        });
        expect(absurd.maxAgeMs).toBe(REFRESHING_MAX_AGE_CEILING_MS);
    });

    it('handles an unknown round interval', () => {
        for (const roundIntervalSecs of [null, undefined, 0]) {
            const res = computeRefreshingSweep({
                tracked: ['a'],
                since: { a: NOW - 2 * HOUR },
                roundIntervalSecs,
                now: NOW,
            });
            expect(res.maxAgeMs).toBe(REFRESHING_MAX_AGE_FLOOR_MS);
            expect(res.dropped).toBe(0);
        }
    });
});
