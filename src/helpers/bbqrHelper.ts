// BBQr helper for parsing xpub/PSBT from QR codes
import { detectFileType, joinQRs } from 'bbqr';

interface BBQrResult {
    isBBQr: boolean;
    fileType?: string;
    data?: string;
    raw?: Uint8Array;
}

/**
 * Check if scanned QR data is BBQr format
 * BBQr format typically starts with header like "BBQR:" or specific pattern
 */
export const isBBQrFormat = (data: string): boolean => {
    if (!data) return false;
    
    // BBQr QR codes typically have these patterns:
    // - Start with "BBQR" or "BBQr"
    // - Multi-part QR codes with format like "BBQr:P0/1#..."
    const trimmed = data.trim().toUpperCase();
    return trimmed.startsWith('BBQR') || 
           trimmed.startsWith('BBQR:') ||
           /^BBQR:P\d+\/\d+/.test(trimmed) ||   // PSBT multi-part
           /^BBQr:P\d+\/\d+/.test(trimmed);
};

/**
 * Try to detect file type from BBQr data
 */
export const detectBBQrFileType = (data: string): BBQrResult => {
    try {
        const detected = detectFileType(data);
        return {
            isBBQr: true,
            fileType: detected.fileType,
            data: data,
            raw: detected.raw,
        };
    } catch (e) {
        // Not BBQr format or parse error
        return { isBBQr: false };
    }
};

/**
 * Check if data is a valid xpub (standard or BBQr encoded)
 */
export const isValidXpub = (data: string): boolean => {
    const trimmed = data.trim().toLowerCase();
    return trimmed.startsWith('xpub') || 
           trimmed.startsWith('ypub') || 
           trimmed.startsWith('zpub') ||
           trimmed.startsWith('vpub') ||  // testnet
           trimmed.startsWith('upub') ||
           trimmed.startsWith('zpub');
};

/**
 * Extract xpub from various formats
 */
export const extractXpub = (data: string): string | null => {
    // First try direct xpub
    const xpubMatch = data.match(/(xpub|ypub|zpub|vpub|upub|ypub)[a-zA-Z0-9]+/i);
    if (xpubMatch) {
        return xpubMatch[0];
    }
    
    return null;
};
