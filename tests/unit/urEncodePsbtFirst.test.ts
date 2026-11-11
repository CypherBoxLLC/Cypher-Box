/**
 * A signed transaction's animated QR: encoding a PSBT mustn't touch BlueWallet's wallet classes. Loading them runs an
 * elliptic-curve self-test for each, and on an Offline Seed-Signer, where nothing had loaded them, that held the
 * signed transaction's QR back 11 s on a Galaxy A14. The wallet classes are stood in for here by an object that notes
 * every class asked for.
 */

import { encodeUR } from '../../blue_modules/ur';

jest.mock('../../class', () => {
    const asked: string[] = [];
    return new Proxy(
        { asked },
        {
            get: (target, name) => {
                if (name === 'asked') return target.asked;
                if (typeof name === 'string' && /^[A-Z]/.test(name)) asked.push(name);
                return undefined;
            },
        },
    );
});

const fixtures = require('./fixtures/multisig-signer/fixtures.json');

describe('encodeUR', () => {
    it('makes a PSBT into crypto-psbt parts without the wallet classes', () => {
        const parts = encodeUR(fixtures.psbts.w1Spend.unsignedHex, 200);
        expect(parts.length).toBeGreaterThan(1);
        expect(parts.every((p: string) => p.startsWith('ur:crypto-psbt/'))).toBe(true);
        expect(require('../../class').asked).toEqual([]);
    });
});
