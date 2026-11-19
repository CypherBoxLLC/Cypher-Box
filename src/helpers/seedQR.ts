import * as bip39 from 'bip39';
// @ts-ignore: qrcode ships no type definitions (react-native-qrcode-svg uses the same library)
import QRCode from 'qrcode';

import { backupToMnemonic } from './signOnce';

/**
 * SeedQR (SeedSigner's open format, also read by Jade and Krux): a recovery phrase drawn as a QR code so it can be
 * scanned instead of typed. The standard form used here writes each word as its 4-digit index in the English BIP39
 * word list, which phone cameras read as plain digits. Error correction L, so 12 words make a 25×25 grid and 24 words
 * a 29×29 grid, the sizes the paper and steel templates are printed for.
 *
 * The passphrase is never part of a SeedQR.
 */

export interface SeedQRGrid {
    /** squares per side */
    size: number;
    /** row by row, true for a filled square */
    filled: boolean[];
}

/** The digits of a standard SeedQR. Throws for a phrase that isn't valid English BIP39. */
export function mnemonicToSeedQR(mnemonic: string): string {
    const wordlist = bip39.wordlists.english;
    const words = backupToMnemonic(mnemonic).split(' ');
    return words.map(word => String(wordlist.indexOf(word)).padStart(4, '0')).join('');
}

export function seedQRGrid(digits: string): SeedQRGrid {
    const qr = QRCode.create(digits, { errorCorrectionLevel: 'L' });
    const { size, data } = qr.modules;
    return { size, filled: Array.from(data, (bit: number) => bit === 1) };
}

/**
 * Whether a scanned SeedQR holds the same recovery phrase. A hand-copied grid that scans as other digits or fails the
 * phrase's checksum comes back false. A grid with a few wrong squares can still come back true, because the scanner
 * repairs them with the code's error correction before this sees the digits.
 */
export function seedQRMatches(scanned: string, mnemonic: string): boolean {
    try {
        return backupToMnemonic(String(scanned)) === backupToMnemonic(mnemonic);
    } catch (_) {
        return false;
    }
}
