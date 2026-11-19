/**
 * The send and withdraw review screens, when the Ark server refuses a capsule.
 *
 * Both passed the failure straight to describeArkFailure, so a capsule spent
 * from another device showed the raw "vtxo ... is not spendable (state: spent)"
 * and was never recorded, and the phantom stayed in the balance. They now hand
 * the error to recordAndDescribeNotSpendable first (covered with the real store
 * in arkServerSpentCapsules.test.ts) and show its copy. An outcome that may
 * still be in flight must not reach it: that branch is checked first, as before.
 */

import React from 'react';
import renderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';

import loc from '../../loc';
import ArkSendReviewScreen from '../../src/screens/Ark/ArkSendReviewScreen';
import ArkWithdrawReviewScreen from '../../src/screens/Ark/ArkWithdrawReviewScreen';

jest.setTimeout(30 * 1000);

const mockEstimateArkSendFee = jest.fn();
const mockExecuteArkSend = jest.fn();
const mockRecordAndDescribe = jest.fn();
const mockToast = jest.fn();
const mockSwipe: { onToggle: ((on: boolean) => Promise<void>) | null; reset: jest.Mock } = {
    onToggle: null,
    reset: jest.fn(),
};

jest.mock('@Cypher/services/ark/vtxos', () => ({
    __esModule: true,
    recordAndDescribeNotSpendable: (...args: unknown[]) => mockRecordAndDescribe(...args),
}));
jest.mock('@Cypher/services/ark', () => ({
    __esModule: true,
    describeArkFailure: jest.requireActual('../../src/services/ark/networkFault').describeArkFailure,
    isArkSendIndeterminate: jest.requireActual('../../src/services/ark/indeterminate').isArkSendIndeterminate,
    ESPLORA_URLS: ['https://blockstream.info/api'],
    ARK_SERVER_URL: 'https://ark.second.tech',
    ARK_VTXO_DUST_SATS: 330,
    classifyArkDestination: (value: string) => ({ kind: 'ark', value }),
    labelForDestinationKind: () => 'Ark address',
    estimateArkSendFee: (...args: unknown[]) => mockEstimateArkSendFee(...args),
    executeArkSend: (...args: unknown[]) => mockExecuteArkSend(...args),
}));
jest.mock('@Cypher/services/ark/send', () => ({
    __esModule: true,
    isArkSendIndeterminate: jest.requireActual('../../src/services/ark/indeterminate').isArkSendIndeterminate,
    classifyArkDestination: (value: string) => ({ kind: 'onchain', value }),
    estimateArkSendFee: (...args: unknown[]) => mockEstimateArkSendFee(...args),
    executeArkSend: (...args: unknown[]) => mockExecuteArkSend(...args),
}));
jest.mock('@Cypher/services/ark/balance', () => ({ __esModule: true, fetchArkBalance: jest.fn() }));
jest.mock('@Cypher/services/ark/config', () => ({
    __esModule: true,
    ARK_SERVER_URL: 'https://ark.second.tech',
    ESPLORA_URLS: ['https://blockstream.info/api'],
}));
jest.mock('@Cypher/stores/authStore', () => {
    const { create } = require('zustand');
    return { __esModule: true, default: create(() => ({ arkBalance: 100_000 })) };
});
jest.mock('@Cypher/component-library', () => {
    const { createElement } = require('react');
    const { Text, TextInput, View } = require('react-native');
    return {
        ScreenLayout: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
        Text,
        Input: TextInput,
    };
});
jest.mock('@Cypher/components', () => {
    const { createElement, forwardRef, useImperativeHandle } = require('react');
    const { Text, TouchableOpacity, View } = require('react-native');
    return {
        GradientButton: ({ title, onPress, disabled }: any) =>
            createElement(TouchableOpacity, { onPress, disabled, accessibilityLabel: 'send-button' }, createElement(Text, null, title)),
        GradientCard: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
        SwipeButton: forwardRef((props: any, ref: any) => {
            useImperativeHandle(ref, () => ({ reset: mockSwipe.reset }));
            mockSwipe.onToggle = props.onToggle;
            return createElement(View);
        }),
    };
});
jest.mock('@Cypher/assets/images', () => ({ __esModule: true, Check: 1, Edit: 1 }));
jest.mock('@Cypher/helpers', () => ({ __esModule: true, dispatchNavigate: jest.fn(), isIOS: false }));
jest.mock('@Cypher/helpers/coinosHelper', () => ({
    __esModule: true,
    getStrikeCurrency: () => '$',
    formatNumber: (n: number) => String(n),
}));
jest.mock('@Cypher/helpers/bitcoinUnits', () => ({ __esModule: true, btc: (n: number) => n * 1e-8 }));
jest.mock('react-native-elements', () => ({ __esModule: true, Icon: () => null }));
jest.mock('@react-navigation/native', () => ({
    __esModule: true,
    useNavigation: () => ({ dispatch: jest.fn() }),
    CommonActions: { reset: jest.fn() },
}));
jest.mock('react-native-simple-toast', () => ({
    __esModule: true,
    default: { show: (...args: unknown[]) => mockToast(...args), SHORT: 0, LONG: 1 },
}));

const PHANTOM = `${'9ca5'.repeat(16)}:0`;
const SPENT = {
    message: 'BarkError.Internal',
    inner: { errorMessage: `error making payment: bad user input: vtxo ${PHANTOM} is not spendable (state: spent)` },
};
const vss = loc.cypherbox.services.vtxo_spend_state;
const SPENT_COPY = { title: vss.spent_title, body: vss.spent_body };

const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());

let alertSpy: jest.SpyInstance;

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockSwipe.onToggle = null;
    mockEstimateArkSendFee.mockResolvedValue({
        feeSats: 200,
        grossAmountSats: 50_200,
        netAmountSats: 50_000,
        vtxosSpent: [PHANTOM],
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('ArkSendReviewScreen', () => {
    async function sendWith(err: unknown): Promise<ReactTestRenderer> {
        mockExecuteArkSend.mockRejectedValue(err);
        let tree: ReactTestRenderer | undefined;
        await act(async () => {
            tree = renderer.create(
                <ArkSendReviewScreen route={{ params: { destinationRaw: 'ark1qexample', amountSats: 50_000 } }} />,
            );
            await flush();
        });
        const [button] = (tree as ReactTestRenderer).root.findAll((n) => n.props.accessibilityLabel === 'send-button');
        await act(async () => {
            await button.props.onPress();
            await flush();
        });
        return tree as ReactTestRenderer;
    }

    it('records a refused capsule and shows the app\'s words, not the server string', async () => {
        mockRecordAndDescribe.mockResolvedValue(SPENT_COPY);
        const tree = await sendWith(SPENT);
        expect(mockExecuteArkSend).toHaveBeenCalledTimes(1);
        expect(mockRecordAndDescribe).toHaveBeenCalledWith(SPENT);
        expect(text(tree)).toContain(vss.spent_body);
        expect(text(tree)).not.toMatch(/not spendable|state: spent|bad user input/);
    });

    it('keeps its own failure message for anything else', async () => {
        mockRecordAndDescribe.mockResolvedValue(null);
        const tree = await sendWith(new Error('insufficient funds'));
        expect(text(tree)).toContain(loc.cypherbox.ark.send_review.send_failed);
        expect(text(tree)).not.toContain(vss.spent_body);
    });

    it('never treats an outcome that may still be in flight as a refusal', async () => {
        const inFlight = Object.assign(new Error('This payment may still be in flight.'), { arkSendIndeterminate: true });
        const tree = await sendWith(inFlight);
        expect(mockRecordAndDescribe).not.toHaveBeenCalled();
        expect(text(tree)).toContain('This payment may still be in flight.');
    });
});

describe('ArkWithdrawReviewScreen', () => {
    async function withdrawWith(err: unknown): Promise<void> {
        mockExecuteArkSend.mockRejectedValue(err);
        await act(async () => {
            renderer.create(
                <ArkWithdrawReviewScreen
                    route={{
                        params: {
                            destinationKind: 'hot',
                            destinationAddress: 'bc1qexampleaddressforthehotvault',
                            arkBalanceSats: 100_000,
                            reserveSats: 0,
                            prefillSats: 50_000,
                            matchedRate: 0,
                            currency: 'USD',
                        },
                    }}
                />,
            );
            await flush();
        });
        expect(mockSwipe.onToggle).not.toBeNull();
        await act(async () => {
            await mockSwipe.onToggle!(true);
            await flush();
        });
    }

    it('records a refused capsule and explains it in an alert', async () => {
        mockRecordAndDescribe.mockResolvedValue(SPENT_COPY);
        await withdrawWith(SPENT);
        expect(mockExecuteArkSend).toHaveBeenCalledTimes(1);
        expect(mockRecordAndDescribe).toHaveBeenCalledWith(SPENT);
        expect(alertSpy).toHaveBeenCalledWith(vss.spent_title, vss.spent_body);
        expect(mockToast).not.toHaveBeenCalled();
        // A refusal is a definite outcome, so the control is re-armed.
        expect(mockSwipe.reset).toHaveBeenCalled();
    });

    it('keeps its own failure toast for anything else', async () => {
        mockRecordAndDescribe.mockResolvedValue(null);
        await withdrawWith(new Error('insufficient funds'));
        expect(alertSpy).not.toHaveBeenCalled();
        expect(mockToast).toHaveBeenCalledWith(
            expect.stringContaining(loc.cypherbox.ark.withdraw_review.withdraw_failed),
            expect.anything(),
        );
        expect(mockSwipe.reset).toHaveBeenCalled();
    });
});
