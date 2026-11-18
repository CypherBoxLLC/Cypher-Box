import loc from '../../loc';
import { ENTROPY_UNSAFE_MESSAGE } from '../../class/rngHealth';
import { SEED_UNSAFE_MESSAGE } from '../../class/seedHealth';
import { NONCE_REUSE_MESSAGE, SIGNATURE_INVALID_MESSAGE } from '../../class/signatureAudit';

/**
 * The wallet's safety checks (class/rngHealth, class/seedHealth, class/signatureAudit) throw in English, for logs and
 * tests. These put them in the app's language where they're shown. Anything else is returned as it is, or the
 * fallback when there's no message at all.
 */
export function safetyMessageText(message: string): string {
    const t = loc.cypherbox.safety_checks;
    const known: Record<string, string> = {
        [ENTROPY_UNSAFE_MESSAGE]: t.rng_unavailable,
        [SEED_UNSAFE_MESSAGE]: t.seed_unsafe,
        [NONCE_REUSE_MESSAGE]: t.signing_stopped,
        [SIGNATURE_INVALID_MESSAGE]: t.signature_invalid,
    };
    return known[message] ?? message;
}

export default function safetyErrorText(e: unknown, fallback = ''): string {
    const message = (e as { message?: unknown } | null)?.message;
    return typeof message === 'string' && message ? safetyMessageText(message) : fallback;
}
