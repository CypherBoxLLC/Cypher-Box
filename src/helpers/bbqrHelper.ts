// BBQr helper for parsing xpub/PSBT from QR codes
// BBQr frame format: B$ + encoding(1) + fileType(1) + total(2 base36) + index(2 base36) + data
import { joinQRs } from 'bbqr';

/**
 * Check if scanned QR data is BBQr format.
 * BBQr frames always start with "B$".
 */
export const isBBQrFormat = (data: string): boolean => {
    if (!data || data.length < 8) return false;
    return data.startsWith('B$');
};

/**
 * Parse BBQr frame header to extract metadata.
 * Returns null if not a valid BBQr frame.
 */
export const parseBBQrHeader = (data: string): {
    encoding: string;
    fileType: string;
    total: number;
    index: number;
} | null => {
    if (!isBBQrFormat(data)) return null;
    try {
        const encoding = data[2]; // H, 2, or Z
        const fileType = data[3]; // P, T, J, U, B
        const total = parseInt(data.slice(4, 6), 36);
        const index = parseInt(data.slice(6, 8), 36);
        if (isNaN(total) || isNaN(index)) return null;
        return { encoding, fileType, total, index };
    } catch {
        return null;
    }
};

/**
 * Check if data is a valid xpub (standard formats).
 */
export const isValidXpub = (data: string): boolean => {
    const trimmed = data.trim().toLowerCase();
    return trimmed.startsWith('xpub') ||
           trimmed.startsWith('ypub') ||
           trimmed.startsWith('zpub') ||
           trimmed.startsWith('vpub') ||
           trimmed.startsWith('upub');
};

/**
 * Extract xpub from various formats.
 */
export const extractXpub = (data: string): string | null => {
    const xpubMatch = data.match(/(xpub|ypub|zpub|vpub|upub)[a-zA-Z0-9]+/i);
    return xpubMatch ? xpubMatch[0] : null;
};
