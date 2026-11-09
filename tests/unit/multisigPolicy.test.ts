/**
 * Registering a multisig wallet on the Offline Seed-Signer: reading the wallet file a coordinator exports, refusing
 * every kind of wallet the signer doesn't sign for, checking that the seed's key is in it, and finding addresses.
 *
 * Expected keys, addresses and checksums come from fixtures/multisig-signer, made with rust-bitcoin, rust-miniscript
 * and libsecp256k1 (see its generator), not with the code under test; the Sparrow and Nunchuk files are real exports
 * kept in fixtures/. All keys come from public BIP39 test phrases.
 */

import fs from 'fs';
import path from 'path';
import { Bytes, CryptoHDKey, CryptoKeypath, CryptoOutput, MultiKey, PathComponent, ScriptExpressions } from '@keystonehq/bc-ur-registry/dist';

import { BlueURDecoder } from '../../blue_modules/ur';
import { MultisigHDWallet } from '../../class';
import {
    ADDRESS_SEARCH_LIMIT,
    NOT_AN_ADDRESS,
    OWN_KEY_DIFFERENT,
    PolicyKey,
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
    addressFromText,
    confirmOwnKey,
    descriptorChecksum,
    findAddress,
    ownKeyMissing,
    parseWalletFile,
    policyAddress,
    policyDescriptor,
    policyKeyPubkey,
    policyWitnessScript,
    walletFileBadKey,
    walletFileKeyCount,
    walletFileSameFingerprint,
    walletFileSize,
    walletFileThreshold,
} from '../../src/helpers/multisigPolicy';
import { rootFromBackup } from '../../src/helpers/signOnce';
import { multisigKeyExpression } from '../../src/helpers/multisigKey';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));

const fixtures = require('./fixtures/multisig-signer/fixtures.json');
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const K = fixtures.keys;
const W1 = fixtures.wallets.w1;
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const LEGAL = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const ZOO = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const W1_KEYS: PolicyKey[] = [K.abandon, K.legal, K.letter];

/** A Coldcard-style wallet file, with a Derivation line before each key, as Nunchuk and Coldcard write them. */
const textFile = (keys: PolicyKey[], { m = 2, name = 'Family vault', header = '# Exported from Nunchuk', format = 'P2WSH' } = {}) =>
    [
        header,
        `Name: ${name}`,
        `Policy: ${m} of ${keys.length}`,
        `Format: ${format}`,
        '',
        ...keys.flatMap(k => [`Derivation: ${k.path}`, `${k.fingerprint.toUpperCase()}: ${k.xpub}`, '']),
    ].join('\n');

const descriptorOf = (keys: string[], m = 2) => {
    const body = `wsh(sortedmulti(${m},${keys.join(',')}))`;
    return `${body}#${descriptorChecksum(body)}`;
};
const keyExpr = (k: PolicyKey, suffix = '/<0;1>/*') => `[${k.fingerprint}${k.path.slice(1)}]${k.xpub}${suffix}`;

describe('reading wallet files', () => {
    const expectW1 = (policy: ReturnType<typeof parseWalletFile>) => {
        expect(policy.m).toBe(2);
        expect(policy.keys).toEqual(W1_KEYS);
        expect(policyAddress(policy, 0, 0)).toBe(W1.addresses.receive0);
        expect(policyAddress(policy, 1, 5)).toBe(W1.addresses.change5);
    };

    it('reads a Coldcard-style text file, one Derivation line per key, as Nunchuk writes it', () => {
        const policy = parseWalletFile(textFile(W1_KEYS));
        expectW1(policy);
        expect(policy.name).toBe('Family vault');
    });

    it('reads the same file with one Derivation line in the header, as Sparrow writes it', () => {
        const text = [
            '# Coldcard Multisig setup file (created by Sparrow)',
            '#',
            'Name: Family vault',
            'Policy: 2 of 3',
            "Derivation: m/48'/0'/0'/2'",
            'Format: P2WSH',
            '',
            ...W1_KEYS.map(k => `${k.fingerprint.toUpperCase()}: ${k.xpub}`),
        ].join('\r\n');
        expectW1(parseWalletFile(text));
    });

    it('reads the multipath descriptor, the receive and change pair, and the descriptor inside JSON', () => {
        const fromText = parseWalletFile(textFile(W1_KEYS));
        for (const text of [
            W1.descriptor,
            `${W1.receiveDescriptor}\n${W1.changeDescriptor}`,
            `# Receive and change\n${W1.descriptor}\n\n# Receive\n${W1.receiveDescriptor}\n# Change\n${W1.changeDescriptor}\n`,
            JSON.stringify({ label: 'Family vault', blockheight: 1, descriptor: W1.descriptor }),
            JSON.stringify({ wallet_name: 'Family vault', descriptors: [{ desc: W1.receiveDescriptor, internal: false }, { desc: W1.changeDescriptor, internal: true }] }),
        ]) {
            const policy = parseWalletFile(text);
            expectW1(policy);
            // the same wallet, however it was written
            expect(policy.id).toBe(fromText.id);
        }
    });

    it('gives the same id whatever order the keys are listed in', () => {
        const a = parseWalletFile(textFile(W1_KEYS));
        const b = parseWalletFile(textFile([K.letter, K.abandon, K.legal]));
        expect(b.id).toBe(a.id);
        expect(b.keys.map(k => k.fingerprint)).toEqual(['28645006', '73c5da0a', 'b8688df1']);
        expect(parseWalletFile(textFile(W1_KEYS, { m: 3 })).id).not.toBe(a.id);
    });

    it('reads real exports from Sparrow (Coldcard file and Specter JSON) and Nunchuk (BSMS)', () => {
        const real = fixtures.realExports;
        for (const name of ['fromsparrow-coldcard.txt', 'fromsparrow-specter.json']) {
            const policy = parseWalletFile(fixture(name));
            expect(policy.m).toBe(2);
            expect(policy.keys.map(k => k.fingerprint)).toEqual(['a3909080', '7ab71df0', 'f11b9ff2']);
            expect(policyAddress(policy, 0, 0)).toBe(real.sparrowReceive0);
            expect(policyAddress(policy, 0, 1)).toBe(real.sparrowReceive1);
            expect(policyAddress(policy, 1, 0)).toBe(real.sparrowChange0);
        }
        const nunchuk = parseWalletFile(fixture('nunchuck-bsms.txt'));
        expect(nunchuk.keys.map(k => [k.fingerprint, k.path])).toEqual([
            ['3f5e4e09', "m/48'/0'/0'"],
            ['b96bc7c7', "m/48'/0'/0'"],
            ['44437f41', "m/48'/0'/0'"],
        ]);
        expect(policyAddress(nunchuk, 0, 0)).toBe(real.nunchukReceive0);
        expect(policyAddress(nunchuk, 1, 0)).toBe(real.nunchukChange0);
    });

    it("reads BIP-129's own unencrypted descriptor record and checks its first address", () => {
        const bip129 = fixtures.bip129;
        const record = ['BSMS 1.0', bip129.template, '/0/*,/1/*', bip129.firstAddress].join('\n');
        const policy = parseWalletFile(record);
        expect(policy.keys.map(k => k.fingerprint)).toEqual(['1cf0bf7e', '4fc1dd4a']);
        expect(policyAddress(policy, 0, 1)).toBe(bip129.receive1);
        expect(policyAddress(policy, 1, 0)).toBe(bip129.change0);
        // the record's first address is part of the file: one that doesn't come from its keys is refused
        expect(() => parseWalletFile(['BSMS 1.0', bip129.template, '/0/*,/1/*', bip129.receive1].join('\n'))).toThrow(
            WALLET_FILE_FIRST_ADDRESS,
        );
        expect(() => parseWalletFile(['BSMS 2.0', bip129.template, '/0/*,/1/*', bip129.firstAddress].join('\n'))).toThrow(
            WALLET_FILE_BSMS_VERSION,
        );
        expect(() => parseWalletFile(['BSMS 1.0', bip129.template, '/0/*', bip129.firstAddress].join('\n'))).toThrow(WALLET_FILE_PATHS);
    });

    it("reads BlueWallet's own export, Zpub keys and \"# derivation\" comments included", () => {
        const w = new MultisigHDWallet();
        w.setSecret(textFile(W1_KEYS));
        w.setLabel('From BlueWallet');
        const policy = parseWalletFile(w.getXpub());
        expectW1(policy);
        expect(policy.name).toBe('From BlueWallet');

        // the multisig label for the same key data, and a per-key path comment
        const zpub = w.convertXpubToMultisignatureXpub(K.legal.xpub);
        expect(zpub.startsWith('Zpub')).toBe(true);
        const text = [
            'Name: Z',
            'Policy: 2 of 3',
            "Derivation: m/48'/0'/0'/2'",
            'Format: P2WSH',
            `73C5DA0A: ${K.abandon.xpub}`,
            `B8688DF1: ${zpub}`,
            `# derivation: ${K.letter.path}`,
            `28645006: ${K.letter.xpub}`,
        ].join('\n');
        expectW1(parseWalletFile(text));
    });

    it('gives each key the Derivation line above it, so mixed paths are read right', () => {
        const W3 = fixtures.wallets.w3;
        const keys = [K.abandonAccount5, K.legalAccount1, K.letter];
        const policy = parseWalletFile(textFile(keys));
        expect(policy.keys.map(k => k.path)).toEqual(["m/48'/0'/5'/2'", "m/48'/0'/1'/2'", "m/48'/0'/0'/2'"]);
        expect(policyAddress(policy, 0, 0)).toBe(W3.addresses.receive0);
        expect(policyAddress(policy, 1, 5)).toBe(W3.addresses.change5);
        expect(parseWalletFile(W3.descriptor).id).toBe(policy.id);
        // and the seed's own key is found at its own path
        expect(confirmOwnKey(policy, rootFromBackup(ABANDON)).path).toBe("m/48'/0'/5'/2'");
    });

    it('reads what the scanner makes of a UR crypto-output and of animated UR bytes', () => {
        // crypto-output: built with the same registry the scanner decodes with; its descriptor string has no brackets
        const hdKey = (k: PolicyKey) => {
            const node = require('bip32').BIP32Factory(require('../../blue_modules/noble_ecc').default).fromBase58(k.xpub);
            return new CryptoHDKey({
                isMaster: false,
                key: Buffer.from(node.publicKey),
                chainCode: Buffer.from(node.chainCode),
                origin: new CryptoKeypath(
                    [48, 0, 0, 2].map(index => new PathComponent({ index, hardened: true })),
                    Buffer.from(k.fingerprint, 'hex'),
                    4,
                ),
                children: new CryptoKeypath([new PathComponent({ index: 0, hardened: false }), new PathComponent({ hardened: false })]),
                parentFingerprint: Buffer.from(node.parentFingerprint.toString(16).padStart(8, '0'), 'hex'),
            } as any);
        };
        const output = new CryptoOutput(
            [ScriptExpressions.WITNESS_SCRIPT_HASH, ScriptExpressions.SORTED_MULTISIG],
            new MultiKey(2, W1_KEYS.map(hdKey)),
        );
        const scanned = (parts: string[]) => {
            const decoder = new BlueURDecoder();
            parts.forEach(p => decoder.receivePart(p));
            return decoder.toString();
        };
        const fromOutput = scanned([output.toUREncoder(2000).nextPart()]);
        expect(fromOutput.startsWith('wsh(sortedmulti(2,73c5da0a/48')).toBe(true);
        expectW1(parseWalletFile(fromOutput));

        // UR bytes, several animated parts, carrying the text file
        const encoder = new Bytes(Buffer.from(textFile(W1_KEYS))).toUREncoder(120);
        const parts = Array.from({ length: encoder.fragmentsLength }, () => encoder.nextPart());
        expect(parts.length).toBeGreaterThan(1);
        expectW1(parseWalletFile(scanned(parts)));

    });

    it('keeps names readable and short', () => {
        expect(parseWalletFile(textFile(W1_KEYS, { name: '  Savings\u202e  2026\u0007 ' })).name).toBe('Savings 2026');
        expect(parseWalletFile(textFile(W1_KEYS, { name: 'x'.repeat(80) })).name).toHaveLength(40);
        expect(parseWalletFile(W1.descriptor).name).toBe('Multisig wallet');
        expect(parseWalletFile(textFile(W1_KEYS, { name: 'Vault: main' })).name).toBe('Vault: main');
    });
});

describe('refusing what the signer does not sign for', () => {
    const refuses = (text: string, message: string | RegExp) => expect(() => parseWalletFile(text)).toThrow(message);

    it('refuses Taproot, miniscript, keys in a fixed order, and wrapped or legacy multisig', () => {
        const keys = W1_KEYS.map(k => keyExpr(k, '/0/*'));
        refuses(textFile(W1_KEYS, { format: 'P2TR' }), WALLET_FILE_NOT_P2WSH);
        refuses(textFile(W1_KEYS, { format: 'P2SH-P2WSH' }), WALLET_FILE_NOT_P2WSH);
        refuses(textFile(W1_KEYS, { format: 'P2WSH-P2SH' }), WALLET_FILE_NOT_P2WSH);
        refuses(textFile(W1_KEYS, { format: 'P2SH' }), WALLET_FILE_NOT_P2WSH);
        refuses(`tr(${keys[0]},sortedmulti_a(2,${keys[1]},${keys[2]}))`, WALLET_FILE_NOT_P2WSH);
        refuses(`wsh(multi(2,${keys.join(',')}))`, WALLET_FILE_NOT_P2WSH);
        refuses(`sh(wsh(sortedmulti(2,${keys.join(',')})))`, WALLET_FILE_NOT_P2WSH);
        refuses(`sh(sortedmulti(2,${keys.join(',')}))`, WALLET_FILE_NOT_P2WSH);
        refuses(`wsh(or_d(pk(${keys[0]}),and_v(v:pkh(${keys[1]}),older(1000))))`, WALLET_FILE_NOT_P2WSH);
        refuses(`wsh(thresh(2,pk(${keys[0]}),s:pk(${keys[1]}),s:pk(${keys[2]})))`, WALLET_FILE_NOT_P2WSH);
    });

    it('refuses a single key, the signer’s own multisig key export included', () => {
        refuses(multisigKeyExpression(ABANDON), WALLET_FILE_SINGLE_KEY);
        refuses(K.abandon.xpub, WALLET_FILE_SINGLE_KEY);
        refuses(`wpkh(${keyExpr(K.abandonBip84, '/0/*')})`, WALLET_FILE_SINGLE_KEY);
        refuses(fixture('skeleton-cobo.txt'), WALLET_FILE_SINGLE_KEY);
        refuses(JSON.stringify({ xfp: '73C5DA0A', p2wsh_deriv: "m/48'/0'/0'/2'", p2wsh: K.abandon.xpub }), WALLET_FILE_SINGLE_KEY);
    });

    it('refuses private keys and recovery phrases', () => {
        const root = rootFromBackup(ABANDON);
        const xprv = root.derivePath(K.abandon.path).toBase58();
        refuses(descriptorOf([`[73c5da0a/48h/0h/0h/2h]${xprv}/0/*`, keyExpr(K.legal), keyExpr(K.letter)]), WALLET_FILE_PRIVATE);
        refuses(`Name: x\nPolicy: 2 of 2\nFormat: P2WSH\nseed: ${ABANDON}\nB8688DF1: ${K.legal.xpub}`, WALLET_FILE_PRIVATE);
        refuses(ABANDON, WALLET_FILE_SEED);
        refuses('0000'.repeat(11) + '0003', WALLET_FILE_SEED);
    });

    it('refuses testnet keys', () => {
        const b58 = require('bs58check');
        const tpub = b58.encode(Buffer.concat([Buffer.from('043587cf', 'hex'), Buffer.from(b58.decode(K.legal.xpub)).subarray(4)]));
        refuses(textFile([K.abandon, { ...K.legal, xpub: tpub }, K.letter]), WALLET_FILE_TESTNET);
    });

    it('refuses a descriptor whose checksum does not match, in either part', () => {
        const [body, checksum] = W1.descriptor.split('#');
        refuses(`${body}#${checksum.slice(0, 7)}${checksum[7] === 'q' ? 'p' : 'q'}`, WALLET_FILE_BAD_CHECKSUM);
        refuses(`${body.replace("sortedmulti(2,", 'sortedmulti(1,')}#${checksum}`, WALLET_FILE_BAD_CHECKSUM);
        // without a checksum the descriptor is read, and still checked key by key
        expect(parseWalletFile(body).m).toBe(2);
    });

    it('refuses files that leave out the format, the quorum or a key', () => {
        refuses(textFile(W1_KEYS).replace('Format: P2WSH\n', ''), WALLET_FILE_NO_FORMAT);
        refuses(textFile(W1_KEYS).replace('Policy: 2 of 3\n', ''), WALLET_FILE_NO_POLICY);
        refuses(textFile(W1_KEYS).replace(/Derivation: .*\n73C5DA0A: .*\n/, ''), walletFileKeyCount(2, 3, 2));
        refuses(textFile(W1_KEYS).replace(/Derivation: .*\n/g, ''), WALLET_FILE_NO_ORIGIN);
        refuses(descriptorOf([K.abandon.xpub + '/0/*', keyExpr(K.legal, '/0/*'), keyExpr(K.letter, '/0/*')]), WALLET_FILE_NO_ORIGIN);
    });

    it('refuses wallets of the wrong size or quorum', () => {
        refuses(textFile([K.abandon], { m: 1 }), walletFileSize(1));
        refuses(textFile(W1_KEYS, { m: 4 }), walletFileThreshold(4, 3));
        refuses(textFile(W1_KEYS, { m: 0 }), walletFileThreshold(0, 3));
        // up to 15 keys is fine; 16 is not (distinct keys, labelled with made-up fingerprints)
        const ofAccounts = (n: number) =>
            Array.from({ length: n }, (_, i) => {
                const node = rootFromBackup(ABANDON).derivePath(`m/48'/0'/${i}'/2'`);
                return `[${(0x10000000 + i).toString(16)}/48h/0h/${i}h/2h]${node.neutered().toBase58()}/<0;1>/*`;
            });
        expect(parseWalletFile(descriptorOf(ofAccounts(15), 8)).keys).toHaveLength(15);
        refuses(descriptorOf(ofAccounts(16), 8), walletFileSize(16));
    });

    it('refuses the same key twice, two keys with one fingerprint, and a missing fingerprint', () => {
        refuses(descriptorOf([keyExpr(K.abandon), keyExpr(K.abandon), keyExpr(K.legal)]), WALLET_FILE_DUPLICATE_KEY);
        refuses(descriptorOf([keyExpr(K.abandon), keyExpr(K.abandonAccount5), keyExpr(K.legal)]), walletFileSameFingerprint('73c5da0a'));
        refuses(descriptorOf([keyExpr({ ...K.abandon, fingerprint: '00000000' }), keyExpr(K.legal), keyExpr(K.letter)]), WALLET_FILE_NO_FINGERPRINT);
    });

    it('refuses a key whose depth or child number does not match its path', () => {
        refuses(textFile([{ ...K.abandon, path: "m/48'/0'/0'" }, K.legal, K.letter]), walletFileBadKey(1));
        refuses(textFile([K.abandon, { ...K.legal, path: "m/48'/0'/0'/1'" }, K.letter]), walletFileBadKey(2));
        refuses(textFile([K.abandon, K.legal, { ...K.letter, path: "m/48'/0'/0'/2" }]), walletFileBadKey(3));
        refuses(textFile([K.abandon, K.legal, { ...K.letter, xpub: K.letter.xpub.slice(0, -1) + 'x' }]), walletFileBadKey(3));
    });

    it('refuses address layouts other than receive at /0/* and change at /1/*', () => {
        refuses(descriptorOf(W1_KEYS.map(k => keyExpr(k, '/2/*'))), WALLET_FILE_PATHS);
        refuses(descriptorOf(W1_KEYS.map(k => keyExpr(k, "/0/*'"))), WALLET_FILE_PATHS);
        refuses(descriptorOf(W1_KEYS.map(k => keyExpr(k, '/1/*'))), WALLET_FILE_PATHS);
        refuses(descriptorOf([keyExpr(K.abandon, '/0/*'), keyExpr(K.legal, '/1/*'), keyExpr(K.letter, '/0/*')]), WALLET_FILE_PATHS);
        refuses(`${W1.receiveDescriptor}\n${fixtures.wallets.w4.changeDescriptor}`, WALLET_FILE_UNREADABLE);
    });

    it('says when a BSMS file is encrypted, and when a file is something else', () => {
        refuses('a1b2c3d4'.repeat(40), WALLET_FILE_ENCRYPTED);
        refuses('hello', WALLET_FILE_UNREADABLE);
        refuses('', WALLET_FILE_UNREADABLE);
        refuses(fixture('caravan-multisig.json'), WALLET_FILE_UNREADABLE);
        // Sparrow's Electrum export carries one cosigner's private key
        refuses(JSON.stringify(require('./fixtures/fromsparrow-electrum.json')), WALLET_FILE_PRIVATE);
    });
});

describe("confirming the seed's key is in the wallet", () => {
    const policy = parseWalletFile(textFile(W1_KEYS));

    it('finds each member seed at its listed path', () => {
        expect(confirmOwnKey(policy, rootFromBackup(ABANDON))).toEqual(K.abandon);
        expect(confirmOwnKey(policy, rootFromBackup(LEGAL))).toEqual(K.legal);
    });

    it('refuses a seed that is not in the wallet, or the right seed without its passphrase', () => {
        expect(() => confirmOwnKey(policy, rootFromBackup(ZOO))).toThrow(ownKeyMissing(K.zoo.fingerprint));
        const W5 = parseWalletFile(fixtures.wallets.w5.descriptor);
        expect(() => confirmOwnKey(W5, rootFromBackup(ABANDON))).toThrow(ownKeyMissing('73c5da0a'));
        expect(confirmOwnKey(W5, rootFromBackup(ABANDON, 'TREZOR'))).toEqual(K.abandonTrezor);
    });

    it("refuses a wallet file that lists this seed's fingerprint with someone else's key", () => {
        // the coordinator was tampered with: our fingerprint, an attacker's key at the same path
        const swapped = parseWalletFile(textFile([{ ...K.ozone, fingerprint: K.abandon.fingerprint }, K.legal, K.letter]));
        expect(() => confirmOwnKey(swapped, rootFromBackup(ABANDON))).toThrow(OWN_KEY_DIFFERENT);
    });
});

describe('scripts, addresses and the descriptor', () => {
    it('derives the receive and change addresses rust-miniscript derives', () => {
        const policy = parseWalletFile(W1.descriptor);
        expect(Array.from({ length: 20 }, (_, i) => policyAddress(policy, 0, i))).toEqual(W1.receiveFirst20);
        expect(Array.from({ length: 20 }, (_, i) => policyAddress(policy, 1, i))).toEqual(W1.changeFirst20);
        expect(policyAddress(policy, 0, 999)).toBe(W1.addresses.receive999);
        expect(policyWitnessScript(policy, 0, 0).toString('hex')).toBe(W1.witnessScriptReceive0);
        expect(policyWitnessScript(policy, 1, 5).toString('hex')).toBe(W1.witnessScriptChange5);
        const W4 = parseWalletFile(fixtures.wallets.w4.descriptor);
        expect(W4.m).toBe(3);
        expect(policyAddress(W4, 0, 12)).toBe(fixtures.wallets.w4.addresses.receive12);
    });

    it("derives each key's child public keys exactly as the bip32 library does", () => {
        const bip32 = require('bip32').BIP32Factory(require('../../blue_modules/noble_ecc').default);
        for (const key of [K.abandon, K.zoo, K.abandonAccount5]) {
            for (const branch of [0, 1]) {
                const node = bip32.fromBase58(key.xpub).derive(branch);
                for (let index = 0; index < 150; index++) {
                    expect(policyKeyPubkey(key, branch, index).equals(Buffer.from(node.derive(index).publicKey))).toBe(true);
                }
            }
        }
        expect(() => policyKeyPubkey(K.abandon, 0, 0x80000000)).toThrow();
    });

    it("computes rust-miniscript's descriptor checksums, and writes a descriptor that reads back the same", () => {
        for (const w of Object.values(fixtures.wallets) as any[]) {
            for (const d of [w.descriptor, w.receiveDescriptor, w.changeDescriptor]) {
                const [body, checksum] = d.split('#');
                expect(descriptorChecksum(body)).toBe(checksum);
            }
        }
        const sparrow = JSON.parse(fixture('fromsparrow-specter.json')).descriptor.split('#');
        expect(descriptorChecksum(sparrow[0])).toBe(sparrow[1]);
        const policy = parseWalletFile(textFile(W1_KEYS));
        const written = policyDescriptor(policy);
        expect(written).toMatch(/^wsh\(sortedmulti\(2,\[73c5da0a\/48h\/0h\/0h\/2h\]xpub[^/]+\/<0;1>\/\*,/);
        expect(parseWalletFile(written).id).toBe(policy.id);
    });
});

describe('finding an address', () => {
    const w1 = { ...parseWalletFile(W1.descriptor), ownFingerprint: '73c5da0a', addedAt: 0 };
    const w4 = { ...parseWalletFile(fixtures.wallets.w4.descriptor), ownFingerprint: '73c5da0a', addedAt: 0 };

    it('reads plain addresses and bitcoin: links, capitals included', () => {
        const { address } = addressFromText(`bitcoin:${W1.addresses.receive12.toUpperCase()}?amount=0.01&label=x`);
        expect(address).toBe(W1.addresses.receive12);
        expect(addressFromText(` ${W1.addresses.change5} `).address).toBe(W1.addresses.change5);
        expect(() => addressFromText('bc1qnotanaddress')).toThrow(NOT_AN_ADDRESS);
        expect(() => addressFromText('')).toThrow(NOT_AN_ADDRESS);
    });

    it('says which wallet, receive or change, and which index', async () => {
        const find = (address: string) => findAddress(addressFromText(address).script, [w1, w4], { limit: 30 });
        expect(await find(W1.addresses.receive12)).toEqual({ wallet: w1, branch: 0, index: 12 });
        expect(await find(W1.addresses.change5)).toEqual({ wallet: w1, branch: 1, index: 5 });
        expect(await find(fixtures.wallets.w4.addresses.change3)).toEqual({ wallet: w4, branch: 1, index: 3 });
        // a single-key address can't be in a multisig wallet, and isn't searched for
        expect(await find('bc1qhu8jqyzfazgatpctqn44xr7pdd3mdx6qy2r6xa')).toBeNull();
        expect(await find(fixtures.wallets.w2.addresses.receive0)).toBeNull();
    });

    it('looks through the first 1,000 addresses and no further', async () => {
        expect(ADDRESS_SEARCH_LIMIT).toBe(1000);
        const progress: number[] = [];
        const at999 = await findAddress(addressFromText(W1.addresses.change999).script, [w1], { onProgress: n => progress.push(n) });
        expect(at999).toEqual({ wallet: w1, branch: 1, index: 999 });
        expect(progress.length).toBeGreaterThan(10);
        expect(await findAddress(addressFromText(W1.addresses.receive1000).script, [w1])).toBeNull();
    });
});
