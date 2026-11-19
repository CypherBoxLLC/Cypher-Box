import b58 from 'bs58check';

// xpub/ypub/zpub/Ypub/Zpub and their testnet forms, alone or inside an output descriptor
const EXTENDED_PUBLIC_KEY = /[xyzYZtuvUV]pub[1-9A-HJ-NP-Za-km-z]{100,112}/;

/** The extended public key in an xpub-style string or an output descriptor, or null. */
export function extractExtendedPublicKey(text: string | null | undefined): string | null {
    const match = typeof text === 'string' ? text.match(EXTENDED_PUBLIC_KEY) : null;
    return match ? match[0] : null;
}

/**
 * True when two extended public keys are the same account key. The prefix (xpub, ypub, zpub...) only says which
 * address type to derive, so it is ignored: the chain code and public key are what identify the key.
 *
 * Used to notice a "Cold Vault" that is really this phone's Hot Vault watched from the same phone.
 */
export function sameAccountKey(a: string | null | undefined, b: string | null | undefined): boolean {
    const keyA = extractExtendedPublicKey(a);
    const keyB = extractExtendedPublicKey(b);
    if (!keyA || !keyB) return false;
    try {
        const hexA = Buffer.from(b58.decode(keyA)).toString('hex');
        const hexB = Buffer.from(b58.decode(keyB)).toString('hex');
        if (hexA.length !== 156 || hexB.length !== 156) return false;
        // 4 version, 1 depth, 4 parent fingerprint, 4 child number (13 bytes = 26 hex), then 32 chain code and 33
        // public key. Compared as hex: in the app's JS engine Buffer.subarray can return a plain Uint8Array,
        // which has no .equals()
        return hexA.slice(26) === hexB.slice(26);
    } catch (_) {
        return false;
    }
}
