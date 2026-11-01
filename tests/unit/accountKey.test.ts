/**
 * A Cold Vault made from this phone's own Hot Vault key is not cold storage. Spotting that means recognising the same
 * account key whichever prefix it was exported with.
 */

import b58 from 'bs58check';
import { extractExtendedPublicKey, sameAccountKey } from '../../src/helpers/accountKey';

// BIP84 test vector account key (public "abandon ... about" mnemonic), as published in BIP84
const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

const withVersion = (key: string, version: number) => {
    const data = Buffer.from(b58.decode(key));
    data.writeUInt32BE(version, 0);
    return b58.encode(data);
};

const XPUB = withVersion(ZPUB, 0x0488b21e);

const otherKey = () => {
    const data = Buffer.from(b58.decode(ZPUB));
    data[20] ^= 0xff; // a different chain code
    return b58.encode(data);
};

describe('sameAccountKey', () => {
    it('matches the same key exported as zpub and as xpub', () => {
        expect(sameAccountKey(ZPUB, XPUB)).toBe(true);
    });

    it('finds the key inside a descriptor', () => {
        expect(sameAccountKey(`wpkh([73c5da0a/84h/0h/0h]${XPUB}/0/*)`, ZPUB)).toBe(true);
    });

    it('tells different keys apart', () => {
        expect(sameAccountKey(ZPUB, otherKey())).toBe(false);
    });

    it('is false for anything that is not a key', () => {
        expect(sameAccountKey(ZPUB, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')).toBe(false);
        expect(sameAccountKey(undefined, ZPUB)).toBe(false);
        expect(extractExtendedPublicKey('hello')).toBeNull();
    });
});
