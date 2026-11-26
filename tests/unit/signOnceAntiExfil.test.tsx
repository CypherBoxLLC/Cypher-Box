/**
 * The signing screen with a Cold Vault's verified-signing request, in Offline Seed-Signer mode from a backup: the
 * transaction inside is reviewed as a plain one is, the review says the Cold Vault will check the signature, and
 * signing takes the two extra hops (this phone's commitment shown, the Cold Vault's reply scanned) before the signed
 * transaction is shown, as a code the Cold Vault verifies. A reply to another exchange is refused and the commitment
 * stays up. The Cold Vault's side runs here through its own helpers. The seed is the public "abandon ... about" phrase.
 */

import React from 'react';
import { Text as RNText, TextInput, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';

import ecc from '../../blue_modules/noble_ecc';
import SignOnce from '../../src/screens/SignOnce';
import useAuthStore from '../../src/stores/authStore';
import { hostCommitStep, hostRevealStep, hostVerifyStep, HostSession } from '../../src/helpers/antiExfilController';
import { decodeAntiExfilMessage } from '../../src/helpers/antiExfilTransport';
import loc from '../../loc';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../src/stores/index', () => ({
    __esModule: true,
    zustandStorage: {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
    },
}));
jest.mock('../../blue_modules/storage-context', () => {
    const { createContext } = require('react');
    return { BlueStorageContext: createContext({ wallets: [] }) };
});
jest.mock('@Cypher/component-library', () => {
    const { Text } = require('react-native');
    return { ScreenLayout: ({ children }: any) => children, Text };
});
jest.mock('@Cypher/components/OfflineSeedWarning', () => () => null);
jest.mock('@Cypher/components/SigningPhoneStatus', () => () => null);
jest.mock('../../components/DynamicQRCode', () => ({ DynamicQRCode: () => null }));
// the animated code as a plain node, so the text it carries can be read back
jest.mock('@Cypher/components/AntiExfilCode', () => {
    const { createElement } = require('react');
    return (props: any) => createElement('AntiExfilCode', props);
});
jest.mock('../../src/custom-hooks/useProtectSecret', () => () => {});
jest.mock('../../src/custom-hooks/useElectrumConnection', () => () => 'no-answer');
jest.mock('../../helpers/scan-qr', () => ({ requestCameraAuthorization: () => Promise.resolve() }));
jest.mock('react-native-simple-toast', () => ({ show: () => {}, SHORT: 0 }));

const crypto = require('crypto');

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const root = BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(PHRASE));
const ACCOUNT = "m/84'/0'/0'";
const fingerprint = Buffer.from(root.fingerprint);
const other = BIP32Factory(ecc).fromSeed(Buffer.alloc(64, 7)).derivePath(`${ACCOUNT}/0/0`);
const p2wpkh = (pubkey: Buffer) => bitcoin.payments.p2wpkh({ pubkey });

function unsignedPsbt(): bitcoin.Psbt {
    const psbt = new bitcoin.Psbt();
    const path = `${ACCOUNT}/0/3`;
    const pubkey = Buffer.from(root.derivePath(path).publicKey);
    psbt.addInput({
        hash: Buffer.alloc(32, 0xb3),
        index: 1,
        witnessUtxo: { script: p2wpkh(pubkey).output as Buffer, value: 250000 },
        bip32Derivation: [{ masterFingerprint: fingerprint, path, pubkey }],
    });
    psbt.addOutput({ address: p2wpkh(Buffer.from(other.publicKey)).address as string, value: 200000 });
    return psbt;
}

const randomness = () => Uint8Array.from(crypto.randomBytes(32));
const decodeOk = (raw: string) => {
    const r = decodeAntiExfilMessage(raw);
    if (r.kind !== 'ok') throw new Error(`expected an ok message, got ${r.kind}`);
    return r.message;
};

const textOf = (node: renderer.ReactTestInstance) =>
    node.findAllByType(RNText).map(t => [].concat(t.props.children).filter(c => typeof c === 'string').join('')).join('\n');
const codeShown = (node: renderer.ReactTestInstance): string => {
    const codes = node.findAllByType('AntiExfilCode' as any);
    expect(codes).toHaveLength(1);
    return codes[0].props.value;
};
const press = async (node: renderer.ReactTestInstance, label: RegExp) => {
    const button = node.findAllByType(TouchableOpacity).find(b => label.test(textOf(b)));
    if (!button) throw new Error(`no button ${label}`);
    await act(async () => {
        await button.props.onPress();
    });
};

/** The screen, started with what was scanned, and the navigation it gets: the scanner hands its result back through
 * the params it was opened with. */
const open = (scanned: string) => {
    const navigate = jest.fn();
    const navigation = { goBack: jest.fn(), navigate, getParent: () => ({ pop: jest.fn() }) };
    let tree: renderer.ReactTestRenderer;
    act(() => {
        tree = renderer.create(<SignOnce route={{ params: { psbt: scanned } }} navigation={navigation} />);
    });
    const scanResult = async (data: string) => {
        const call = navigate.mock.calls.filter(c => c[0] === 'ScanQRCodeRoot').pop();
        if (!call) throw new Error('the scanner was not opened');
        await act(async () => {
            await call[1].params.onBarScanned({ data });
        });
    };
    return { root: tree!.root, scanResult };
};

/** From the request to the review, from the backup. */
const reviewFromBackup = async (request: string) => {
    const opened = open(request);
    expect(textOf(opened.root)).toContain(loc.cypherbox.sign_once.backup_title);
    const words = opened.root.findAllByType(TextInput).find(i => /12 or 24 words/.test(i.props.placeholder))!;
    act(() => words.props.onChangeText(PHRASE));
    await press(opened.root, /^Continue$/);
    expect(textOf(opened.root)).toContain(loc.cypherbox.sign_once.review_title);
    return opened;
};

beforeEach(() => {
    act(() => useAuthStore.setState({ signingMode: true, signerWallets: {}, walletID: '', signedOnThisPhone: false }));
});

describe('verified signing on the signing phone', () => {
    it('reviews the transaction inside the request, commits, signs on the reply, and the Cold Vault verifies', async () => {
        const unsigned = unsignedPsbt();
        const host1 = hostCommitStep(unsigned.toBase64(), randomness);
        const { root, scanResult } = await reviewFromBackup(host1.message);

        const review = textOf(root);
        expect(review).toContain(loc.cypherbox.anti_exfil.signer.review_note);
        expect(review).toContain('200,000 sats');
        expect(review).toContain('50,000 sats');

        await press(root, /^Sign$/);
        const shown = textOf(root);
        expect(shown).toContain(loc.cypherbox.anti_exfil.signer.open_title);
        const openMessage = decodeOk(codeShown(root));
        expect(openMessage.hop).toBe('open');
        expect(openMessage.sessionId).toBe(host1.session.id);

        const host2 = hostRevealStep(openMessage, host1.session);
        await press(root, new RegExp(`^${loc.cypherbox.anti_exfil.signer.scan_reply}$`));
        await scanResult(host2.message);

        const signed = textOf(root);
        expect(signed).toContain(loc.cypherbox.sign_once.signed_title);
        expect(signed).toContain(loc.cypherbox.anti_exfil.signer.signed_body);
        expect(signed).toContain(loc.cypherbox.sign_once.not_saved);
        // the Cold Vault takes the result by scan only
        expect(signed).not.toContain(loc.cypherbox.sign_once.copy);
        expect(signed).not.toContain(loc.cypherbox.sign_once.save_file);

        const signMessage = decodeOk(codeShown(root));
        expect(signMessage.hop).toBe('sign');
        const verdict = hostVerifyStep(signMessage, host2.session);
        expect(verdict.verdict).toBe('ok');
        expect(useAuthStore.getState().signedOnThisPhone).toBe(true);
    });

    it("refuses a reply to another exchange and keeps this phone's commitment up", async () => {
        const unsigned = unsignedPsbt();
        const host1 = hostCommitStep(unsigned.toBase64(), randomness);
        const { root, scanResult } = await reviewFromBackup(host1.message);
        await press(root, /^Sign$/);
        const openMessage = decodeOk(codeShown(root));

        // the Cold Vault started over: its reply belongs to a new exchange
        const restarted = hostCommitStep(unsigned.toBase64(), randomness);
        const foreign: HostSession = { ...restarted.session, perInput: restarted.session.perInput.map(p => ({ ...p, openingHex: openMessage.openings![0] })), stage: 'revealed' };
        const reply = hostRevealStep({ ...openMessage, sessionId: restarted.session.id }, restarted.session);
        void foreign;

        await press(root, new RegExp(`^${loc.cypherbox.anti_exfil.signer.scan_reply}$`));
        await scanResult(reply.message);
        const shown = textOf(root);
        expect(shown).toContain(loc.cypherbox.anti_exfil.signer.errors.wrong_reply);
        expect(shown).toContain(loc.cypherbox.anti_exfil.signer.open_title);
        expect(decodeOk(codeShown(root)).sessionId).toBe(host1.session.id);
    });

    it('refuses a damaged request where a transaction is scanned', async () => {
        const { root } = open('AEFX1:' + Buffer.from('{"v":1,"h":"commit"}').toString('base64'));
        expect(textOf(root)).toContain(loc.cypherbox.anti_exfil.signer.errors.damaged);
        expect(textOf(root)).toContain(loc.cypherbox.sign_once.scan_title);
    });

    it('refuses a request from a newer version with the update message', async () => {
        const { root } = open('AEFX2:' + Buffer.from('{}').toString('base64'));
        expect(textOf(root)).toContain(loc.cypherbox.anti_exfil.signer.errors.newer_version);
    });
});
