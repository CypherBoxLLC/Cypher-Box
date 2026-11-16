/**
 * Home's contextual notices as icons: which ones show, in what order, and when an ignored one comes back.
 *
 * Red notices are critical and never ignorable. Yellow and green ones can be ignored, and stay hidden only while
 * their situation is the one they were ignored in.
 */

import {
    daySituation,
    HomeNotice,
    isIgnorable,
    stepSituation,
    visibleHomeNotices,
    withoutArkNoticeIgnores,
} from '../../src/services/homeNotices';

const notice = (id: string, severity: HomeNotice['severity'], situation = 's1'): HomeNotice => ({
    id,
    severity,
    icon: 'alert-circle',
    situation,
    text: id,
});

const ids = (list: HomeNotice[]) => list.map((n) => n.id);

describe('visibleHomeNotices', () => {
    it('puts red first, then yellow, then green, keeping the order within a colour', () => {
        const list = [
            notice('tip-a', 'green'),
            notice('dust', 'yellow'),
            notice('expiry', 'red'),
            notice('tip-b', 'green'),
            notice('offline', 'yellow'),
            notice('stuck', 'red'),
        ];
        expect(ids(visibleHomeNotices(list, {}))).toEqual(['expiry', 'stuck', 'dust', 'offline', 'tip-a', 'tip-b']);
    });

    it('skips empty entries and keeps the first of a repeated id', () => {
        const first = notice('dust', 'yellow', 'first');
        const list: Array<HomeNotice | null | undefined | false> = [null, first, false, undefined, notice('dust', 'yellow', 'second')];
        expect(visibleHomeNotices(list, {})).toEqual([first]);
    });

    it('hides an ignored notice while its situation is the same', () => {
        const list = [notice('dust', 'yellow', 'capsule-1'), notice('fees', 'green', '2026-11-15')];
        expect(ids(visibleHomeNotices(list, { dust: 'capsule-1', fees: '2026-11-15' }))).toEqual([]);
    });

    it('brings an ignored notice back once its situation changes', () => {
        const list = [notice('dust', 'yellow', 'capsule-1,capsule-2'), notice('fees', 'green', '2026-11-16')];
        expect(ids(visibleHomeNotices(list, { dust: 'capsule-1', fees: '2026-11-15' }))).toEqual(['dust', 'fees']);
    });

    it('never hides a red notice, whatever the ignore record says', () => {
        const list = [notice('expiry', 'red', ''), notice('stuck', 'red', '')];
        expect(ids(visibleHomeNotices(list, { expiry: '', stuck: '' }))).toEqual(['expiry', 'stuck']);
    });

    it('treats a missing ignore record as nothing ignored', () => {
        expect(ids(visibleHomeNotices([notice('dust', 'yellow')], undefined))).toEqual(['dust']);
        expect(ids(visibleHomeNotices([notice('dust', 'yellow')], null))).toEqual(['dust']);
    });
});

describe('isIgnorable', () => {
    it('is false only for red', () => {
        expect(isIgnorable({ severity: 'red' })).toBe(false);
        expect(isIgnorable({ severity: 'yellow' })).toBe(true);
        expect(isIgnorable({ severity: 'green' })).toBe(true);
    });
});

describe('withoutArkNoticeIgnores', () => {
    it('drops the Bark notices and keeps the rest', () => {
        expect(withoutArkNoticeIgnores({
            'ark-dust': 'a',
            'ark-backup-phone-only': '123',
            'utxo-consolidate': '2026-11-15',
            'coinos-region': 'unavailable',
        })).toEqual({ 'utxo-consolidate': '2026-11-15', 'coinos-region': 'unavailable' });
    });

    it('copes with no record', () => {
        expect(withoutArkNoticeIgnores(undefined)).toEqual({});
    });
});

describe('situations', () => {
    it('daySituation changes with the local day, not the time', () => {
        expect(daySituation(new Date(2026, 10, 15, 0, 1))).toBe('2026-11-15');
        expect(daySituation(new Date(2026, 10, 15, 23, 59))).toBe('2026-11-15');
        expect(daySituation(new Date(2026, 10, 16, 0, 0))).toBe('2026-11-16');
    });

    it('stepSituation only moves in whole steps', () => {
        expect(stepSituation(12_000, 10_000)).toBe('2');
        expect(stepSituation(19_999, 10_000)).toBe('2');
        expect(stepSituation(20_001, 10_000)).toBe('3');
        expect(stepSituation(Number.NaN, 10_000)).toBe('0');
        expect(stepSituation(5, 0)).toBe('0');
    });
});
