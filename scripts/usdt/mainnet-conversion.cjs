#!/usr/bin/env node
//
// mainnet-conversion.cjs: one real conversion of USDT on Tron to bitcoin, run
// through the app's own code (src/services/tron/conversion.ts), the live
// backend and Flashnet. Mainnet and real funds, so keep the amounts small.
//
// It exists for the runs before the UI does, and to measure how long Flashnet
// takes to notice a deposit: its order's createdAt against the deposit's
// block time.
//
// Usage, from the repo root:
//   node scripts/usdt/mainnet-conversion.cjs address [tron-address]
//   node scripts/usdt/mainnet-conversion.cjs convert --to <target> [--usdt <amount> | --sats <amount>]
//   node scripts/usdt/mainnet-conversion.cjs follow <run-file>
//
// <target> is a Lightning address, a mainnet BOLT11 invoice or a bitcoin
// address. An invoice that carries an amount sets it (exact_out). Otherwise
// --usdt is what you send (exact_in), or --sats what arrives (exact_out,
// Lightning only). A deposit over --max-usdt (default 20) is refused.
//
// The recovery phrase and passphrase are typed at a hidden prompt, so they
// never reach argv, the environment, shell history or the run file. Nothing
// is signed until you type "pay" at the quote.
//
// Each run is saved as it goes (the quote, each signed transfer's id before it
// is posted, every status seen) under the OS temp directory, or --runs-dir.
// If the script stops mid-send, `follow <run-file>` settles that transfer and
// follows the order, without signing anything new.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { Writable } = require('node:stream');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Compile the app's TypeScript on the fly, and only what this path touches:
// src/ and blue_modules/, without the React Native preset.
require('@babel/register')({
    cwd: REPO_ROOT,
    babelrc: false,
    configFile: false,
    cache: false,
    extensions: ['.ts'],
    only: [
        file =>
            file.startsWith(path.join(REPO_ROOT, 'src') + path.sep) ||
            file.startsWith(path.join(REPO_ROOT, 'blue_modules') + path.sep),
    ],
    presets: [[require.resolve('@babel/preset-typescript'), { allowDeclareFields: true }]],
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
});

const BigNumber = require('bignumber.js');
const { getTronAccountState, getTronUsdtBalance } = require('../../src/api/tronAPIs');
const { asset } = require('../../src/services/chainSwap');
const { deriveTronAccountFromWallet, tronTransferSignerForWallet } = require('../../src/services/tron/account');
const { isValidTronAddress } = require('../../src/services/tron/address');
const { followUsdtConversion, payUsdtConversion, prepareUsdtConversion } = require('../../src/services/tron/conversion');
const { TronSendError, awaitUsdtTransferOutcome } = require('../../src/services/tron/send');
const { hasTransferBandwidth, secondsUntilTransferBandwidth } = require('../../src/services/tron/sendNeeds');

const SCRIPT = 'node scripts/usdt/mainnet-conversion.cjs';
const TRONGRID_URL = 'https://api.trongrid.io';

// TronGrid without a key allows 3 requests a second and suspends the caller
// for 3 s beyond that (its own error text, 2026-09-19). The app's reads carry
// no key, and this script makes more of them back to back than a screen
// would, so space them out here rather than fail a run on a 429.
const TRONGRID_SPACING_MS = 400;
let nextTronGridSlot = 0;
const unpacedFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(TRONGRID_URL)) {
        const now = Date.now();
        const slot = Math.max(now, nextTronGridSlot);
        nextTronGridSlot = slot + TRONGRID_SPACING_MS;
        if (slot > now) {
            await new Promise(resolve => setTimeout(resolve, slot - now));
        }
    }
    return unpacedFetch(url, init);
};
const DEFAULT_MAX_USDT = '20';
const DEFAULT_RUNS_DIR = path.join(os.tmpdir(), 'cypherbox-usdt-runs');
const LIGHTNING = asset('btc', 'lightning');
const BITCOIN = asset('btc', 'bitcoin');

/** Powers of ten for a BOLT11 amount's multiplier, in BTC. */
const INVOICE_UNITS = { '': 0, m: -3, u: -6, n: -9, p: -12 };

const USAGE = `Usage, from the repo root:
  ${SCRIPT} address [tron-address]
      Show a Tron account: address, USDT, activation, bandwidth. With an address it
      asks for nothing, so balances can be rechecked without the recovery phrase.
  ${SCRIPT} convert --to <target> [--usdt <amount> | --sats <amount>] [--max-usdt <n>] [--runs-dir <dir>]
      Book a Flashnet quote, show it, and pay only after you type "pay". Then follow the order.
      <target>: a Lightning address, a mainnet BOLT11 invoice, or a bitcoin address.
  ${SCRIPT} follow <run-file>
      Settle a transfer a run could not confirm, then follow its order. Signs nothing.`;

class UsageError extends Error {}
/** A clear no, shown as its message alone. */
class Refusal extends Error {}
class Stopped extends Error {}

/** The run in progress, so an unexpected failure can say how to settle it. */
let activeRun = null;

const say = (text = '') => process.stdout.write(`${text}\n`);
const iso = () => new Date().toISOString();
const clock = date => new Date(date).toLocaleTimeString('en-GB', { hour12: false });
const secs = ms => `${(ms / 1000).toFixed(1)} s`;
const sats = btc => new BigNumber(btc).shiftedBy(8).toFormat(0);
const short = text => (text.length > 40 ? `${text.slice(0, 24)}...${text.slice(-8)}` : text);

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
    const [command, ...rest] = argv;
    const flags = {};
    const positional = [];
    for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        if (!arg.startsWith('--')) {
            positional.push(arg);
            continue;
        }
        const value = rest[i + 1];
        if (value === undefined || value.startsWith('--')) {
            throw new UsageError(`${arg} needs a value`);
        }
        flags[arg.slice(2)] = value;
        i += 1;
    }
    return { command, flags, positional };
}

/**
 * Ask one question. A hidden one keeps no readline history and draws into a
 * sink, so neither the typed text nor the cursor moving along it shows: that
 * is how the recovery phrase is read.
 */
function prompt(question, hidden = false) {
    return new Promise((resolve, reject) => {
        const sink = new Writable({ write: (_chunk, _encoding, done) => done() });
        const rl = readline.createInterface({
            input: process.stdin,
            output: hidden ? sink : process.stdout,
            terminal: true,
            historySize: 0,
        });
        const finish = () => {
            rl.close();
            if (hidden) {
                process.stdout.write('\n');
            }
        };
        rl.on('SIGINT', () => {
            finish();
            if (!hidden) {
                process.stdout.write('\n');
            }
            reject(new Stopped());
        });
        if (hidden) {
            process.stdout.write(question);
        }
        rl.question(hidden ? '' : question, answer => {
            finish();
            resolve(answer);
        });
    });
}

/**
 * Read the phrase and derive the account through the app's own account.ts,
 * from the same slice of a wallet the app hands it.
 */
async function unlockWallet() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new UsageError('Run this in a terminal: it asks for the recovery phrase at a hidden prompt.');
    }
    const phrase = (await prompt('Recovery phrase (hidden): ', true)).trim().toLowerCase().replace(/\s+/g, ' ');
    const passphrase = await prompt('BIP39 passphrase, if the wallet has one (hidden, Enter for none): ', true);
    const wallet = {
        getSecret: () => phrase,
        getPassphrase: () => passphrase || undefined,
    };
    let account = null;
    try {
        account = deriveTronAccountFromWallet(wallet);
    } catch {
        // Its only failure is an invalid phrase, and the phrase must not reach the output.
    }
    if (!account) {
        throw new Refusal('That recovery phrase is not valid. Check the words and their order, then run again.');
    }
    return { wallet, account };
}

/** Sats an invoice asks for, or null when it names no amount. Mainnet only. */
function invoiceSats(invoice) {
    const hrp = invoice.slice(0, invoice.lastIndexOf('1')).toLowerCase();
    const match = /^lnbc(\d*)([munp]?)$/.exec(hrp);
    if (!match) {
        throw new UsageError('That is not a mainnet Lightning invoice.');
    }
    if (!match[1]) {
        return null;
    }
    const value = new BigNumber(match[1]).shiftedBy(INVOICE_UNITS[match[2]] + 8);
    if (!value.isInteger() || !value.isGreaterThan(0)) {
        throw new UsageError('The invoice asks for a fraction of a sat, which a conversion cannot pay exactly.');
    }
    return value.toFixed(0);
}

/** What to ask Flashnet for: route, amount and amount mode. */
function planConversion(flags) {
    const target = (flags.to || '').trim().replace(/^lightning:/i, '');
    // Invoices from QR codes are often upper case; bech32 reads the same either way.
    const to = /^lnbc/i.test(target) ? target.toLowerCase() : target;
    const { usdt, sats: satsFlag } = flags;
    if (!to) {
        throw new UsageError('--to is required.');
    }
    if (usdt !== undefined && satsFlag !== undefined) {
        throw new UsageError('Give --usdt or --sats, not both.');
    }
    if (usdt !== undefined && (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(usdt) || !new BigNumber(usdt).isGreaterThan(0))) {
        throw new UsageError('--usdt takes a plain amount above zero with at most 6 decimals, like 3 or 2.5.');
    }
    if (satsFlag !== undefined && !/^[1-9]\d*$/.test(satsFlag)) {
        throw new UsageError('--sats takes a whole number of sats.');
    }

    const exactIn = amount => ({ mode: 'exact_in', amount, fixed: `${amount} USDT sent` });
    const exactOut = satsAmount => ({
        mode: 'exact_out',
        amount: new BigNumber(satsAmount).shiftedBy(-8).toFixed(),
        fixed: `${new BigNumber(satsAmount).toFormat(0)} sats delivered`,
    });

    if (/^lnbc/i.test(to)) {
        const invoiceAmount = invoiceSats(to);
        if (invoiceAmount !== null) {
            if (usdt !== undefined) {
                throw new UsageError(`This invoice sets the amount (${invoiceAmount} sats). Drop --usdt.`);
            }
            if (satsFlag !== undefined && satsFlag !== invoiceAmount) {
                throw new UsageError(`This invoice asks for ${invoiceAmount} sats, not ${satsFlag}.`);
            }
            return { to, settle: LIGHTNING, ...exactOut(invoiceAmount) };
        }
    }
    const lightningAddress = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to);
    if (/^ln/i.test(to) && !/^lnbc/i.test(to) && !lightningAddress) {
        throw new UsageError('That is not a mainnet Lightning invoice.');
    }
    const lightning = /^lnbc/i.test(to) || lightningAddress;
    if (usdt !== undefined) {
        return { to, settle: lightning ? LIGHTNING : BITCOIN, ...exactIn(usdt) };
    }
    if (satsFlag !== undefined) {
        if (!lightning) {
            throw new UsageError('--sats works only for Lightning. Use --usdt for a bitcoin address.');
        }
        return { to, settle: LIGHTNING, ...exactOut(satsFlag) };
    }
    throw new UsageError('Say how much: --usdt <amount> to send, or --sats <amount> to deliver.');
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

async function describeAccount(account) {
    const usdt = await getTronUsdtBalance(account.address);
    const state = await getTronAccountState(account.address);
    // The same rule checkUsdtSendReadiness applies, without reading it all again.
    const retryAfter = hasTransferBandwidth(state) ? undefined : secondsUntilTransferBandwidth(state, Date.now());
    const bandwidth = hasTransferBandwidth(state)
        ? 'yes'
        : `no, out of free bandwidth${retryAfter !== undefined ? ` for about ${Math.ceil(retryAfter / 60)} min` : ''}`;
    say(`Tron address   ${account.address}  (${account.path})`);
    say(`USDT           ${usdt}`);
    say(`TRX            ${state.trxBalance}`);
    say(`Activated      ${state.activated ? 'yes' : 'no, the first send activates it and the backend pays for that'}`);
    say(`Bandwidth      ${state.freeBandwidth} free, ${state.stakedBandwidth} staked`);
    say(`Can send now   ${bandwidth}`);
    return usdt;
}

/** The deposit's block and receipt, straight from the node. Null if unreadable. */
async function readDepositBlock(txID) {
    try {
        const response = await fetch(`${TRONGRID_URL}/wallet/gettransactioninfobyid`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: txID }),
        });
        const info = await response.json();
        if (typeof info.blockTimeStamp !== 'number') {
            return null;
        }
        return {
            blockNumber: info.blockNumber,
            blockTimeMs: info.blockTimeStamp,
            result: info.receipt?.result ?? null,
            energyUsed: info.receipt?.energy_usage_total ?? 0,
            feeSun: info.fee ?? 0,
        };
    } catch {
        return null;
    }
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

function openRun(runsDir, record) {
    fs.mkdirSync(runsDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(runsDir, `${stamp}-${record.quote.id}.json`);
    return attachRun(file, record);
}

function attachRun(file, record) {
    const run = {
        file,
        record,
        // Synchronous, so a transfer is on disk before it is posted.
        save: () => fs.writeFileSync(file, JSON.stringify(record, null, 2), { mode: 0o600 }),
    };
    run.save();
    activeRun = run;
    return run;
}

/** JSON turns the order's dates into strings; the app's code wants Dates. */
function reviveOrder(order) {
    return {
        ...order,
        createdAt: new Date(order.createdAt),
        expiresAt: new Date(order.expiresAt),
        statusChangedAt: new Date(order.statusChangedAt),
    };
}

async function recordDeposit(run, txID) {
    const block = await readDepositBlock(txID);
    run.record.deposit = { txID, ...(block ?? {}), landedObservedAt: iso() };
    run.save();
    if (block) {
        say(
            `${clock(Date.now())}  deposit in block ${block.blockNumber}, block time ${clock(block.blockTimeMs)} ` +
                `(energy used ${block.energyUsed}, TRX burned ${new BigNumber(block.feeSun).shiftedBy(-6).toFixed()})`,
        );
    } else {
        say(`${clock(Date.now())}  deposit landed (${txID}), but its block time could not be read`);
    }
}

/* ------------------------------------------------------------------ */
/* Converting                                                          */
/* ------------------------------------------------------------------ */

function showQuote(plan, quote, confirmBy) {
    const left = Math.round((confirmBy.getTime() - Date.now()) / 1000);
    const rate = new BigNumber(quote.depositAmount).dividedBy(quote.settleAmount);
    const route = plan.settle.network === 'lightning' ? 'over Lightning' : 'on chain';
    say(`Quote ${quote.id}`);
    say(`  You send       ${quote.depositAmount} USDT, to ${quote.depositAddress}`);
    say(
        `  Arrives        ${quote.settleAmountIsFirm ? 'exactly' : 'about'} ${sats(quote.settleAmount)} sats` +
            `${quote.minSettleAmount ? `, at least ${sats(quote.minSettleAmount)}` : ''}, ${route}, to ${short(plan.to)}`,
    );
    say(`  Rate           ${rate.toFormat(0)} USDT per BTC, all costs in`);
    if (quote.maxDepositAmount) {
        say(`  Accepts up to  ${quote.maxDepositAmount} USDT`);
    }
    say(`  Pay by         ${clock(confirmBy)}, ${left} s from now (the price holds until ${clock(quote.expiresAt)})`);
}

async function convert(flags) {
    const plan = planConversion(flags);
    const maxUsdt = new BigNumber(flags['max-usdt'] ?? DEFAULT_MAX_USDT);
    if (!maxUsdt.isFinite() || !maxUsdt.isGreaterThan(0)) {
        throw new UsageError('--max-usdt takes a positive amount.');
    }
    if (plan.mode === 'exact_in' && new BigNumber(plan.amount).isGreaterThan(maxUsdt)) {
        throw new UsageError(`${plan.amount} USDT is over --max-usdt ${maxUsdt.toFixed()}.`);
    }
    const runsDir = path.resolve(flags['runs-dir'] ?? DEFAULT_RUNS_DIR);

    const { wallet, account } = await unlockWallet();
    await describeAccount(account);
    say();
    say(`Booking a quote: ${plan.fixed}, ${plan.mode}, to ${short(plan.to)}`);

    const prepared = await prepareUsdtConversion({
        account,
        settle: plan.settle,
        settleAddress: plan.to,
        amount: plan.amount,
        mode: plan.mode,
    });
    if (!prepared.ready) {
        const wait =
            prepared.retryAfterSeconds !== undefined ? `, retry in about ${Math.ceil(prepared.retryAfterSeconds / 60)} min` : '';
        say(`Not ready to send: ${prepared.code}${wait}. Nothing was booked or sent.`);
        return 1;
    }
    const { quote, order, confirmBy } = prepared;
    const run = openRun(runsDir, {
        version: 1,
        startedAt: iso(),
        request: { to: plan.to, settle: plan.settle, amount: plan.amount, mode: plan.mode },
        account: { address: account.address, publicKey: account.publicKey, path: account.path },
        quote,
        confirmBy: confirmBy.toISOString(),
        order,
        transfers: [],
        updates: [],
    });
    const { record } = run;

    say();
    showQuote(plan, quote, confirmBy);
    say(`  Run file       ${run.file}`);
    say();
    if (new BigNumber(quote.depositAmount).isGreaterThan(maxUsdt)) {
        say(`The deposit is over --max-usdt ${maxUsdt.toFixed()}. Nothing was sent.`);
        return 1;
    }

    const answer = (await prompt(`Type pay to send ${quote.depositAmount} USDT now, anything else cancels: `)).trim();
    if (answer.toLowerCase() !== 'pay') {
        record.cancelledAt = iso();
        run.save();
        say('Cancelled. Nothing was sent.');
        return 0;
    }
    if (Date.now() > confirmBy.getTime()) {
        record.cancelledAt = iso();
        run.save();
        say('Too late for this quote. Nothing was sent. Run again for a fresh one.');
        return 1;
    }

    // From here a transfer may be out, so stopping has to leave the way to settle it.
    const onStop = () => {
        say();
        say('Stopped mid-send. A transfer may still land, so do not pay again. Settle it with:');
        say(`  ${SCRIPT} follow ${run.file}`);
        process.exit(130);
    };
    process.on('SIGINT', onStop);
    let paid;
    try {
        paid = await payUsdtConversion({
            order,
            account,
            sign: tronTransferSignerForWallet(wallet),
            onSubmit: transfer => {
                record.transfers.push({ txID: transfer.txID, expirationMs: transfer.expirationMs, signedAt: iso() });
                run.save();
                say(`${clock(Date.now())}  signed ${transfer.txID}, posting it to the backend`);
            },
            onSent: receipt => {
                record.receipt = { ...receipt, sentAt: iso() };
                run.save();
                say(
                    `${clock(Date.now())}  broadcast: energy rented ${receipt.energyRented ?? 'not reported'}, ` +
                        `activated ${receipt.activated ?? 'not reported'}. Waiting for a block.`,
                );
            },
        });
    } catch (error) {
        if (!(error instanceof TronSendError)) {
            throw error;
        }
        record.error = {
            code: error.code,
            remedy: error.remedy,
            message: error.message,
            detail: error.detail,
            indeterminate: error.indeterminate,
            at: iso(),
        };
        run.save();
        say(`Send failed: ${error.code}, remedy ${error.remedy}. ${error.message}`);
        if (error.detail?.reason) {
            say(`  reason: ${error.detail.reason}`);
        }
        if (error.indeterminate) {
            say(`It may still land, so do not pay again. Settle it with: ${SCRIPT} follow ${run.file}`);
        }
        return 1;
    } finally {
        process.removeListener('SIGINT', onStop);
    }

    record.order = paid;
    run.save();
    await recordDeposit(run, paid.depositTxId);
    return followOrder(run);
}

/* ------------------------------------------------------------------ */
/* Following                                                           */
/* ------------------------------------------------------------------ */

async function followOrder(run) {
    const { record } = run;
    const controller = new AbortController();
    const onStop = () => {
        if (controller.signal.aborted) {
            say(`Resume with: ${SCRIPT} follow ${run.file}`);
            process.exit(130);
        }
        controller.abort();
        say('Stopping after the current read. Ctrl-C again to quit now.');
    };
    process.on('SIGINT', onStop);
    say(`Following the order every 5 s. Ctrl-C stops following, nothing is lost.`);

    let lastKey = '';
    let result;
    try {
        result = await followUsdtConversion(reviveOrder(record.order), {
            signal: controller.signal,
            onUpdate: ({ order, stall }) => {
                record.order = order;
                const key = [order.id, order.status, order.venueStatus, stall, order.issue].join('|');
                if (key !== lastKey) {
                    lastKey = key;
                    const now = new Date();
                    record.updates.push({
                        at: now.toISOString(),
                        id: order.id,
                        status: order.status,
                        venueStatus: order.venueStatus ?? null,
                        stall,
                        issue: order.issue ?? null,
                    });
                    // Flashnet has no order until it sees the deposit, so the
                    // first reading under a new id is the detection.
                    if (!record.detection && order.id !== record.quote.id) {
                        record.detection = {
                            orderId: order.id,
                            flashnetCreatedAt: new Date(order.createdAt).toISOString(),
                            observedAt: now.toISOString(),
                        };
                    }
                    say(
                        `${clock(now)}  ${order.status}${order.venueStatus ? ` (${order.venueStatus})` : ''}` +
                            `${stall !== 'none' ? `, stall: ${stall}` : ''}${order.issue ? `, ${order.issue}` : ''}`,
                    );
                }
                run.save();
            },
        });
    } finally {
        process.removeListener('SIGINT', onStop);
    }

    if (controller.signal.aborted) {
        say(`Stopped following. Resume with: ${SCRIPT} follow ${run.file}`);
        return 130;
    }
    const final = result.order;
    record.outcome = {
        status: final.status,
        at: iso(),
        settleAmount: final.settleAmount,
        settleTxId: final.settleTxId ?? null,
        issue: final.issue ?? null,
    };
    run.save();
    report(run);
    return final.status === 'settled' ? 0 : 1;
}

function report(run) {
    const { record } = run;
    const block = record.deposit?.blockTimeMs;
    const created = record.detection ? Date.parse(record.detection.flashnetCreatedAt) : undefined;
    const seen = record.detection ? Date.parse(record.detection.observedAt) : undefined;
    const end = Date.parse(record.outcome.at);
    say();
    say(`Result             ${record.outcome.status}${record.outcome.issue ? ` (${record.outcome.issue})` : ''}`);
    if (record.receipt) {
        say(
            `Energy rented      ${record.receipt.energyRented ?? 'not reported'}, ` +
                `activated ${record.receipt.activated ?? 'not reported'}`,
        );
    }
    if (block) {
        say(`Deposit block      ${record.deposit.blockNumber}, at ${clock(block)}`);
    }
    if (created !== undefined) {
        say(`Flashnet order     created ${clock(created)}${block ? `, ${secs(created - block)} after the block` : ''}`);
    }
    if (seen !== undefined && block) {
        say(`First seen by us   ${secs(seen - block)} after the block (polling every 5 s)`);
    }
    if (block) {
        say(`Finished           ${secs(end - block)} after the block, as polled`);
    }
    if (record.outcome.status === 'settled' && record.outcome.settleAmount) {
        say(`Delivered          ${sats(record.outcome.settleAmount)} sats`);
    }
    if (record.outcome.settleTxId) {
        say(`${record.outcome.status === 'settled' ? 'Payout reference' : 'Refund reference'}   ${record.outcome.settleTxId}`);
    }
    say(`Run file           ${run.file}`);
}

async function followCommand(positional) {
    const file = positional[0];
    if (!file) {
        throw new UsageError('follow needs the run file.');
    }
    const run = attachRun(path.resolve(file), JSON.parse(fs.readFileSync(file, 'utf8')));
    const { record } = run;
    if (record.outcome) {
        report(run);
        return record.outcome.status === 'settled' ? 0 : 1;
    }
    if (!record.deposit) {
        if (!record.transfers?.length) {
            say('This run never signed a transfer, so nothing was sent.');
            return 0;
        }
        say('Settling the transfers this run signed, newest first.');
        let landed = null;
        for (const transfer of [...record.transfers].reverse()) {
            const fate = await awaitUsdtTransferOutcome(transfer.txID, transfer.expirationMs);
            say(`  ${transfer.txID}: ${fate.status}${fate.reason ? ` (${fate.reason})` : ''}`);
            if (fate.status === 'succeeded') {
                landed = transfer;
                break;
            }
        }
        if (!landed) {
            record.outcome = { status: 'not_sent', at: iso(), settleAmount: null, settleTxId: null, issue: null };
            run.save();
            say('None of them moved any USDT. Nothing was sent.');
            return 0;
        }
        record.order = { ...record.order, depositTxId: landed.txID, statusChangedAt: iso() };
        run.save();
        await recordDeposit(run, landed.txID);
    }
    return followOrder(run);
}

/* ------------------------------------------------------------------ */

async function main() {
    const { command, flags, positional } = parseArgs(process.argv.slice(2));
    switch (command) {
        case 'address': {
            const watched = positional[0];
            if (watched !== undefined && !isValidTronAddress(watched)) {
                throw new Refusal('That is not a Tron address.');
            }
            const account = watched ? { address: watched, path: 'read only' } : (await unlockWallet()).account;
            await describeAccount(account);
            return 0;
        }
        case 'convert':
            return convert(flags);
        case 'follow':
            return followCommand(positional);
        default:
            say(USAGE);
            return command && command !== 'help' && command !== '--help' ? 64 : 0;
    }
}

function exitOn(error) {
    if (error instanceof Stopped) {
        say('Stopped. Nothing was sent.');
        process.exit(130);
    }
    if (error instanceof UsageError) {
        say(error.message);
        say();
        say(USAGE);
        process.exit(64);
    }
    if (error instanceof Refusal) {
        say(error.message);
        process.exit(1);
    }
    say(`Failed: ${error?.stack ?? error}`);
    if (activeRun?.record.transfers?.length && !activeRun.record.outcome) {
        say(`A transfer was signed in this run. Settle it with: ${SCRIPT} follow ${activeRun.file}`);
    }
    process.exit(1);
}

if (require.main === module) {
    main().then(code => process.exit(code), exitOn);
} else {
    // Required only to check the pure parts: run nothing.
    module.exports = { invoiceSats, planConversion, report };
}
