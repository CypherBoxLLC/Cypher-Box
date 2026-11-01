import * as bitcoin from 'bitcoinjs-lib';

import { assertSignedTxMatchesPsbt } from './signedTransaction';

/**
 * A cold vault spend that was exported for signing on another device and not broadcast yet.
 *
 * Signing is a physical step away from the app (scan a QR on the device, or carry a file over), and the in-flow
 * "scan or import the signed transaction" screen is gone if the app is closed meanwhile. Keeping this lets the vault
 * tab offer to resume, and lets a signed transaction brought in from there be checked against what the user reviewed,
 * exactly as it is inside the flow. It holds the unsigned transaction and what the screens show about it, no keys,
 * and lives in the encrypted settings store.
 */
export interface PendingSignature {
    /** the unsigned PSBT, base64 */
    psbt: string;
    /** epoch ms the user was first shown it */
    createdAt: number;
    // shown again by the signing, confirm and success screens on resume
    sats?: number;
    inUSD?: string;
    sentFrom?: string;
    destinationAddress?: string;
    networkFees?: number | string;
    serviceFees?: number | string;
    totalFees?: number | string;
    isCustomFee?: boolean;
    memo?: string;
    to?: string | null;
}

export type PendingDescription =
    | { kind: 'consolidate'; capsules: number; sats: number }
    | { kind: 'send'; sats: number; address: string | null };

const toPsbt = (psbt: bitcoin.Psbt | string): bitcoin.Psbt =>
    typeof psbt === 'string' ? bitcoin.Psbt.fromBase64(psbt) : psbt;

const outpoint = (hash: Buffer | Uint8Array, index: number) => `${Buffer.from(hash).reverse().toString('hex')}:${index}`;

const outpoints = (psbt: bitcoin.Psbt) => psbt.txInputs.map(input => outpoint(input.hash, input.index));

/**
 * Builds the entry from the signing screen's route params. Only plain data is kept: the wallet object is looked up
 * again by id on resume.
 */
export function createPendingSignature(params: any, now = Date.now()): PendingSignature {
    const { psbt, sats, inUSD, sentFrom, destinationAddress, networkFees, serviceFees, totalFees, isCustomFee, memo, to } = params;
    return {
        psbt: toPsbt(psbt).toBase64(),
        createdAt: now,
        sats,
        inUSD,
        sentFrom,
        destinationAddress,
        networkFees,
        serviceFees,
        totalFees,
        isCustomFee,
        memo,
        to: to ?? null,
    };
}

/** Same unsigned transaction, whatever signatures either copy has picked up since. */
export function sameUnsignedTransaction(a: bitcoin.Psbt | string, b: bitcoin.Psbt | string): boolean {
    const key = (psbt: bitcoin.Psbt) =>
        JSON.stringify([
            psbt.version,
            psbt.locktime,
            psbt.txInputs.map(input => [outpoint(input.hash, input.index), input.sequence]),
            psbt.txOutputs.map(output => [output.script.toString('hex'), output.value]),
        ]);
    try {
        return key(toPsbt(a)) === key(toPsbt(b));
    } catch (_) {
        return false;
    }
}

/** Route params that put the user back into the signing flow for this entry. */
export function resumeParams(pending: PendingSignature, wallet: any) {
    const shown: Partial<PendingSignature> = { ...pending };
    delete shown.createdAt;
    return { ...shown, psbt: bitcoin.Psbt.fromBase64(pending.psbt), fromWallet: wallet, walletID: wallet.getID() };
}

/** True when a signed transaction is exactly the pending one (same inputs, outputs, version and locktime). */
export function signedTxMatchesPending(txHex: string, pending: PendingSignature): boolean {
    try {
        assertSignedTxMatchesPsbt(txHex, pending.psbt);
        return true;
    } catch (_) {
        return false;
    }
}

/** True when a transaction spends any capsule the pending one spends: after it confirms the pending one can't. */
export function spendsPendingInputs(txHex: string, pending: PendingSignature): boolean {
    try {
        const spent = new Set(bitcoin.Transaction.fromHex(txHex.trim()).ins.map(input => outpoint(input.hash, input.index)));
        return outpoints(toPsbt(pending.psbt)).some(o => spent.has(o));
    } catch (_) {
        return false;
    }
}

/**
 * True when a capsule the pending transaction spends is no longer among the wallet's unspent outputs, i.e. it was
 * spent some other way. An empty list proves nothing (not fetched yet, or the vault really is empty), so it never
 * marks anything spent.
 */
export function pendingInputsSpent(pending: PendingSignature, utxos: { txid: string; vout: number }[]): boolean {
    if (!utxos?.length) return false;
    try {
        const unspent = new Set(utxos.map(u => `${u.txid}:${u.vout}`));
        return outpoints(toPsbt(pending.psbt)).some(o => !unspent.has(o));
    } catch (_) {
        return false;
    }
}

/**
 * What the pending transaction does, for the vault tab. Outputs back to this vault are change; if every output is,
 * the transaction only merges capsules.
 */
export function describePending(pending: PendingSignature, isOwnAddress: (address: string) => boolean): PendingDescription {
    const psbt = toPsbt(pending.psbt);
    const outputs = psbt.txOutputs.map(output => {
        let address: string | null = null;
        try {
            address = bitcoin.address.fromOutputScript(output.script);
        } catch (_) {
            // OP_RETURN or a non-standard script: never ours
        }
        return { address, value: output.value };
    });
    const paid = outputs.filter(o => !o.address || !isOwnAddress(o.address));
    if (!paid.length) {
        return { kind: 'consolidate', capsules: psbt.txInputs.length, sats: outputs.reduce((sum, o) => sum + o.value, 0) };
    }
    return { kind: 'send', sats: paid.reduce((sum, o) => sum + o.value, 0), address: paid[0].address };
}

export const formatSats = (sats: number) => `${String(Math.round(sats)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} sats`;

/** "just now", "5 min ago", "3 h ago", "2 days ago" */
export function formatAge(ms: number): string {
    const minutes = Math.floor(Math.max(0, ms) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
}
