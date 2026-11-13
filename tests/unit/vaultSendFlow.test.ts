/**
 * The vault send screens label each flow for what it is, and the params that
 * decide how capsules are spent survive every hop between the screens.
 *
 * The heavy-wallet test found a Hot Vault consolidation confirmed as "Sent from:
 * Cold Vault address" and "To: Cold Vault address", and both moves as "Top-up
 * amount": the moves pass the other vault's address as `to`, the param a
 * top-up uses for its CoinOS address, and `to` was checked first.
 */

import fs from 'fs';
import path from 'path';

import loc from '../../loc';
import { confirmLabels, offersChangeSweep, reviewLabels, vaultSendKind } from '../../src/helpers/vaultSendKind';

const cs = loc.cypherbox.vault.cold_storage;
const common = loc.cypherbox.payments.common;
const ct = loc.cypherbox.payments.confirm_transaction;

// the params each flow reaches the review with (HotStorageVault/Capsules.tsx, EditAmount)
const HOT_CONSOLIDATE = { isBatch: true, vaultSend: true, vaultTab: false, to: 'bc1qhotself' };
const COLD_CONSOLIDATE = { isBatch: true, vaultSend: true, vaultTab: true, to: 'bc1qcoldself' };
const MOVE_TO_COLD = { vaultSend: true, vaultTab: false, to: 'bc1qcoldvault' };
const MOVE_TO_HOT = { vaultSend: true, vaultTab: true, to: 'bc1qhotvault' };
const TOP_UP = { vaultTab: false, to: 'bc1qcoinos', toStrike: 'bc1qstrike', toArk: 'bc1pbark' };
const SEND = { vaultTab: false };
// HomeScreen/Header: the scanned address rides in `to`, with every capsule pre-selected
const HOME_SCAN = { vaultTab: false, to: 'bc1qscanned', autoSelected: true };

describe('vaultSendKind', () => {
    it('tells the flows apart, moves before top-ups', () => {
        expect(vaultSendKind(HOT_CONSOLIDATE)).toBe('consolidate');
        expect(vaultSendKind(COLD_CONSOLIDATE)).toBe('consolidate');
        expect(vaultSendKind(MOVE_TO_COLD)).toBe('move_to_cold');
        expect(vaultSendKind(MOVE_TO_HOT)).toBe('move_to_hot');
        expect(vaultSendKind(TOP_UP)).toBe('top_up');
        expect(vaultSendKind({ toArk: 'bc1pbark' })).toBe('top_up');
        expect(vaultSendKind(SEND)).toBe('send');
    });

    it('calls the Home scan a send, not a top-up to the CoinOS address', () => {
        expect(vaultSendKind(HOME_SCAN)).toBe('send');
        expect(vaultSendKind({ ...HOME_SCAN, vaultTab: true })).toBe('send');
        expect(reviewLabels(vaultSendKind(HOME_SCAN)).title).toBe(cs.construct_transaction);
        const labels = confirmLabels(vaultSendKind(HOME_SCAN), { toCoinos: true });
        expect(labels.amount).toBe(common.recipient_will_get);
        expect(labels.toTitle).toBe(common.to_colon);
        expect(labels.to).toBe(common.bitcoin_address_label);
    });
});

describe('the review', () => {
    it('titles each flow in the app language instead of the English `title` flag', () => {
        expect(reviewLabels(vaultSendKind(MOVE_TO_COLD))).toEqual({ title: cs.move_to_cold_vault, amount: cs.transfer_amount });
        expect(reviewLabels(vaultSendKind(MOVE_TO_HOT))).toEqual({ title: cs.move_to_hot_vault, amount: cs.amount_moved });
        expect(reviewLabels(vaultSendKind(COLD_CONSOLIDATE)).title).toBe(cs.batch_capsules);
        expect(reviewLabels(vaultSendKind(TOP_UP))).toEqual({ title: cs.topup_transaction, amount: cs.topup_amount });
        expect(reviewLabels(vaultSendKind(SEND))).toEqual({ title: cs.construct_transaction, amount: cs.recipient_will_get });
    });

    it('never calls a move a top-up', () => {
        for (const move of [MOVE_TO_COLD, MOVE_TO_HOT]) {
            const labels = reviewLabels(vaultSendKind(move));
            expect(labels.title).not.toBe(cs.topup_transaction);
            expect(labels.amount).not.toBe(cs.topup_amount);
        }
    });
});

describe('the confirm screen (Hot Vault spends)', () => {
    it('shows a Hot Vault consolidation as from and to the Hot Vault', () => {
        const labels = confirmLabels(vaultSendKind(HOT_CONSOLIDATE), { vaultTab: false });
        expect(labels.amount).toBe(ct.amount_to_batch);
        expect(labels.from).toBe(common.hot_vault_address_label);
        expect(labels.to).toBe(common.hot_vault_address_label);
        expect(Object.values(labels)).not.toContain(common.cold_vault_address_label);
    });

    it('shows Move to Cold Vault as a transfer to the Cold Vault', () => {
        const labels = confirmLabels(vaultSendKind(MOVE_TO_COLD), { vaultTab: false });
        expect(labels.amount).toBe(ct.transfer_amount);
        expect(labels.amount).not.toBe(common.top_up_amount);
        expect(labels.from).toBe(common.hot_vault_address_label);
        expect(labels.toTitle).toBe(common.to_colon);
        expect(labels.to).toBe(common.cold_vault_address_label);
    });

    it('names CoinOS only when the top-up goes to the CoinOS address', () => {
        expect(confirmLabels('top_up', { toCoinos: true }).toTitle).toBe(common.to_coinos_bitcoin_address);
        expect(confirmLabels('top_up', { toCoinos: false }).toTitle).toBe(common.to_colon);
        expect(confirmLabels('top_up').amount).toBe(common.top_up_amount);
    });

    it('shows a plain send to a Bitcoin address', () => {
        const labels = confirmLabels(vaultSendKind(SEND));
        expect(labels.amount).toBe(common.recipient_will_get);
        expect(labels.from).toBe(common.hot_vault_address_label);
        expect(labels.to).toBe(common.bitcoin_address_label);
    });

    it('has the new labels in Arabic too', () => {
        const ar = require('../../loc/ar.json').cypherbox;
        expect(ar.payments.common.hot_vault_address_label).toBeTruthy();
        expect(ar.payments.confirm_transaction.transfer_amount).toBeTruthy();
        expect(ar.vault.cold_storage.capsules_not_needed).toContain('{count}');
        expect(ar.vault.cold_storage.show_all_capsules).toContain('{count}');
        for (const key of ['{count}', '{needed}', '{fee}']) expect(ar.vault.cold_storage.capsules_beyond_need).toContain(key);
        // Arabic copy says سات, never the Latin unit
        expect(ar.vault.cold_storage.capsules_beyond_need).toContain('سات');
        expect(ar.vault.cold_storage.capsules_beyond_need).not.toMatch(/sats/);
    });

    it('keeps the new English copy free of em dashes', () => {
        expect(cs.show_all_capsules).not.toContain('—');
        expect(cs.capsules_beyond_need).not.toContain('—');
    });
});

describe('the signing screen (Cold Vault spends, signed on the device)', () => {
    it('shows Move to Hot Vault as a transfer from the Cold Vault to the Hot Vault', () => {
        const labels = confirmLabels(vaultSendKind(MOVE_TO_HOT), { vaultTab: true });
        expect(labels.amount).toBe(ct.transfer_amount);
        expect(labels.from).toBe(common.cold_vault_address_label);
        expect(labels.to).toBe(common.hot_vault_address_label);
        expect(labels.amount).not.toBe(common.recipient_will_get);
    });

    it('shows a Cold Vault consolidation as from and to the Cold Vault', () => {
        const labels = confirmLabels(vaultSendKind(COLD_CONSOLIDATE), { vaultTab: true });
        expect(labels.amount).toBe(ct.amount_to_batch);
        expect(labels.from).toBe(common.cold_vault_address_label);
        expect(labels.to).toBe(common.cold_vault_address_label);
    });
});

/**
 * Navigating back to a screen by name replaces its params, so each hop lists
 * them again. Losing `isMaxEdit` turns a Max consolidation into a fixed amount;
 * losing `autoSelected` makes a Home scan spend every capsule in the vault.
 */
describe('params that decide what is spent survive each hop', () => {
    const REPO = path.resolve(__dirname, '../..');
    const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

    /** The object literal passed to every call starting with `call` in `src`. */
    function paramsOf(src: string, call: string): string[] {
        const out: string[] = [];
        let from = 0;
        for (;;) {
            const at = src.indexOf(call, from);
            if (at < 0) return out;
            const open = src.indexOf('{', at);
            let depth = 0;
            let end = open;
            for (; end < src.length; end++) {
                if (src[end] === '{') depth++;
                if (src[end] === '}' && --depth === 0) break;
            }
            out.push(src.slice(open, end + 1));
            from = end;
        }
    }

    it('EditAmount hands autoSelected on to the review, typed amount and Max alike', () => {
        const calls = paramsOf(read('src/screens/EditAmount/index.tsx'), "dispatchNavigate('ColdStorage'");
        expect(calls).toHaveLength(2);
        for (const params of calls) expect(params).toMatch(/\bautoSelected\b/);
    });

    it('the review hands autoSelected and the Bark address to EditAmount, and isMaxEdit to the address picker', () => {
        const src = read('src/screens/ColdStorage/index.tsx');
        const [edit] = paramsOf(src, "navigation.push('EditAmount'");
        expect(edit).toMatch(/\bautoSelected\b/);
        expect(edit).toMatch(/\btoArk\b/);
        const [addresses] = paramsOf(src, "dispatchNavigate('WalletAddresses'");
        expect(addresses).toMatch(/\bisMaxEdit\b/);
    });

    it('the address picker hands isMaxEdit back to a consolidation', () => {
        const [back] = paramsOf(read('screen/wallets/addresses.js'), "dispatchNavigate('ColdStorage'");
        expect(back).toMatch(/\bisMaxEdit\b/);
    });

    it('the Home scan marks its pre-selection', () => {
        const [scan] = paramsOf(read('src/screens/HomeScreen/Header/index.tsx'), "dispatchNavigate('EditAmount'");
        expect(scan).toMatch(/\bautoSelected: true\b/);
    });

    it('the review hands the confirm screen what labels the flow', () => {
        const src = read('src/screens/ColdStorage/index.tsx');
        const data = src.slice(src.indexOf('let data = {'), src.indexOf("dispatchNavigate('ConfirmTransction'"));
        for (const key of ['isBatch', 'vaultSend', 'vaultTab', 'to', 'toStrike', 'toArk', 'autoSelected', 'changeSats', 'networkFees']) {
            expect(data).toMatch(new RegExp(`\\b${key}\\b`));
        }
    });

    it('the signing screen gets the flow, the change and the fee, and passes them on for "Show again"', () => {
        const [signing] = paramsOf(read('src/screens/ColdStorage/index.tsx'), "navigation.navigate('HardwareWalletTransaction'");
        for (const key of ['kind', 'changeSats', 'networkFees', 'to']) expect(signing).toMatch(new RegExp(`\\b${key}\\b`));
        const [onward] = paramsOf(read('src/screens/HardwareWalletTransaction/index.tsx'), 'navigation.navigate("HardwareWalletTransactionContinue"');
        for (const key of ['kind', 'changeSats', 'networkFees']) expect(onward).toMatch(new RegExp(`\\b${key}\\b`));
    });
});

/**
 * A Consolidate edited to a smaller capsule than the selection leaves change, and the review and the confirm screen
 * left it out: both drew the change only when the flow was not a batch.
 */
describe('the change of a consolidation', () => {
    const REPO = path.resolve(__dirname, '../..');
    const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

    it('is shown on the review and the confirm screen, as for every flow', () => {
        const review = read('src/screens/ColdStorage/index.tsx');
        expect(review).toMatch(/\{capsuleTotal > 0 &&\s*\n\s*\(\(\) => \{/);
        expect(review).not.toMatch(/capsuleTotal > 0 && !isBatch/);
        const confirm = read('src/screens/ConfirmTransction/index.tsx');
        expect(confirm).toMatch(/\{changeSats > 0 &&\s*\n\s*<View/);
        expect(confirm).not.toMatch(/!isBatch && changeSats > 0/);
    });

    it('stays in the vault: only the other flows offer to send the change elsewhere', () => {
        expect(offersChangeSweep(vaultSendKind(HOT_CONSOLIDATE))).toBe(false);
        expect(offersChangeSweep(vaultSendKind(COLD_CONSOLIDATE))).toBe(false);
        for (const flow of [MOVE_TO_COLD, MOVE_TO_HOT, TOP_UP, SEND, HOME_SCAN]) expect(offersChangeSweep(vaultSendKind(flow))).toBe(true);
        expect(read('src/screens/ColdStorage/index.tsx')).toMatch(/\{offersChangeSweep\(sendKind\) && \(isStrikeAuth \|\| isAuth \|\| showHotVault\) && \(/);
    });
});

describe('the confirm screen in Arabic', () => {
    it('keeps "+N" (capsules beyond the grid) reading left to right', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../src/screens/ConfirmTransction/index.tsx'), 'utf8');
        expect(src).toMatch(/\{ltr\('\+' \+ moreCapsules\)\}/);
    });
});
