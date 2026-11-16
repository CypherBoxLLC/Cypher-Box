/** What a hidden balance shows instead of its figures. */
export const HIDDEN_AMOUNT = '***';

// One figure: digits, Western or Arabic-Indic, with the separators between them ("1,234.56", "1 234", "١٬٢٣٤٫٥").
const DIGIT = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]';
const SEPARATOR = "[.,'\\u066B\\u066C\\u00A0\\u202F ]";
// A K or M right after the figures goes too ("1.43M sats"): left behind, it would still tell the size.
const FIGURES = new RegExp(`${DIGIT}(?:(?:${DIGIT}|${SEPARATOR})*${DIGIT})?(?:[KM](?![A-Za-z]))?`, 'g');

/**
 * A formatted amount with its figures behind ***: "0.01234567 BTC" → "*** BTC", "$1,234.56" → "$***", "1.43M sats"
 * → "*** sats". The unit
 * stays, so the line still says what it hides. Text with no figures, or none at all, is just ***.
 */
export function maskAmount(text: string | number | false | null | undefined): string {
    if (text === false || text === null || text === undefined) return HIDDEN_AMOUNT;
    const value = String(text);
    const masked = value.replace(FIGURES, HIDDEN_AMOUNT);
    return masked === value ? HIDDEN_AMOUNT : masked;
}
