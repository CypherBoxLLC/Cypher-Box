import * as bitcoin from 'bitcoinjs-lib';

const PSBT_HEX_MAGIC = '70736274ff';

export const SIGNED_TX_MISMATCH =
    "The signed transaction doesn't match the one you reviewed, so it was not accepted. Sign it again on your device.";
export const SIGNED_TX_INVALID = "This doesn't look like a signed transaction.";

export interface SignedTxOutput {
    address: string | null;
    value: number;
}

export interface SignedTxSummary {
    outputs: SignedTxOutput[];
    fee: number | null;
}

/**
 * True when scanned or imported data is a raw transaction in hex, rather than a PSBT (base64 or hex).
 */
export function isRawTransactionHex(data: string): boolean {
    const trimmed = data.trim();
    return /^[0-9a-fA-F]+$/.test(trimmed) && !trimmed.toLowerCase().startsWith(PSBT_HEX_MAGIC);
}

const toPsbt = (psbt: bitcoin.Psbt | string): bitcoin.Psbt =>
    typeof psbt === 'string' ? bitcoin.Psbt.fromBase64(psbt) : psbt;

export type ImportedTransaction = { txhex: string } | { psbt: bitcoin.Psbt };

/**
 * Sorts a transaction imported into a watch-only vault, from a file or a QR code, by what it still needs.
 * A finished one (raw hex, or a PSBT with every signature in) comes back as `txhex`, ready to broadcast;
 * a PSBT still missing signatures comes back untouched as `psbt`, to be signed. Throws SIGNED_TX_INVALID
 * for anything else. extractTransaction's own error (for example an absurd fee) is passed through.
 */
export function parseImportedTransaction(data: string): ImportedTransaction {
    const trimmed = data.trim();
    if (isRawTransactionHex(trimmed)) {
        try {
            bitcoin.Transaction.fromHex(trimmed);
        } catch (_) {
            throw new Error(SIGNED_TX_INVALID);
        }
        return { txhex: trimmed };
    }

    let psbt: bitcoin.Psbt;
    try {
        psbt = trimmed.toLowerCase().startsWith(PSBT_HEX_MAGIC) ? bitcoin.Psbt.fromHex(trimmed) : bitcoin.Psbt.fromBase64(trimmed);
    } catch (_) {
        throw new Error(SIGNED_TX_INVALID);
    }

    // finalize a copy, so a PSBT that turns out to be missing signatures is passed on as it came
    const finished = bitcoin.Psbt.fromBase64(psbt.toBase64());
    try {
        finished.data.inputs.forEach((input, i) => {
            if (!input.finalScriptSig && !input.finalScriptWitness) finished.finalizeInput(i);
        });
    } catch (_) {
        return { psbt };
    }
    return { txhex: finished.extractTransaction().toHex() };
}

/**
 * Decodes a raw transaction returned by an external signer and checks it spends exactly the inputs and pays
 * exactly the outputs of the PSBT the user reviewed. Throws otherwise, so a substituted transaction is never
 * broadcast. Signatures are not checked here; the network rejects invalid ones.
 */
export function assertSignedTxMatchesPsbt(txHex: string, psbt: bitcoin.Psbt | string): bitcoin.Transaction {
    if (!psbt) throw new Error(SIGNED_TX_MISMATCH);
    const reviewed = toPsbt(psbt);

    let tx: bitcoin.Transaction;
    try {
        tx = bitcoin.Transaction.fromHex(txHex.trim());
    } catch (_) {
        throw new Error(SIGNED_TX_INVALID);
    }

    const ins = reviewed.txInputs;
    const outs = reviewed.txOutputs;
    const sameInputs =
        tx.ins.length === ins.length &&
        tx.ins.every((input, i) => input.hash.equals(ins[i].hash) && input.index === ins[i].index && input.sequence === ins[i].sequence);
    const sameOutputs =
        tx.outs.length === outs.length && tx.outs.every((output, i) => output.value === outs[i].value && output.script.equals(outs[i].script));

    if (tx.version !== reviewed.version || tx.locktime !== reviewed.locktime || !sameInputs || !sameOutputs) {
        throw new Error(SIGNED_TX_MISMATCH);
    }
    return tx;
}

const inputValue = (psbt: bitcoin.Psbt, i: number): number | null => {
    const input = psbt.data.inputs[i];
    if (input.witnessUtxo) return input.witnessUtxo.value;
    if (input.nonWitnessUtxo) {
        const prevOut = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo).outs[psbt.txInputs[i].index];
        return prevOut ? prevOut.value : null;
    }
    return null;
};

/**
 * Decodes a signed transaction locally for display: every output's address and amount, plus the fee when the
 * PSBT carries the input amounts. Pass the PSBT only after assertSignedTxMatchesPsbt has accepted the transaction.
 */
export function summarizeSignedTx(txHex: string, psbt?: bitcoin.Psbt | string): SignedTxSummary {
    const tx = bitcoin.Transaction.fromHex(txHex.trim());
    const outputs = tx.outs.map(output => {
        let address: string | null = null;
        try {
            address = bitcoin.address.fromOutputScript(output.script);
        } catch (_) {
            // OP_RETURN or a non-standard script: no address to show
        }
        return { address, value: output.value };
    });

    let fee: number | null = null;
    if (psbt) {
        const reviewed = toPsbt(psbt);
        const values = tx.ins.map((_, i) => inputValue(reviewed, i));
        if (values.every(v => v !== null)) {
            const totalIn = values.reduce((sum: number, v) => sum + (v as number), 0);
            const totalOut = outputs.reduce((sum, o) => sum + o.value, 0);
            fee = totalIn - totalOut;
        }
    }
    return { outputs, fee };
}
