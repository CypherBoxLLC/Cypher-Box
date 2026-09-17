/**
 * Minimal declarations for crypto-js, which ships none.
 *
 * Only the members we call are typed. Everything else stays `any` through the
 * index signature, so existing callers of AES, PBKDF2 and friends are
 * unaffected by this file.
 *
 * Note on SHA3: crypto-js implements the original Keccak padding, which is what
 * Tron and Ethereum use, not the later FIPS-202 variant. A unit test pins that.
 */
declare module 'crypto-js' {
    interface WordArray {
        words: number[];
        sigBytes: number;
        toString(encoder?: unknown): string;
    }

    interface Encoder {
        parse(text: string): WordArray;
        stringify(words: WordArray): string;
    }

    const CryptoJS: {
        SHA256(message: WordArray | string): WordArray;
        SHA3(message: WordArray | string, config?: { outputLength?: number }): WordArray;
        HmacSHA256(message: WordArray | string, key: WordArray | string): WordArray;
        enc: {
            Hex: Encoder;
            Utf8: Encoder;
            Base64: Encoder;
            [encoding: string]: Encoder;
        };
        lib: {
            WordArray: {
                create(words: number[] | Uint8Array, sigBytes?: number): WordArray;
            };
        };
        // Everything else keeps the behaviour it had before this file existed:
        // untyped. Narrowing it to unknown broke callers of AES and PBKDF2.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [member: string]: any;
    };

    export = CryptoJS;
}
