/**
 * The refresh wait banner calls a round stuck when the sync loop does, and on
 * the home screen it stays one line.
 *
 * It used to switch to "This refresh is stuck" with a Cancel button after one
 * hour, while useArkSync only marks a round stuck at twice the round interval,
 * so for the second hour a slow but healthy round was offered for cancelling.
 * And on Home the stuck state drew its full box in a slot positioned over the
 * gap above Top-up and Withdraw, covering them. `compact` makes it a single
 * tappable line there, which still leads to Cancel through `onCancel`.
 */

import React from 'react';
import { Text as RNText, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import RefreshWaitBanner, { REFRESH_WAIT_WINDOW_MS } from '../../src/components/RefreshWaitBanner';
import { arkStuckRoundThresholdMs } from '../../src/services/ark/roundStuck';

// jest hoists these mocks above the imports; the store mock reads mockStore only when the banner renders
jest.mock('@Cypher/component-library', () => ({ Text: require('react-native').Text }));
jest.mock('@Cypher/style-guide', () => ({ colors: {} }));
jest.mock('../../loc', () => {
    const keys = new Proxy({}, { get: (_target: object, key: string | symbol) => String(key) });
    return {
        __esModule: true,
        default: {
            cypherbox: { ark: { refresh_banner: keys } },
            formatString: (s: string, vals: Record<string, unknown>) =>
                `${s}:${Object.values(vals ?? {}).join(',')}`,
        },
    };
});
const mockStore: { arkRoundIntervalSecs: number | null } = { arkRoundIntervalSecs: null };
jest.mock('../../src/stores/authStore', () => ({
    __esModule: true,
    default: (select: (s: typeof mockStore) => unknown) => select(mockStore),
}));

const MIN = 60 * 1000;

const textOf = (root: renderer.ReactTestRenderer) =>
    root.root.findAllByType(RNText).map((t) => [].concat(t.props.children).join('')).join('\n');

function render(props: Partial<React.ComponentProps<typeof RefreshWaitBanner>> & { roundStarts: number[] }) {
    let root!: renderer.ReactTestRenderer;
    act(() => {
        root = renderer.create(<RefreshWaitBanner cancelling={false} onCancel={() => {}} {...props} />);
    });
    return root;
}

let mounted: renderer.ReactTestRenderer[] = [];
const keep = (r: renderer.ReactTestRenderer) => (mounted.push(r), r);

beforeEach(() => {
    mockStore.arkRoundIntervalSecs = null;
});

afterEach(() => {
    // the banner runs a 1s clock and a pulse loop
    act(() => mounted.forEach((r) => r.unmount()));
    mounted = [];
});

describe('arkStuckRoundThresholdMs', () => {
    it('is twice the round interval, the mainnet hour until arkInfo answers', () => {
        expect(arkStuckRoundThresholdMs(null)).toBe(120 * MIN);
        expect(arkStuckRoundThresholdMs(undefined)).toBe(120 * MIN);
        expect(arkStuckRoundThresholdMs(3600)).toBe(120 * MIN);
        expect(arkStuckRoundThresholdMs(300)).toBe(10 * MIN);
    });

    it('does not call every round stuck on a zero or garbage interval', () => {
        expect(arkStuckRoundThresholdMs(0)).toBe(120 * MIN);
        expect(arkStuckRoundThresholdMs(Number.NaN)).toBe(120 * MIN);
    });
});

describe('RefreshWaitBanner', () => {
    it('counts down the first hour', () => {
        const root = keep(render({ roundStarts: [Date.now() - 5 * MIN] }));
        expect(textOf(root)).toContain('come_back (0:5');
        expect(textOf(root)).not.toContain('stuck');
    });

    it('does not call a slow round stuck before the sync loop would', () => {
        expect(REFRESH_WAIT_WINDOW_MS).toBeLessThan(arkStuckRoundThresholdMs(null));
        const root = keep(render({ roundStarts: [Date.now() - 90 * MIN] }));
        const text = textOf(root);
        expect(text).toContain('come_back');
        expect(text).not.toContain('stuck');
        expect(text).not.toContain('cancel_refresh');
    });

    it('calls it stuck at twice the round interval, with Cancel in a box', () => {
        const onCancel = jest.fn();
        const root = keep(render({ roundStarts: [Date.now() - 121 * MIN], onCancel }));
        const text = textOf(root);
        expect(text).toContain('stuck');
        expect(text).toContain('cancel_refresh');
        act(() => {
            root.root.findAllByType(TouchableOpacity)[0].props.onPress();
        });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('follows the server round interval when it is known', () => {
        mockStore.arkRoundIntervalSecs = 300;
        const root = keep(render({ roundStarts: [Date.now() - 11 * MIN] }));
        expect(textOf(root)).toContain('cancel_refresh');
    });

    describe('compact, as on the home screen', () => {
        it('shows the stuck state as one tappable line that reaches Cancel', () => {
            const onCancel = jest.fn();
            const root = keep(render({ compact: true, roundStarts: [Date.now() - 121 * MIN], onCancel }));
            const lines = root.root.findAllByType(RNText);
            expect(lines).toHaveLength(1);
            expect(lines[0].props.children).toBe('stuck_compact');
            expect(lines[0].props.numberOfLines).toBe(1);
            expect(textOf(root)).not.toContain('cancel_refresh');
            const buttons = root.root.findAllByType(TouchableOpacity);
            expect(buttons).toHaveLength(1);
            act(() => {
                buttons[0].props.onPress();
            });
            expect(onCancel).toHaveBeenCalledTimes(1);
        });

        it('keeps the countdown, and leaves the other rounds to the Capsules tab', () => {
            const now = Date.now();
            // the oldest has about 29 minutes left, clear of a minute boundary
            const starts = [now - 10 * MIN, now - 20 * MIN, now - 31 * MIN];
            const full = keep(render({ roundStarts: starts }));
            expect(textOf(full)).toContain('extra_round');
            const compact = keep(render({ compact: true, roundStarts: starts }));
            const text = textOf(compact);
            expect(text).toContain('come_back (0:2');
            expect(text).not.toContain('extra_round');
            expect(compact.root.findAllByType(RNText)).toHaveLength(1);
        });
    });
});
