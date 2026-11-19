/**
 * How the app shows a destination or a receive string.
 *
 * Addresses (on-chain, Bark, Liquid) and Lightning addresses (name@domain) are shown in full. The user checks an
 * address character by character, and one cut to its first and last characters is exactly what a look-alike address
 * imitates. A Lightning invoice, offer or LNURL runs to hundreds of characters and is checked by its amount and
 * payee instead, so it keeps a short start…end form.
 */

// BOLT11 invoices (lnbc, lntb, lntbs, lnbcrt, lnsb), BOLT12 offers, requests and invoices (lno1, lnr1, lni1) and
// LNURL, with or without a lightning: prefix, in either case
const LIGHTNING_REQUEST = /^(lightning:)?ln(bc|tb|sb|url|o1|r1|i1)/i;

export function isLightningRequest(value: unknown): boolean {
    return LIGHTNING_REQUEST.test(String(value ?? '').trim());
}

export function displayDestination(value: unknown): string {
    const text = String(value ?? '').trim();
    if (!isLightningRequest(text) || text.length <= 30) return text;
    return `${text.slice(0, 12)}…${text.slice(-8)}`;
}

type TxOutput = { scriptPubKey?: { addresses?: string[] } } | null | undefined;

/**
 * The address a vault transaction paid, for its history details: on a receive, the output that came to the vault, and
 * on a send, the first output that left it. A transaction's outputs are in no set order, so the first one can be the
 * sender's change, someone else's address shown as "Received to". Falls back to the first output when the vault can't
 * tell.
 */
export function paidOutputAddress(
    outputs: readonly TxOutput[] | undefined,
    ownsAddress: (address: string) => boolean,
    isSent: boolean,
): string | undefined {
    const addresses = (outputs ?? []).map(o => o?.scriptPubKey?.addresses?.[0]).filter((a): a is string => !!a);
    const owns = (address: string) => {
        try {
            return ownsAddress(address);
        } catch {
            return false;
        }
    };
    return (isSent ? addresses.find(a => !owns(a)) : addresses.find(owns)) ?? addresses[0];
}
