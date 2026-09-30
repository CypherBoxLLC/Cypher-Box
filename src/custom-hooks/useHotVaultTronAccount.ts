import { useEffect, useState } from 'react';

import {
    type SeedBearingWallet,
    loadHotVaultTronAccount,
    peekHotVaultTronAccount,
} from '@Cypher/services/tron/account';
import type { TronAccount } from '@Cypher/services/tron/keys';

type Loaded = {
    readonly wallets: readonly SeedBearingWallet[] | null | undefined;
    readonly walletID: string | null | undefined;
    readonly account: TronAccount | null;
    readonly error: unknown;
};

/**
 * The Hot Vault's Tron account, without freezing the screen to get it.
 *
 * Answers at once when this session already has the account, and otherwise
 * derives it natively and renders again. `pending` is true until the answer is
 * known, which is not the same as having no account: the USDT card hides
 * itself without one, and hiding while pending would make it jump in a moment
 * later.
 *
 * A phrase that is not a valid mnemonic throws here, during render, as the
 * synchronous derivation always did, rather than quietly reading as no
 * account.
 */
export default function useHotVaultTronAccount(
    wallets: readonly SeedBearingWallet[] | null | undefined,
    walletID: string | null | undefined,
    enabled: boolean = true,
): { account: TronAccount | null; pending: boolean } {
    const known = enabled ? peekHotVaultTronAccount(wallets, walletID) : null;
    const [loaded, setLoaded] = useState<Loaded | null>(null);

    useEffect(() => {
        if (known !== undefined) {
            return undefined;
        }
        let alive = true;
        loadHotVaultTronAccount(wallets, walletID).then(
            account => {
                if (alive) setLoaded({ wallets, walletID, account, error: null });
            },
            error => {
                if (alive) setLoaded({ wallets, walletID, account: null, error });
            },
        );
        return () => {
            alive = false;
        };
    }, [known, wallets, walletID]);

    if (known !== undefined) {
        return { account: known, pending: false };
    }
    if (loaded && loaded.wallets === wallets && loaded.walletID === walletID) {
        if (loaded.error) {
            throw loaded.error;
        }
        return { account: loaded.account, pending: false };
    }
    return { account: null, pending: true };
}
