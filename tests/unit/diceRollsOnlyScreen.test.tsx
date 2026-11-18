/**
 * The dice screen as the seed-signer opens it (rollsOnlyFrom: 50): from 50 real-looking rolls of a six-sided die the
 * seed is the rolls' own hash, the 12 words EntropyLab makes from them (vectors from EntropyLab's code, as in
 * diceSeed.test.ts), and the phone's randomness isn't asked for. With fewer rolls, a coin or a 20-sided die, or rolls
 * that look made up, it's the mix with the phone's randomness, as before. Either way it goes straight back with the
 * rolls, and Create a Seed shows the cross-check (createSignerSeedFlow.test.tsx). The rolls are on top, the bits below.
 */

import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import crypto from 'crypto';

import loc from '../../loc';
import ProvideEntropy from '../../screen/wallets/provideEntropy';
import { randomBytes } from '../../class/rng';
import { assertNativeRngHealthy } from '../../class/rngHealth';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../src/custom-hooks/useProtectSecret', () => () => {});
jest.mock('../../class/rng', () => ({ randomBytes: jest.fn(async (size: number) => Buffer.alloc(size, 7)) }));
jest.mock('../../class/rngHealth', () => ({
    ...jest.requireActual('../../class/rngHealth'),
    assertNativeRngHealthy: jest.fn(async () => {}),
}));
// the icons draw their names, so the faces can be found and pressed
jest.mock('react-native-elements', () => {
    const { Text: RNText } = require('react-native');
    return { Icon: ({ name }: { name: string }) => <RNText>{`icon:${name}`}</RNText> };
});
jest.mock('../../BlueComponents', () => {
    const { Text: RNText, TouchableOpacity: Touchable, View } = require('react-native');
    return {
        BlueSpacing20: () => null,
        BlueTabs: ({ onSwitch, tabs }: any) => (
            <View>
                {tabs.map((_: any, i: number) => (
                    <Touchable key={i} onPress={() => onSwitch(i)}>
                        <RNText>{`tab:${i}`}</RNText>
                    </Touchable>
                ))}
            </View>
        ),
    };
});
jest.mock('../../components/FloatButtons', () => {
    const { Text: RNText, TouchableOpacity: Touchable } = require('react-native');
    return {
        FContainer: ({ children }: any) => children,
        FButton: ({ text, onPress }: any) => (
            <Touchable onPress={onPress}>
                <RNText>{text}</RNText>
            </Touchable>
        ),
    };
});
jest.mock('../../components/SafeArea', () => ({ children }: any) => children);
jest.mock('../../components/navigationStyle', () => () => () => ({}));
jest.mock('../../components/themes', () => ({
    BlueCurrentTheme: { colors: {} },
    useTheme: () => ({ colors: { buttonAlternativeTextColor: '#000', buttonBackgroundColor: '#fff', foregroundColor: '#fff' } }),
}));
const mockRoute: { params: any } = { params: {} };
const mockNavigation = { pop: jest.fn(), setOptions: jest.fn() };
jest.mock('@react-navigation/native', () => ({
    useRoute: () => mockRoute,
    useNavigation: () => mockNavigation,
}));

const D = () => loc.cypherbox.seed_signer.dice;
const FACE = ['dice-one', 'dice-two', 'dice-three', 'dice-four', 'dice-five', 'dice-six'];
const textOf = (node: renderer.ReactTestInstance) =>
    node
        .findAllByType(Text)
        .map(t => [].concat(t.props.children).filter(c => typeof c === 'string' || typeof c === 'number').join(''))
        .join('\n');

const open = (onGenerated: jest.Mock, extra: any = {}) => {
    mockRoute.params = { limit: 128, mixWithRng: true, rollsOnlyFrom: 50, onGenerated, ...extra };
    let tree: renderer.ReactTestRenderer;
    act(() => {
        tree = renderer.create(<ProvideEntropy />);
    });
    const root = tree!.root;
    const button = (label: string) => root.findAllByType(TouchableOpacity).find(b => textOf(b) === label);
    const press = async (label: string) => {
        const b = button(label);
        if (!b) throw new Error(`no button ${label}`);
        await act(async () => {
            await b.props.onPress();
        });
    };
    // the d6 tab is open first; a d20 face is labelled with its number
    const roll = async (rolls: string, sides = 6) => {
        for (const face of rolls) await press(sides === 6 ? `icon:${FACE[Number(face) - 1]}` : face);
    };
    return { root, press, roll, text: () => textOf(root) };
};

beforeEach(() => {
    mockNavigation.pop.mockClear();
    mockNavigation.setOptions.mockClear();
    (randomBytes as jest.Mock).mockClear();
    (assertNativeRngHealthy as jest.Mock).mockClear();
});

// from EntropyLab's code (diceSeed.test.ts)
const FIFTY = '36261515636232342244625365616314551523335564321634';
const FIFTY_ENTROPY = '3026419cc629226157a6a860aba02cff';
const SIXTY_THREE = '312362464616531433111525415411345133435166634316136151643446345';
const SIXTY_THREE_ENTROPY = '4de88099ba75a106c3b8d852b575c66d';

describe("the signer's dice screen", () => {
    const d6 = (rolls: string) => [...rolls].map(face => ({ sides: 6, face: Number(face) }));

    it('shows the rolls on top and the bits below, with what happens either way and the paper to keep', async () => {
        const screen = open(jest.fn());
        expect(mockNavigation.setOptions).toHaveBeenCalledWith({ headerTitle: D().title });
        const lines = () => screen.root.findAllByType(Text).map(n => [].concat(n.props.children).join(''));
        await screen.roll('3626');
        const shown = lines();
        const count = shown.indexOf(String(loc.formatString(D().count, { count: 4, min: 50 })));
        // 3, 6, 2 and 6 give two bits each
        const bitsLine = shown.findIndex(l => l === String(loc.formatString(D().bits, { bits: 8, limit: 128 })));
        expect(count).toBeGreaterThanOrEqual(0);
        expect(bitsLine).toBeGreaterThan(count);
        expect(screen.text()).toContain(String(loc.formatString(D().rule, { min: 50 })));
        expect(screen.text()).toContain(D().paper);
        expect(screen.text()).toContain(D().real_dice);
        // the other screens' promise that the phone always adds its randomness isn't made here
        expect(screen.text()).not.toContain('Your phone always adds randomness');
    });

    it("makes the seed from 50 rolls alone, EntropyLab's 12 words, and goes straight back with the rolls", async () => {
        const onGenerated = jest.fn();
        const screen = open(onGenerated);
        await screen.roll(FIFTY);
        await screen.press(loc.entropy.save);
        expect(randomBytes).not.toHaveBeenCalled();
        expect(mockNavigation.pop).toHaveBeenCalled();
        const [entropy, from] = onGenerated.mock.calls[0];
        expect(Buffer.from(entropy).toString('hex')).toBe(FIFTY_ENTROPY);
        expect(from).toEqual({ source: 'rolls', count: 50, rolls: d6(FIFTY) });
    });

    it('counts every roll past the bit target too, as EntropyLab hashes every roll', async () => {
        const onGenerated = jest.fn();
        const screen = open(onGenerated);
        // 63 rolls; the bit counter can fill before the end, the seed still takes all of them
        await screen.roll(SIXTY_THREE);
        await screen.press(loc.entropy.save);
        const [entropy, from] = onGenerated.mock.calls[0];
        expect(Buffer.from(entropy).toString('hex')).toBe(SIXTY_THREE_ENTROPY);
        expect(from.count).toBe(63);
    });

    it('takes back the last roll, before and after the bit target', async () => {
        const onGenerated = jest.fn();
        const screen = open(onGenerated);
        await screen.roll(`${FIFTY}5`);
        await screen.press(loc.entropy.undo);
        await screen.press(loc.entropy.save);
        expect(Buffer.from(onGenerated.mock.calls[0][0]).toString('hex')).toBe(FIFTY_ENTROPY);
    });

    it('comes back with the rolls from before, to add to them or take some back', async () => {
        const again = jest.fn();
        const screen = open(again, { initialRolls: d6(FIFTY) });
        expect(screen.text()).toContain(String(loc.formatString(D().count, { count: 50, min: 50 })));
        await screen.press(loc.entropy.save);
        expect(Buffer.from(again.mock.calls[0][0]).toString('hex')).toBe(FIFTY_ENTROPY);

        const fewer = jest.fn();
        const other = open(fewer, { initialRolls: d6(FIFTY) });
        await other.press(loc.entropy.undo);
        expect(other.text()).toContain(String(loc.formatString(D().count, { count: 49, min: 50 })));
        await other.press(loc.entropy.save);
        expect(fewer.mock.calls[0][1]).toEqual({ source: 'mix', reason: 'too-few', rolls: d6(FIFTY.slice(0, 49)) });
    });

    it("mixes in the phone's randomness with fewer than 50 rolls, and hands back why", async () => {
        const onGenerated = jest.fn();
        const screen = open(onGenerated);
        await screen.roll('3626');
        await screen.press(loc.entropy.save);
        expect(assertNativeRngHealthy).toHaveBeenCalled();
        expect(randomBytes).toHaveBeenCalledWith(16);
        expect(mockNavigation.pop).toHaveBeenCalled();
        const [entropy, from] = onGenerated.mock.calls[0];
        expect(from).toEqual({ source: 'mix', reason: 'too-few', rolls: d6('3626') });
        expect(Buffer.from(entropy).toString('hex')).not.toBe(crypto.createHash('sha256').update('3626').digest('hex').slice(0, 32));
    });

    it('mixes rolls that look made up, and rolls of a 20-sided die', async () => {
        const madeUp = jest.fn();
        const screen = open(madeUp);
        await screen.roll('123456'.repeat(9));
        await screen.press(loc.entropy.save);
        expect(madeUp.mock.calls[0][1]).toMatchObject({ source: 'mix', reason: 'pattern' });

        const d20 = jest.fn();
        const other = open(d20);
        await other.press('tab:2');
        for (let i = 0; i < 50; i++) await other.press(String((i % 20) + 1));
        await other.press(loc.entropy.save);
        expect(d20.mock.calls[0][1]).toMatchObject({ source: 'mix', reason: 'not-six-sided' });
    });

    it('adds nothing when saved before any roll', async () => {
        const onGenerated = jest.fn();
        const screen = open(onGenerated);
        await screen.press(loc.entropy.save);
        expect(mockNavigation.pop).toHaveBeenCalled();
        expect(onGenerated).not.toHaveBeenCalled();
    });
});

describe("the Hot Vault's dice screen", () => {
    it('shows the throws on top and the bits below too, and keeps its own title', async () => {
        const screen = open(jest.fn(), { rollsOnlyFrom: undefined, minBits: 128 });
        expect(mockNavigation.setOptions).not.toHaveBeenCalled();
        await screen.roll('362');
        expect(screen.text()).toContain('3 rolls');
        expect(screen.text()).toMatch(/\d+ of 128 bits/);
        expect(screen.text()).toContain('Your phone always adds randomness');
    });
});
