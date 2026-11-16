/**
 * A Home notice ignored with its × shows in Activity under the bell: its own message in its colour, marked Ignored,
 * with "Show again" while it is still ignored in the same situation. Show again puts it back on Home.
 */

import React from 'react';
import renderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { Row } from '../../src/screens/Activity';
import type { AppEvent } from '../../src/stores/eventLogStore';
import useAuthStore from '../../src/stores/authStore';

jest.mock('@Cypher/component-library', () => {
    const { Text, View } = require('react-native');
    return { Text, ScreenLayout: View };
});
jest.mock('react-native-vector-icons/Ionicons', () => 'Ionicons');
jest.mock('react-native-simple-toast', () => ({ show: jest.fn(), SHORT: 0 }));
jest.mock('../../loc', () => ({
    __esModule: true,
    default: {
        formatString: (text: string) => text,
        cypherbox: {
            home: { notice_ignore: 'Ignore', notice_ignored_toast: 'Ignored' },
            payments: {
                common: { hot_vault: 'Hot Vault', cold_vault: 'Cold Vault' },
                activity: { just_now: 'just now', notice_ignored: 'Ignored', notice_show_again: 'Show again' },
            },
        },
    },
}));

const NOW = 1_800_000_000_000;
const event: AppEvent = {
    id: 'e1',
    ts: NOW,
    kind: 'notice-ignored',
    noticeId: 'ark-dust',
    text: 'You have dust Bark capsules that might expire.',
    severity: 'yellow',
    icon: 'sparkles-outline',
    situation: 'capsule-1',
};

let tree: ReactTestRenderer | null = null;
const render = () => act(() => {
    tree = renderer.create(<Row ev={event} now={NOW} />);
});
const showAgain = () => tree!.root.findAll((n) => n.props.testID === 'activity-show-again-ark-dust' && typeof n.props.onPress === 'function');
// A Text's content, joined when it arrives in pieces ("Ignored · " + "just now").
const texts = () => tree!.root
    .findAll((n) => typeof n.props.children === 'string' || (Array.isArray(n.props.children) && n.props.children.every((c: unknown) => typeof c === 'string')))
    .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children));

beforeEach(() => {
    useAuthStore.setState({ homeNoticeIgnores: { 'ark-dust': 'capsule-1' } });
});

afterEach(() => {
    act(() => tree?.unmount());
    tree = null;
});

it('shows the ignored message, marked Ignored, in its colour', () => {
    render();
    expect(texts()).toContain('You have dust Bark capsules that might expire.');
    expect(texts()).toContain('Ignored · just now');
    const icon = tree!.root.findAll((n) => n.props.name === 'sparkles-outline');
    expect(icon[0].props.color).toBe('#FFD54F');
});

it('Show again puts the notice back on Home', () => {
    render();
    expect(showAgain().length).toBeGreaterThan(0);
    act(() => showAgain()[0].props.onPress());
    expect(useAuthStore.getState().homeNoticeIgnores).toEqual({});
    expect(showAgain()).toHaveLength(0);
});

it('offers no Show again once the notice is back or its situation moved on', () => {
    useAuthStore.setState({ homeNoticeIgnores: { 'ark-dust': 'capsule-1,capsule-2' } });
    render();
    expect(showAgain()).toHaveLength(0);
});
