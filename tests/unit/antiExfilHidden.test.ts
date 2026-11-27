/**
 * "Verify my signing phone" is hidden until the next release: the store never reports the switch on, not when it is
 * set and not from what an earlier build saved, so every reader (the Cold Vault's routing, the Vault tab's resume, the
 * import guard) keeps the plain flow; and the Cold Vault's transaction screen draws the switch only behind the flag.
 */

import fs from 'fs';
import path from 'path';

import useAntiExfilStore, { VERIFY_SIGNING_PHONE_AVAILABLE } from '../../src/stores/antiExfilStore';

// what the encrypted store holds, read only when the store rehydrates
const mockStorage: { saved: string | null } = { saved: null };
jest.mock('../../src/stores/index', () => ({
    __esModule: true,
    zustandStorage: {
        getItem: jest.fn(async () => mockStorage.saved),
        setItem: jest.fn(async () => undefined),
        removeItem: jest.fn(async () => undefined),
    },
}));

describe('verified signing hidden for this release', () => {
    it('is switched off at build time', () => {
        expect(VERIFY_SIGNING_PHONE_AVAILABLE).toBe(false);
    });

    it('never reports the switch on, even when set', () => {
        expect(useAntiExfilStore.getState().verifySigningPhone).toBe(false);
        useAntiExfilStore.getState().setVerifySigningPhone(true);
        expect(useAntiExfilStore.getState().verifySigningPhone).toBe(false);
    });

    it('ignores a switch an earlier build saved as on', async () => {
        mockStorage.saved = JSON.stringify({ state: { verifySigningPhone: true }, version: 0 });
        await useAntiExfilStore.persist.rehydrate();
        expect(useAntiExfilStore.getState().verifySigningPhone).toBe(false);
    });

    it('draws the switch only behind the flag, and keeps both signing routes for when it returns', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../src/screens/ColdStorage/index.tsx'), 'utf8');
        expect(source).toMatch(/\{VERIFY_SIGNING_PHONE_AVAILABLE && wallet\?\.type === WatchOnlyWallet\.type && \(/);
        expect(source).toMatch(/navigate\('AntiExfilVerify', signingParams\)/);
        expect(source).toMatch(/navigate\('HardwareWalletTransaction', signingParams\)/);
    });
});
