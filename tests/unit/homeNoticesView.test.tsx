/**
 * Home's notice icons: tapping an icon shows its message, tapping it again hides it, and the × on a yellow or green
 * icon ignores the notice until its situation changes, recording it in Activity so a mis-tap can be read again and
 * undone. Red icons have no ×.
 */

import React from 'react';
import renderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import SimpleToast from 'react-native-simple-toast';
import HomeNotices from '../../src/components/HomeNotices';
import type { HomeNotice } from '../../src/services/homeNotices';
import useAuthStore from '../../src/stores/authStore';
import useEventLogStore from '../../src/stores/eventLogStore';

jest.mock('@Cypher/component-library', () => ({ Text: require('react-native').Text }));
jest.mock('react-native-vector-icons/Ionicons', () => 'Ionicons');
jest.mock('react-native-simple-toast', () => ({ show: jest.fn(), SHORT: 0 }));
jest.mock('../../loc', () => ({
    __esModule: true,
    default: { cypherbox: { home: { notice_ignore: 'Ignore', notice_ignored_toast: 'Ignored, see Activity' } } },
}));

let tree: ReactTestRenderer | null = null;

const notice = (id: string, severity: HomeNotice['severity'], extra: Partial<HomeNotice> = {}): HomeNotice => ({
    id,
    severity,
    icon: 'alert-circle',
    situation: 's1',
    text: `${id} message`,
    ...extra,
});

function render(notices: Array<HomeNotice | null>, closeKey?: unknown) {
    act(() => {
        if (tree) tree.update(<HomeNotices notices={notices} closeKey={closeKey} />);
        else tree = renderer.create(<HomeNotices notices={notices} closeKey={closeKey} />);
    });
}

// The touchable with this testID (its host view carries the same testID, without onPress).
const pressable = (testID: string) => tree!.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === 'function');
const press = (testID: string) => {
    const found = pressable(testID);
    expect(found.length).toBeGreaterThan(0);
    act(() => found[0].props.onPress());
};
const shows = (text: string) => tree!.root.findAll((n) => n.props.children === text).length > 0;
// TouchableOpacity is two nodes deep in the test tree, both carrying testID and onPress: count each icon once.
const iconIds = () => [...new Set(tree!.root
    .findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('home-notice-') && typeof n.props.onPress === 'function')
    .map((n) => n.props.testID.replace('home-notice-', ''))
    .filter((id) => !id.startsWith('ignore-')))];

beforeEach(() => {
    useAuthStore.setState({ homeNoticeIgnores: {} });
    useEventLogStore.setState({ events: [] });
    (SimpleToast.show as jest.Mock).mockClear();
});

afterEach(() => {
    act(() => tree?.unmount());
    tree = null;
});

it('draws one icon per notice, red first, with every message closed', () => {
    render([notice('tip', 'green'), notice('dust', 'yellow'), notice('expiry', 'red')]);
    expect(iconIds()).toEqual(['expiry', 'dust', 'tip']);
    expect(shows('expiry message')).toBe(false);
    expect(shows('dust message')).toBe(false);
});

it('shows a message on the first tap and hides it on the second', () => {
    render([notice('dust', 'yellow')]);
    press('home-notice-dust');
    expect(shows('dust message')).toBe(true);
    press('home-notice-dust');
    expect(shows('dust message')).toBe(false);
});

it('draws the open message as an outline, with no fill', () => {
    render([notice('dust', 'yellow')]);
    press('home-notice-dust');
    // Walk up from the message text to the box around it: the one with the 1pt outline.
    let box = tree!.root.findAll((n) => n.props.children === 'dust message')[0];
    while (box && StyleSheet.flatten(box.props.style)?.borderWidth !== 1) box = box.parent!;
    expect(box).toBeTruthy();
    const style = StyleSheet.flatten(box.props.style);
    expect(style.borderColor).toBeTruthy();
    expect(style.backgroundColor).toBeUndefined();
});

it('keeps one message open at a time', () => {
    render([notice('dust', 'yellow'), notice('tip', 'green')]);
    press('home-notice-dust');
    press('home-notice-tip');
    expect(shows('dust message')).toBe(false);
    expect(shows('tip message')).toBe(true);
});

it('puts an × on yellow and green icons only, and none in the message', () => {
    render([notice('expiry', 'red'), notice('dust', 'yellow'), notice('tip', 'green')]);
    expect(pressable('home-notice-ignore-expiry')).toHaveLength(0);
    expect(pressable('home-notice-ignore-dust').length).toBeGreaterThan(0);
    expect(pressable('home-notice-ignore-tip').length).toBeGreaterThan(0);

    press('home-notice-dust');
    expect(shows('Ignore')).toBe(false);
});

it('the × hides the notice until its situation changes', () => {
    render([notice('dust', 'yellow', { situation: 'capsule-1' })]);
    press('home-notice-ignore-dust');

    expect(useAuthStore.getState().homeNoticeIgnores).toEqual({ dust: 'capsule-1' });
    expect(iconIds()).toEqual([]);

    render([notice('dust', 'yellow', { situation: 'capsule-1' })]);
    expect(iconIds()).toEqual([]);

    render([notice('dust', 'yellow', { situation: 'capsule-1,capsule-2' })]);
    expect(iconIds()).toEqual(['dust']);
});

it('the × records the notice in Activity and says so', () => {
    render([notice('dust', 'yellow', { situation: 'capsule-1', icon: 'sparkles-outline' })]);
    press('home-notice-ignore-dust');

    const [event] = useEventLogStore.getState().events;
    expect(event).toEqual(expect.objectContaining({
        kind: 'notice-ignored',
        noticeId: 'dust',
        text: 'dust message',
        severity: 'yellow',
        icon: 'sparkles-outline',
        situation: 'capsule-1',
    }));
    expect(SimpleToast.show).toHaveBeenCalledWith('Ignored, see Activity', 0);
});

it('the × on an open message closes it', () => {
    render([notice('dust', 'yellow'), notice('tip', 'green')]);
    press('home-notice-dust');
    press('home-notice-ignore-dust');
    expect(shows('dust message')).toBe(false);
    expect(iconIds()).toEqual(['tip']);
});

it('runs the message tap and the extra actions', () => {
    const onPress = jest.fn();
    const keep = jest.fn();
    render([notice('boarding', 'yellow', { onPress, actions: [{ label: 'Keep for exit fees', onPress: keep }] })]);
    press('home-notice-boarding');

    act(() => tree!.root.findAll((n) => n.props.onPress === onPress)[0].props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);

    const action = tree!.root.findAll((n) => typeof n.props.onPress === 'function'
        && n.findAll((c) => c.props.children === 'Keep for exit fees').length > 0);
    act(() => action[0].props.onPress());
    expect(keep).toHaveBeenCalledTimes(1);
});

it('underlines the link part of a message', () => {
    render([notice('dust', 'yellow', { text: 'Batch refresh them here.', linkText: 'here' })]);
    press('home-notice-dust');
    const link = tree!.root.findAll((n) => n.props.children === 'here');
    expect(link.length).toBeGreaterThan(0);
    expect(StyleSheet.flatten(link[0].props.style)).toEqual(expect.objectContaining({ textDecorationLine: 'underline' }));
});

it('closes an open message when closeKey changes', () => {
    render([notice('dust', 'yellow')], 1);
    press('home-notice-dust');
    expect(shows('dust message')).toBe(true);
    render([notice('dust', 'yellow')], 2);
    expect(shows('dust message')).toBe(false);
});

it('draws an empty container when nothing shows', () => {
    render([null]);
    expect(iconIds()).toEqual([]);
    expect(tree!.toJSON()).not.toBeNull();
});
