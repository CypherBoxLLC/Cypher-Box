/**
 * The offline probe behind the signer screens: 'no-answer' after two misses, 'connected' once a server answers, and a
 * probe that throws counts as a miss. Before, a rejection ended the polling with nothing scheduled after it, so a
 * screen that opened while the probe failed that way stayed on "Checking this phone is offline…" until it was left.
 */

import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

jest.mock('../../blue_modules/BlueElectrum', () => ({ serverAnswers: jest.fn() }));

// eslint-disable-next-line import/first
import useElectrumConnection from '../../src/custom-hooks/useElectrumConnection';

const BlueElectrum = require('../../blue_modules/BlueElectrum');

function Probe() {
    const connection = useElectrumConnection(true, false);
    return <Text>{connection}</Text>;
}

const shown = (tree: renderer.ReactTestRenderer) => tree.root.findByType(Text).props.children;

// the probe's promise chain is a few microtasks long
const settle = () =>
    act(async () => {
        for (let i = 0; i < 8; i++) await Promise.resolve();
    });

describe('useElectrumConnection', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        BlueElectrum.serverAnswers.mockReset();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it('keeps looking when the probe throws, and settles on no-answer after two misses', async () => {
        BlueElectrum.serverAnswers.mockRejectedValue(new Error('No socket with id 3'));
        let tree!: renderer.ReactTestRenderer;
        await act(async () => {
            tree = renderer.create(<Probe />);
        });
        await settle();
        expect(shown(tree)).toBe('checking');
        // the next look is scheduled, not abandoned
        expect(jest.getTimerCount()).toBe(1);

        await act(async () => {
            jest.advanceTimersByTime(3000);
        });
        await settle();
        expect(BlueElectrum.serverAnswers).toHaveBeenCalledTimes(2);
        expect(shown(tree)).toBe('no-answer');
        tree.unmount();
    });

    it('reports connected once a server answers, even after a miss', async () => {
        BlueElectrum.serverAnswers.mockRejectedValueOnce(new Error('socket closed')).mockResolvedValue(true);
        let tree!: renderer.ReactTestRenderer;
        await act(async () => {
            tree = renderer.create(<Probe />);
        });
        await settle();
        expect(shown(tree)).toBe('checking');

        await act(async () => {
            jest.advanceTimersByTime(3000);
        });
        await settle();
        expect(shown(tree)).toBe('connected');
        tree.unmount();
    });

    it('does not look at all when disabled or when the app itself switched the network off', async () => {
        BlueElectrum.serverAnswers.mockResolvedValue(true);
        function Off() {
            return <Text>{useElectrumConnection(true, true)}</Text>;
        }
        let tree!: renderer.ReactTestRenderer;
        await act(async () => {
            tree = renderer.create(<Off />);
        });
        await settle();
        expect(shown(tree)).toBe('checking');
        expect(BlueElectrum.serverAnswers).not.toHaveBeenCalled();
        tree.unmount();
    });
});
