import * as bip39 from 'bip39';

/**
 * Thrown when a freshly MINTED mnemonic fails a sanity check, which means the
 * entropy source that produced it is broken. Used to refuse a weak seed rather
 * than store it. Only ever applied to newly generated seeds, never to a seed
 * the user typed or scanned to recover (that path validates the checksum on its
 * own and must not reject the user's own words).
 */
/** Shown translated through src/helpers/safetyErrorText. */
export const SEED_UNSAFE_MESSAGE =
    'The wallet could not be created safely on this device. Please try again, and if this keeps happening, contact support.';

export class SeedUnsafeError extends Error {
    readonly reason: string;
    constructor(reason: string) {
        super(SEED_UNSAFE_MESSAGE);
        this.name = 'SeedUnsafeError';
        this.reason = reason;
    }
}

const BIP39_WORD_COUNTS = [12, 15, 18, 21, 24];

/**
 * Validate a newly generated BIP39 mnemonic before it is used or stored.
 *
 * Catches a broken entropy source from ANY generator (the bark Rust core, the
 * physical-dice path, or the JS CSPRNG): a wrong word count, an invalid
 * checksum, or underlying entropy that is a single repeated byte. The last is
 * what a stuck or zeroed source produces (for example the all-zero entropy
 * "abandon abandon ... about" vector). It does NOT apply a statistical test, so
 * a real mnemonic never trips it.
 *
 * @throws {SeedUnsafeError}
 */
export function assertMnemonicHealthy(mnemonic: string): void {
    const trimmed = (mnemonic ?? '').trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (!BIP39_WORD_COUNTS.includes(words.length)) {
        throw new SeedUnsafeError('bad-word-count');
    }
    if (!bip39.validateMnemonic(trimmed)) {
        throw new SeedUnsafeError('bad-checksum');
    }
    let entropyHex: string;
    try {
        entropyHex = bip39.mnemonicToEntropy(trimmed);
    } catch {
        throw new SeedUnsafeError('entropy-decode-failed');
    }
    const bytes = Buffer.from(entropyHex, 'hex');
    if (bytes.length === 0 || bytes.every(b => b === bytes[0])) {
        throw new SeedUnsafeError('constant-entropy');
    }
}

/**
 * Generate an Ark/Bark mnemonic (Rust core) and validate it before returning.
 * The Rust core's RNG is separate from the JS CSPRNG, so this is the only
 * health gate on the Ark seed. Throws {@link SeedUnsafeError} on a degenerate
 * result; callers surface that as a refusal to create the wallet.
 */
export function generateCheckedArkMnemonic(barkGenerateMnemonic: () => string): string {
    const mnemonic = barkGenerateMnemonic();
    assertMnemonicHealthy(mnemonic);
    return mnemonic;
}
