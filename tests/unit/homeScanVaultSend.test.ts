/**
 * Scanning an address on Home and paying it from a vault (HomeScreen/Header -> EditAmount).
 *
 * Next on the amount screen never came on: the scan handed EditAmount an empty `maxUSD`, which it compared with the
 * typed amount as text, so every amount was over it and only Max worked. And the scanned text went on as the
 * destination whole, so a bitcoin: link (an address with ?amount=) was not an address the review could pay.
 */

import fs from 'fs';
import path from 'path';

import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import { scannedVaultSend } from '../../src/helpers/capsuleSpend';

const ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const UPPER = ADDRESS.toUpperCase();
const SPENDABLE = 2_500_000;
const RATE = 95_000;

const scan = (text: string) => scannedVaultSend(DeeplinkSchemaMatch.decodeBitcoinUri(text), SPENDABLE, RATE);

describe('what the Home scan hands EditAmount', () => {
    it('a bare address: that address, and the vault total as the maximum', () => {
        expect(scan(ADDRESS)).toEqual({ to: ADDRESS, maxUSD: 0.025, isEdit: false, total: '', inUSD: '' });
        expect(scan('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2').to).toBe('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
    });

    it('a QR code in capitals: the address in lower case', () => {
        expect(scan(UPPER).to).toBe(ADDRESS);
        expect(scan(`BITCOIN:${UPPER}`)).toEqual({ to: ADDRESS, maxUSD: 0.025, isEdit: false, total: '', inUSD: '' });
    });

    it('a bitcoin: link with an amount: the address, and the amount filled in', () => {
        expect(scan(`bitcoin:${UPPER}?amount=0.001&label=Coffee`)).toEqual({
            to: ADDRESS,
            maxUSD: 0.025,
            isEdit: true,
            total: '0.001',
            inUSD: '95.00',
        });
        // the form a link the phone opened is kept in, and a unified QR with a Lightning invoice
        expect(scan(`bitcoin://${ADDRESS}?amount=0.0005`)).toEqual(expect.objectContaining({ to: ADDRESS, total: '0.0005' }));
        expect(scan(`BITCOIN:${UPPER}?amount=0.00021&lightning=LNBC1PVJLUEZPP5QQQSYQCYQ5RQWZQF`)).toEqual(
            expect.objectContaining({ to: ADDRESS, total: '0.00021', isEdit: true }),
        );
    });

    it('a link whose amount is not a number: the address, with the amount left to the user', () => {
        expect(scan(`bitcoin:${ADDRESS}?amount=abc`)).toEqual({ to: ADDRESS, maxUSD: 0.025, isEdit: false, total: '', inUSD: '' });
    });
});

describe('the screens use it', () => {
    const REPO = path.resolve(__dirname, '../..');
    const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

    it('Home decodes the scan with the app BIP21 decoder and passes its maximum and amount on', () => {
        const src = read('src/screens/HomeScreen/Header/index.tsx');
        expect(src).toMatch(/scannedVaultSend\(DeeplinkSchemaMatch\.decodeBitcoinUri\(scannedAddress\)/);
        const at = src.indexOf("dispatchNavigate('EditAmount'");
        const params = src.slice(at, src.indexOf('});', at));
        for (const key of ['isEdit', 'to', 'maxUSD', 'inUSD', 'total']) expect(params).toMatch(new RegExp(`\\b${key}: send\\.${key}\\b`));
        expect(params).not.toMatch(/maxUSD:\s*''/);
    });

    it('EditAmount compares the typed amount with the maximum as numbers', () => {
        const src = read('src/screens/EditAmount/index.tsx');
        expect(src).toMatch(/const overMax = Number\(isSats \? sats : usd\) > Number\(maxUSD\);/);
        expect(src).toMatch(/disabled=\{!sats\.length \|\| Number\(sats\) == 0 \|\| overMax\}/);
    });
});
