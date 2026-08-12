import { assertNoActiveArkExit } from './exit';
import { getArkWalletHandle } from './walletHandle';

/**
 * Cooperative on-chain offboard of SPECIFIC VTXOs (coin control).
 *
 * Unlike `sendOnchain(address, amount)` (amount-based, SDK auto-selects inputs),
 * `offboardVtxos(vtxoIds, address)` moves exactly the VTXOs we name on-chain to
 * `address`. Used by the stuck-refresh rescue screen to move precisely the
 * near-expiry capsules to a Hot / Cold vault or an external Bitcoin address.
 * The offboard fee is taken from the moved amount (see `estimateArkOffboardFee`).
 *
 * Requires the ASP to cooperate on the offboard (same as any non-exit path); if
 * the ASP is fully down the caller should fall back to a Lightning swap or the
 * unilateral exit. Not for the "server is malicious" case (that is exit.ts).
 */
function requireHandle() {
    const handle = getArkWalletHandle();
    if (!handle) throw new Error('Ark wallet not open, cannot offboard');
    return handle;
}

export type ArkOffboardFeeView = {
    /** Offboard fee in sats (taken out of the moved amount). */
    feeSats: number;
    /** Amount that lands on-chain after the fee. */
    netSats: number;
    /** Total value of the VTXOs being offboarded (net + fee). */
    grossSats: number;
    /** The VTXO ids the SDK will spend for this offboard. */
    vtxosSpent: string[];
};

export async function estimateArkOffboardFee(
    address: string,
    vtxoIds: string[],
): Promise<ArkOffboardFeeView> {
    assertNoActiveArkExit();
    const handle = requireHandle();
    const est = await handle.estimateOffboardFee(address.trim(), vtxoIds);
    return {
        feeSats: Number(est.feeSats),
        netSats: Number(est.netAmountSats),
        grossSats: Number(est.grossAmountSats),
        vtxosSpent: est.vtxosSpent,
    };
}

/**
 * Offboard the named VTXOs on-chain to `address`. Returns the broadcast txid.
 */
export async function offboardArkVtxos(
    vtxoIds: string[],
    address: string,
): Promise<string> {
    assertNoActiveArkExit();
    const handle = requireHandle();
    return await handle.offboardVtxos(vtxoIds, address.trim());
}
