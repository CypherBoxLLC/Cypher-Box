import {
    DEFAULT_WALLET_NAME,
    NOT_AN_ADDRESS,
    OWN_KEY_DIFFERENT,
    WALLET_FILE_BAD_CHECKSUM,
    WALLET_FILE_BSMS_VERSION,
    WALLET_FILE_DUPLICATE_KEY,
    WALLET_FILE_ENCRYPTED,
    WALLET_FILE_FIRST_ADDRESS,
    WALLET_FILE_NO_FINGERPRINT,
    WALLET_FILE_NO_FORMAT,
    WALLET_FILE_NO_ORIGIN,
    WALLET_FILE_NO_POLICY,
    WALLET_FILE_NOT_P2WSH,
    WALLET_FILE_PATHS,
    WALLET_FILE_PRIVATE,
    WALLET_FILE_SEED,
    WALLET_FILE_SINGLE_KEY,
    WALLET_FILE_TESTNET,
    WALLET_FILE_UNREADABLE,
} from '@Cypher/helpers';
import loc from '../../../loc';
import signErrorText from '../SignOnce/errorText';

/** As blue_modules/fs's openWalletFile throws them (tests/unit/multisigSignerArabic checks they still match). */
export const WALLET_FILE_TOO_BIG = 'That file is too big to be a wallet file.';
export const WALLET_FILE_NOT_READ = "That file couldn't be read.";

/**
 * A multisig wallet file or address error in the app's language. helpers/multisigPolicy throws in English, and its
 * tests match on that text, so it's translated here, where it's shown, like the signing errors (SignOnce/errorText).
 * Anything else, such as a mistyped recovery phrase, goes on to the signing errors.
 */
export default function walletErrorText(message: string): string {
    const t = loc.cypherbox.seed_signer.multisig.wallet_file;
    const known: Record<string, string> = {
        [WALLET_FILE_UNREADABLE]: t.unreadable,
        [WALLET_FILE_SINGLE_KEY]: t.single_key,
        [WALLET_FILE_SEED]: t.seed,
        [WALLET_FILE_PRIVATE]: t.private,
        [WALLET_FILE_NOT_P2WSH]: t.not_p2wsh,
        [WALLET_FILE_TESTNET]: t.testnet,
        [WALLET_FILE_BAD_CHECKSUM]: t.bad_checksum,
        [WALLET_FILE_NO_FORMAT]: t.no_format,
        [WALLET_FILE_NO_POLICY]: t.no_policy,
        [WALLET_FILE_NO_ORIGIN]: t.no_origin,
        [WALLET_FILE_PATHS]: t.paths,
        [WALLET_FILE_ENCRYPTED]: t.encrypted,
        [WALLET_FILE_BSMS_VERSION]: t.bsms_version,
        [WALLET_FILE_FIRST_ADDRESS]: t.first_address,
        [WALLET_FILE_DUPLICATE_KEY]: t.duplicate_key,
        [WALLET_FILE_NO_FINGERPRINT]: t.no_fingerprint,
        [OWN_KEY_DIFFERENT]: t.own_key_different,
        [NOT_AN_ADDRESS]: t.not_an_address,
        [WALLET_FILE_TOO_BIG]: t.too_big,
        [WALLET_FILE_NOT_READ]: t.not_read,
    };
    if (known[message]) return known[message];
    const format = (text: string, values: Record<string, string>) => String(loc.formatString(text, values));
    let m = /^Key (\d+) in this wallet isn't a valid public key, or its details don't match its derivation path\.$/.exec(message);
    if (m) return format(t.bad_key, { n: m[1] });
    m = /^This wallet file says (\d+) of (\d+), but lists (\d+) keys?\.$/.exec(message);
    if (m) return m[3] === '1' ? format(t.key_count_one, { m: m[1], n: m[2] }) : format(t.key_count, { m: m[1], n: m[2], count: m[3] });
    m = /^This wallet has (\d+) keys?\. The signer works with multisig wallets of 2 to (\d+) keys\.$/.exec(message);
    if (m) return m[1] === '1' ? format(t.size_one, { max: m[2] }) : format(t.size, { n: m[1], max: m[2] });
    m = /^This wallet needs (\S+) of (\d+) signatures, which can't work\.$/.exec(message);
    if (m) return format(t.threshold, { m: m[1], n: m[2] });
    m = /^Two keys in this wallet have the same fingerprint \(([0-9a-fA-F]{8})\)\. Each key of a multisig should come from its own seed\.$/.exec(message);
    if (m) return format(t.same_fingerprint, { fingerprint: m[1] });
    m = /^This seed \(fingerprint ([0-9a-fA-F]{8})\) isn't one of this wallet's keys\. Check the SeedQR, and the passphrase if you use one\.$/.exec(message);
    if (m) return format(t.own_key_missing, { fingerprint: m[1] });
    return signErrorText(message);
}

/** A wallet's name as shown: the one given to a wallet file that has none is in the app's language. */
export const walletName = (name: string) => (name === DEFAULT_WALLET_NAME ? loc.cypherbox.seed_signer.multisig.default_name : name);
