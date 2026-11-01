import useAuthStore from "@Cypher/stores/authStore";
import { dispatchNavigate } from "@Cypher/helpers";

/** Runs `then` straight away, or after the one-time "Signing safely" guide on a phone that hasn't seen it yet. */
export function afterSigningGuide(then: () => void) {
    const { signingSafetySeen, setSigningSafetySeen } = useAuthStore.getState();
    if (signingSafetySeen) {
        then();
        return;
    }
    setSigningSafetySeen(true);
    dispatchNavigate('SigningSafetyGuide', { onContinue: then });
}

/**
 * Opens the sign-once screen, after the guide. Every way into signing goes through here: the empty Hot Vault card,
 * the home scan button, signing mode, and the Hot Vault's "Sign a transaction" in Settings and on the vault tab (which
 * opens the file picker or the scanner itself, then comes here with the transaction).
 */
export function startSigning(params: { psbt?: string; mode?: 'vault' } = {}) {
    afterSigningGuide(() => dispatchNavigate('SignOnce', params));
}
