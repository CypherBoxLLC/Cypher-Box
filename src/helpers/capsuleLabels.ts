import loc from '../../loc';

// Labels for capsules (on-chain UTXOs). A label is stored as the capsule's
// UTXO memo (BlueWallet's setUTXOMetadata), so it shows in the vault's
// Capsules tab and in coin control like a label typed there.

/** Long enough for every preset at once in both languages, short enough for the Capsules list. */
export const MAX_CAPSULE_LABEL_LENGTH = 50;

export type CapsulePreset = {
    key: 'kyc' | 'kyc_free' | 'p2p' | 'exchange' | 'income' | 'gift';
    text: string;
    /** presets this one takes out of the label when picked */
    excludes: string[];
};

/** The preset labels the capsule-received popup offers, in the app's language. */
export function capsulePresetLabels(): CapsulePreset[] {
    const kyc = loc.cypherbox.components.capsule_received.presets.kyc;
    const kycFree = loc.cypherbox.components.capsule_received.presets.kyc_free;
    return [
        { key: 'kyc', text: kyc, excludes: [kycFree] },
        { key: 'kyc_free', text: kycFree, excludes: [kyc] },
        { key: 'p2p', text: loc.cypherbox.components.capsule_received.presets.p2p, excludes: [] },
        { key: 'exchange', text: loc.cypherbox.components.capsule_received.presets.exchange, excludes: [] },
        { key: 'income', text: loc.cypherbox.components.capsule_received.presets.income, excludes: [] },
        { key: 'gift', text: loc.cypherbox.components.capsule_received.presets.gift, excludes: [] },
    ];
}

// A label may join several parts with Latin or Arabic commas.
const PART_SEPARATOR = /[,،]/;
const EDGE_SEPARATORS = /^[\s,،]+|[\s,،]+$/g;

export const labelParts = (label: string): string[] =>
    label
        .split(PART_SEPARATOR)
        .map(part => part.trim())
        .filter(Boolean);

const samePart = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

export const labelHasPreset = (label: string, preset: string): boolean => labelParts(label).some(part => samePart(part, preset));

/**
 * Adds a preset to the label, or takes it out when it is already there. Adding
 * one also takes out the presets it excludes, so KYC and KYC-free never sit together.
 */
export function togglePresetLabel(label: string, preset: string, excludes: string[] = [], separator = ', '): string {
    const parts = labelParts(label);
    if (parts.some(part => samePart(part, preset))) {
        return parts.filter(part => !samePart(part, preset)).join(separator);
    }
    return [...parts.filter(part => !excludes.some(other => samePart(part, other))), preset].join(separator);
}

/**
 * The label as it gets saved: single spaces, no stray commas at the ends, at most
 * MAX_CAPSULE_LABEL_LENGTH characters, cut between characters so an emoji stays whole.
 */
export const cleanCapsuleLabel = (label: string): string =>
    Array.from(label.replace(/\s+/g, ' ').replace(EDGE_SEPARATORS, ''))
        .slice(0, MAX_CAPSULE_LABEL_LENGTH)
        .join('')
        .trim();

export type LabelableWallet = {
    setUTXOMetadata(txid: string, vout: number, opts: { memo?: string }): void;
};

/**
 * Saves the label as the capsule's memo and writes the wallets to disk. Throws
 * on an empty label, and passes on a failed save so the popup can say so.
 */
export async function saveCapsuleLabel(
    wallet: LabelableWallet,
    txid: string,
    vout: number,
    label: string,
    saveToDisk: () => Promise<unknown>,
): Promise<string> {
    const memo = cleanCapsuleLabel(label);
    if (!memo) throw new Error('empty capsule label');
    wallet.setUTXOMetadata(txid, vout, { memo });
    await saveToDisk();
    return memo;
}
