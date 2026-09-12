import { Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';

/**
 * Primary (biometry-gated) Ark seed entry.
 *
 * MUST match ArkSeedPhraseScreen / RecoverArkScreen / recover.ts / reset.ts /
 * walletHandle.ts. If these drift, the next session cannot unlock the seed.
 */
const KEYCHAIN_SERVICE = 'ark-seed-phrase';
const KEYCHAIN_ACCOUNT = 'ark';

/**
 * `STORAGE_TYPE.RSA` is the user-authentication-bound Android Keystore cipher.
 * Read defensively: the constant is a real runtime export today
 * (react-native-keychain index.js), but this is seed-handling code and a
 * missing constant must not turn into `undefined !== undefined` and quietly
 * pass the gate below.
 */
const RSA_STORAGE: string =
    (Keychain as unknown as { STORAGE_TYPE?: { RSA?: string } }).STORAGE_TYPE?.RSA ??
    'KeystoreRSAECB';

export type SaveArkSeedResult =
    | { ok: true }
    | { ok: false; kind: 'no-biometric-gate'; storage: string }
    | { ok: false; kind: 'error'; reason: string };

/**
 * Write the Ark seed to the biometry-gated keychain entry, and refuse to leave
 * an un-gated copy behind.
 *
 * Why this exists: `BIOMETRY_ANY_OR_DEVICE_PASSCODE` is a REQUEST, not a
 * guarantee. react-native-keychain chooses a cipher storage at write time
 * (KeychainModule.java: `useBiometry && (isFingerprintAuthAvailable() || ...)`,
 * each of which requires a Class 3 STRONG biometric). With no strong biometric
 * enrolled it silently falls back from KeystoreRSAECB (user-auth-bound) to
 * KeystoreAESCBC (NOT auth-bound) and still resolves successfully.
 *
 * That is reachable on real devices: Samsung face unlock is Class 2 WEAK, and
 * there is a window right after a lock-screen change where canAuthenticate()
 * fails. The previous code treated a resolved promise as proof the seed sat
 * behind biometrics, so a mnemonic could end up readable with no prompt by
 * anyone holding the unlocked phone, while the UI recorded it as protected.
 *
 * On a downgrade we delete the entry we just wrote and report it, rather than
 * keeping an un-gated seed the user never agreed to. Callers must surface the
 * `no-biometric-gate` case instead of recording the save as successful.
 */
export async function saveArkSeedToKeychain(mnemonic: string): Promise<SaveArkSeedResult> {
    const seed = (mnemonic ?? '').trim();
    if (!seed) {
        // Guard before the write. The old call sites passed `mnemonic || ""`,
        // which stored an empty string and reported success.
        return { ok: false, kind: 'error', reason: 'empty mnemonic' };
    }

    let written: false | { storage?: string };
    try {
        written = (await Keychain.setGenericPassword(KEYCHAIN_ACCOUNT, seed, {
            service: KEYCHAIN_SERVICE,
            accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
            accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
        })) as false | { storage?: string };
    } catch (err: any) {
        return { ok: false, kind: 'error', reason: err?.message ?? String(err) };
    }

    if (!written) {
        return { ok: false, kind: 'error', reason: 'keychain write returned false' };
    }

    // Android only. On iOS the Keychain enforces the access control itself and
    // reports storage 'keychain', so there is no silent downgrade to detect.
    if (Platform.OS === 'android') {
        const storage = written.storage ?? 'unknown';
        if (storage !== RSA_STORAGE) {
            console.warn(
                '[Ark seed] biometric gate NOT applied (storage=', storage,
                '). Removing the un-gated entry rather than storing an unprotected seed.',
            );
            try {
                await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
            } catch (resetErr) {
                // Best effort. Reported either way, so the caller never claims
                // the seed is protected when it is not.
                console.warn('[Ark seed] failed to remove un-gated entry:', resetErr);
            }
            return { ok: false, kind: 'no-biometric-gate', storage };
        }
    }

    return { ok: true };
}
