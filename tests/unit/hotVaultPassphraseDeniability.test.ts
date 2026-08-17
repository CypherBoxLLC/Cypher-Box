/**
 * The keychain sidecar must never record, or report, whether a vault has a
 * BIP39 passphrase.
 *
 * A passphrase is a deniability tool. Its whole value is that nobody can tell
 * the hidden wallet exists: under duress you hand over twelve words and the
 * wallet they open is the only wallet anyone can see.
 *
 * The sidecar used to carry `hasPassphrase`, on the reasoning that it "reveals
 * only that protection exists, never the protection itself". That reveal is the
 * leak. Recovery read the flag and announced "This vault is passphrase-
 * protected" before prompting, so anyone holding the unlocked phone (which,
 * under duress, is the premise) learned a second wallet existed.
 *
 * These tests pin both halves: nothing writes the flag, and a legacy flag
 * written by an older build is dropped on read rather than surfaced, so no
 * future caller can branch on it.
 */

const mockSetGenericPassword = jest.fn();
const mockGetGenericPassword = jest.fn();

jest.mock('react-native-keychain', () => ({
    __esModule: true,
    setGenericPassword: mockSetGenericPassword,
    getGenericPassword: mockGetGenericPassword,
    resetGenericPassword: jest.fn(),
    getAllGenericPasswordServices: jest.fn(async () => []),
    ACCESS_CONTROL: { BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'bio' },
    ACCESSIBLE: { WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'whenPasscodeSet' },
}));

import {
    backupHotVaultMeta,
    backupHotVaultSeedWithMeta,
    getHotVaultMeta,
} from '../../src/services/hotVaultKeychain';

const WALLET_ID = 'a'.repeat(64);
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** The JSON actually handed to the keychain for the meta sidecar. */
function writtenMetaPayloads(): string[] {
    return mockSetGenericPassword.mock.calls
        .filter((c) => String(c[2]?.service ?? '').startsWith('hot-vault-meta'))
        .map((c) => String(c[1]));
}

beforeEach(() => {
    jest.clearAllMocks();
    mockSetGenericPassword.mockResolvedValue(true);
});

describe('the sidecar never records a passphrase flag', () => {
    it('omits it when writing meta directly', async () => {
        await backupHotVaultMeta(WALLET_ID, { createdAt: 1_700_000_000_000, label: null });
        const payloads = writtenMetaPayloads();
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).not.toMatch(/passphrase/i);
        expect(JSON.parse(payloads[0])).not.toHaveProperty('hasPassphrase');
    });

    it('omits it on the seed+meta convenience path used at vault creation', async () => {
        await backupHotVaultSeedWithMeta(WALLET_ID, MNEMONIC, { createdAt: 1_700_000_000_000 });
        for (const payload of writtenMetaPayloads()) {
            expect(payload).not.toMatch(/passphrase/i);
            expect(JSON.parse(payload)).not.toHaveProperty('hasPassphrase');
        }
    });

    it('cannot be coaxed into writing it by a caller that still passes one', async () => {
        // Defence against a future caller reintroducing the field. The type no
        // longer permits it, so this casts past the compiler the way a stale
        // call site would.
        await backupHotVaultMeta(WALLET_ID, {
            createdAt: 1_700_000_000_000,
            label: null,
            hasPassphrase: true,
        } as any);
        expect(writtenMetaPayloads()[0]).not.toMatch(/passphrase/i);
    });

    it('still writes the fields the picker legitimately needs', async () => {
        await backupHotVaultMeta(WALLET_ID, { createdAt: 1_700_000_000_000, label: 'vault' });
        const parsed = JSON.parse(writtenMetaPayloads()[0]);
        expect(parsed).toMatchObject({ version: 1, createdAt: 1_700_000_000_000, label: 'vault' });
    });
});

describe('a legacy passphrase flag is dropped on read', () => {
    it('does not surface hasPassphrase from an older sidecar', async () => {
        // Written by a build that still recorded the flag. Reading it back must
        // not hand any caller something to branch on.
        mockGetGenericPassword.mockResolvedValue({
            username: WALLET_ID,
            password: JSON.stringify({
                version: 1,
                createdAt: 1_700_000_000_000,
                label: null,
                hasPassphrase: true,
            }),
        });
        const meta = await getHotVaultMeta(WALLET_ID);
        expect(meta).not.toBeNull();
        expect(meta).not.toHaveProperty('hasPassphrase');
        expect((meta as any)?.hasPassphrase).toBeUndefined();
    });

    it('still returns the harmless fields from a legacy sidecar', async () => {
        mockGetGenericPassword.mockResolvedValue({
            username: WALLET_ID,
            password: JSON.stringify({
                version: 1,
                createdAt: 42,
                label: 'old vault',
                hasPassphrase: true,
            }),
        });
        const meta = await getHotVaultMeta(WALLET_ID);
        expect(meta).toMatchObject({ version: 1, createdAt: 42, label: 'old vault' });
    });
});
