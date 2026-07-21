import Clipboard from '@react-native-clipboard/clipboard';

/**
 * Sensitive clipboard copy with best-effort auto-clear.
 *
 * Seed phrases and private keys copied to the system clipboard would
 * otherwise persist there indefinitely, readable by any other app on the
 * device. After `clearAfterMs` we clear the clipboard, but only if it still
 * holds exactly what we put there (never clobber the user's later copies).
 * iOS 14+ additionally shows a paste notification to the user; the clear is
 * best-effort on both platforms since another app may have read it already.
 */
const DEFAULT_CLEAR_AFTER_MS = 60000;

export function copySensitiveToClipboard(text: string, clearAfterMs: number = DEFAULT_CLEAR_AFTER_MS): void {
  Clipboard.setString(text);
  setTimeout(() => {
    Clipboard.getString()
      .then(current => {
        if (current === text) {
          Clipboard.setString('');
        }
      })
      .catch(() => {
        // best-effort only; never throw from a timer
      });
  }, clearAfterMs);
}
