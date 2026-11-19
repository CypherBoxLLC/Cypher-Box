/**
 * What a failed Bark create means for the seed screen: show the error, or offer "Reset & retry".
 *
 * Kept free of imports so the decision can be tested without the Bark SDK.
 */

/** `code` of the error createArkWallet throws when a vault's datadir is already on disk. */
export const ARK_VAULT_EXISTS = 'ARK_VAULT_EXISTS';

/**
 * bark's errors for "a datadir is on disk and this seed can't open it": Internal / Database (0-byte or schema residue)
 * and "incorrect mnemonic" (a datadir made with a different seed, left by a create that died mid-flight).
 */
const STALE_DATADIR = /Internal|InvalidMnemonic|Database|incorrect mnemonic/i;

export type ArkLiveState = {
  /** a wallet handle is open */
  handleOpen: boolean;
  /** the auth store has loaded, so isArkAuth means what it says */
  storeLoaded: boolean;
  /** a vault is recorded in the app */
  isArkAuth: boolean;
};

/**
 * Should the seed screen offer "Reset & retry" for this create failure?
 *
 * bark's stale-datadir errors: yes, as before.
 *
 * The one-vault refusal (ARK_VAULT_EXISTS): only when the datadir is a leftover, judged the way CreateArkScreen's
 * auto-clean and RecoverArkScreen judge it: no handle open, the store loaded, and no vault recorded. A create that dies
 * after writing the datadir but before the vault is recorded (an app crash, or Android killing the app while Google
 * sign-in or the folder picker is open) leaves exactly that. The create entry points (Add a Lightning Wallet, the Home
 * Bark card) go straight to the seed screen and never pass CreateArkScreen, so every later create was refused with
 * "Delete it in Vault settings" and there was no vault to delete. A real vault keeps the refusal.
 */
export function offersArkReset(err: unknown, live: ArkLiveState): boolean {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  if (e.code === ARK_VAULT_EXISTS) return !live.handleOpen && live.storeLoaded && !live.isArkAuth;
  return STALE_DATADIR.test(String(e.message ?? ''));
}
