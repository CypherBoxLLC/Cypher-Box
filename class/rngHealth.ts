import { randomBytes } from './rng';

/**
 * Thrown when the device cannot supply cryptographically secure randomness, so
 * a key or seed must NOT be generated. Surfaced to the user as an actionable
 * refusal rather than silently minting a weak secret.
 *
 * Background: on React Native, `randomBytes` is backed by the native CSPRNG
 * (`react-native-randombytes` -> SecRandomCopyBytes / SecureRandom). If that
 * native module is not live, the library's weak sjcl fallback exists in the
 * source (though no code reaches it today). Rather than rely on that staying
 * true, we check the native source is present and returns sane bytes, and
 * refuse loudly if it is not.
 */
// Not "reinstall": on Android an uninstall deletes seeds held only in the Keystore. Shown translated through
// src/helpers/safetyErrorText.
export const ENTROPY_UNSAFE_MESSAGE =
    'Secure randomness is not available on this device, so a wallet cannot be created safely. Update the app, and if this keeps happening, contact support.';

export class EntropyUnsafeError extends Error {
    readonly reason: string;
    constructor(reason: string) {
        super(ENTROPY_UNSAFE_MESSAGE);
        this.name = 'EntropyUnsafeError';
        this.reason = reason;
    }
}

const allSameByte = (b: Buffer): boolean => b.length > 0 && b.every(x => x === b[0]);

export type RngHealth = { ok: true } | { ok: false; reason: string };

/**
 * Pure, testable core: given the native RNG module (or undefined) and a
 * byte-drawing function, decide whether the entropy source looks live.
 *
 * Deliberately catches only GROSS failure: a missing native module, a short
 * draw, all-constant output, or two identical draws. No statistical/bias test,
 * because real CSPRNG output must NEVER trip this (a false positive would block
 * wallet creation, which is its own disaster).
 */
export async function evaluateRngHealth(
    nativeModule: { randomBytes?: unknown } | undefined | null,
    draw: (n: number) => Promise<Buffer>,
): Promise<RngHealth> {
    if (!nativeModule || typeof nativeModule.randomBytes !== 'function') {
        return { ok: false, reason: 'native-rng-module-missing' };
    }
    let a: Buffer;
    let b: Buffer;
    try {
        a = await draw(32);
        b = await draw(32);
    } catch (e) {
        return { ok: false, reason: 'draw-threw' };
    }
    if (a.length !== 32 || b.length !== 32) return { ok: false, reason: 'short-draw' };
    if (allSameByte(a)) return { ok: false, reason: 'constant-output' };
    if (a.equals(b)) return { ok: false, reason: 'repeated-output' };
    return { ok: true };
}

let cachedOk = false;

/**
 * App-facing guard. On React Native, verifies the native CSPRNG is live and
 * returns sane bytes; throws {@link EntropyUnsafeError} (loudly, logging only a
 * reason code, never any bytes) if not. Under cli/tests (not React Native) the
 * Node crypto CSPRNG backs `randomBytes`, so this is a no-op. A passing verdict
 * is cached.
 *
 * Call at startup for an early, loud warning, and before any seed/key
 * generation so a broken RNG refuses to mint instead of silently degrading.
 */
export async function assertNativeRngHealthy(): Promise<void> {
    if (cachedOk) return;
    const nav = (globalThis as unknown as { navigator?: { product?: string } }).navigator;
    const isReactNative = typeof nav !== 'undefined' && nav.product === 'ReactNative';
    if (!isReactNative) {
        // cli / unit tests: randomBytes is backed by Node's crypto CSPRNG.
        cachedOk = true;
        return;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nativeModule = require('react-native').NativeModules.RNRandomBytes;
    const res = await evaluateRngHealth(nativeModule, randomBytes);
    if (!res.ok) {
        console.error('[RNG] secure randomness check FAILED:', res.reason);
        throw new EntropyUnsafeError(res.reason);
    }
    cachedOk = true;
}

/** Test-only reset of the cached verdict. */
export function __resetRngHealthForTest(): void {
    cachedOk = false;
}
