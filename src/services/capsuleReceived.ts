import useCapsuleReceivedStore, {
    CapsuleCursor,
    CapsuleVault,
    ReceivedCapsule,
    isCapsuleStoreHydrated,
} from "@Cypher/stores/capsuleReceivedStore";

const BlueElectrum = require("../../blue_modules/BlueElectrum");

// Finds capsules (on-chain UTXOs) that newly arrived in the Hot Vault or the
// Cold Vault, so the capsule-received popup can offer to label them.
//
// BlueWallet has no "coin arrived" callback, so this diffs each vault's UTXO
// set against the outpoints already handled, after a fresh Electrum fetch.
// Rules, agreed with the product owner:
//   - a capsule pops up once it has one confirmation, never while pending;
//   - capsules already in a vault the first time the app looks at it (the
//     update installs, a vault is created, recovered or connected) never pop up;
//   - change and consolidations (made by spending the same vault's coins) never
//     pop up; a move from the other vault does, in the vault that receives it.

export type CapsuleUtxo = {
    txid: string;
    vout: number;
    /** sats */
    value: number;
    /** block height, 0 while unconfirmed */
    height: number;
    address?: string;
};

/** What this module needs of a vault wallet; BlueWallet's HD and watch-only wallets both fit. */
export type CapsuleWallet = {
    getID(): string;
    fetchBalance(): Promise<unknown>;
    fetchUtxo(): Promise<unknown>;
    getUtxo(respectFrozen?: boolean): any[];
    getTransactions(): any[];
    weOwnAddress(address: string): boolean;
    addressIsChange?(address: string): boolean;
    _utxo?: any[];
    _hdWalletInstance?: { _utxo?: any[] } | null;
};

export type CapsuleTarget = { wallet: CapsuleWallet; vault: CapsuleVault };

export const outpointId = (txid: string, vout: number) => `${txid}:${vout}`;

/**
 * The first look records the chain height less this margin, because the height
 * is an estimate. Coins confirmed in that margin, if BlueWallet finds them late,
 * pop up; better that than missing a real receive.
 */
const BASE_HEIGHT_MARGIN = 12;
/** Spent outpoints are dropped from a cursor once it holds this many. */
const SEEN_CAP = 5000;
/** A check that takes longer is abandoned; the next one starts fresh. */
const CHECK_TIMEOUT_MS = 45_000;

export type CapsuleDiffInput = {
    walletId: string;
    vault: CapsuleVault;
    /** the wallet's UTXOs, fresh from Electrum */
    utxos: CapsuleUtxo[];
    cursor: CapsuleCursor | undefined;
    tipHeight: number;
    now: number;
    /** true when the capsule's transaction spends coins of this same wallet */
    isOwnSpend: (utxo: CapsuleUtxo) => boolean;
};

export type CapsuleDiffResult = { cursor: CapsuleCursor; announce: ReceivedCapsule[] };

export function diffCapsules({ walletId, vault, utxos, cursor, tipHeight, now, isOwnSpend }: CapsuleDiffInput): CapsuleDiffResult {
    const confirmed = utxos.filter(u => u.height > 0);

    // First look at this wallet: whatever is confirmed in it now was already there.
    // Pending capsules stay out of the record, so they pop up once they confirm.
    if (!cursor) {
        return {
            cursor: {
                seen: confirmed.map(u => outpointId(u.txid, u.vout)),
                baseHeight: Math.max(0, tipHeight - BASE_HEIGHT_MARGIN),
            },
            announce: [],
        };
    }

    const seen = new Set(cursor.seen);
    const added: string[] = [];
    const announce: ReceivedCapsule[] = [];
    for (const u of confirmed) {
        const id = outpointId(u.txid, u.vout);
        if (seen.has(id)) continue;
        seen.add(id);
        added.push(id);
        if (u.height <= cursor.baseHeight) continue; // there before the first look, found late
        if (isOwnSpend(u)) continue; // change, or a consolidation inside this vault
        announce.push({ id, vault, walletId, txid: u.txid, vout: u.vout, sats: u.value, height: u.height, seenAt: now });
    }

    let nextSeen = added.length > 0 ? [...cursor.seen, ...added] : cursor.seen;
    if (nextSeen.length > SEEN_CAP) {
        // a spent outpoint never comes back, so those are the safe ones to forget
        const live = new Set(utxos.map(u => outpointId(u.txid, u.vout)));
        nextSeen = nextSeen.filter(id => live.has(id));
        if (nextSeen.length > SEEN_CAP) nextSeen = nextSeen.slice(nextSeen.length - SEEN_CAP);
    }

    announce.sort((a, b) => a.height - b.height || a.txid.localeCompare(b.txid) || a.vout - b.vout);
    return { cursor: { seen: nextSeen, baseHeight: cursor.baseHeight }, announce };
}

/**
 * The UTXOs Electrum just returned. When that list is empty, BlueWallet's
 * getUtxo() works coins out from cached transactions instead, and those can be
 * stale, so an empty fetch means no capsules.
 */
export function fetchedUtxos(wallet: CapsuleWallet): CapsuleUtxo[] {
    const holder = wallet._hdWalletInstance ?? wallet;
    if (!Array.isArray(holder?._utxo) || holder._utxo.length === 0) return [];
    return wallet
        .getUtxo(true) // true keeps frozen capsules in
        .map((u: any) => ({
            txid: u.txid ?? u.txId,
            vout: Number(u.vout),
            value: Number(u.value ?? u.amount ?? 0),
            height: Number(u.height ?? 0),
            address: u.address,
        }))
        .filter((u: CapsuleUtxo) => typeof u.txid === "string" && u.txid.length > 0 && Number.isInteger(u.vout));
}

const addressOf = (output: any): string | undefined => output?.scriptPubKey?.addresses?.[0] ?? output?.scriptPubKey?.address;

/**
 * The addresses a transaction spends from: from the wallet's cached copy when it
 * has one, else from Electrum, which takes the transaction and the ones its inputs
 * came from (BlueElectrum caches them). Not the wallet's whole history, which can
 * be large. Null when neither works.
 */
export async function spentAddresses(wallet: CapsuleWallet, txid: string): Promise<string[] | null> {
    try {
        const cached = (wallet.getTransactions() ?? []).find((tx: any) => tx?.txid === txid);
        if (cached && Array.isArray(cached.inputs)) {
            return cached.inputs.map((vin: any) => vin?.address || vin?.addresses?.[0]).filter(Boolean);
        }
    } catch (_) {
        // no cached transactions; ask Electrum
    }
    try {
        const tx = (await BlueElectrum.multiGetTransactionByTxid([txid], 10, true))?.[txid];
        if (!tx || !Array.isArray(tx.vin)) return null;
        const inputs = tx.vin.filter((vin: any) => typeof vin?.txid === "string"); // none for a coinbase
        if (inputs.length === 0) return [];
        const previous = await BlueElectrum.multiGetTransactionByTxid(
            inputs.map((vin: any) => vin.txid),
            10,
            true,
        );
        return inputs
            .map((vin: any) => {
                const outputs = previous?.[vin.txid]?.vout ?? [];
                return addressOf(outputs.find((out: any) => out?.n === vin.vout) ?? outputs[vin.vout]);
            })
            .filter(Boolean);
    } catch (_) {
        return null;
    }
}

/**
 * True when the capsule's transaction spends coins of the same wallet: change, or
 * a consolidation. Without the spent addresses, a change address still gives it away.
 */
export function isOwnSpend(wallet: CapsuleWallet, utxo: CapsuleUtxo, spent: string[] | null): boolean {
    if (spent) return spent.some(address => wallet.weOwnAddress(address));
    return !!utxo.address && typeof wallet.addressIsChange === "function" && wallet.addressIsChange(utxo.address);
}

/** Refreshes one vault wallet from Electrum and queues its newly confirmed capsules. */
export async function checkWalletForNewCapsules(wallet: CapsuleWallet, vault: CapsuleVault): Promise<ReceivedCapsule[]> {
    const walletId = wallet.getID();
    // fetchUtxo only asks about addresses that fetchBalance found money on
    await wallet.fetchBalance();
    await wallet.fetchUtxo();
    const utxos = fetchedUtxos(wallet);

    // look up how the new capsules were made; only those, and only after the first look
    const spent = new Map<string, string[] | null>();
    const before = useCapsuleReceivedStore.getState().cursors[walletId];
    if (before) {
        const seen = new Set(before.seen);
        for (const u of utxos) {
            if (u.height > before.baseHeight && !seen.has(outpointId(u.txid, u.vout)) && !spent.has(u.txid)) {
                spent.set(u.txid, await spentAddresses(wallet, u.txid));
            }
        }
    }

    // read and write the record with no await in between, so two checks can't undo each other
    const store = useCapsuleReceivedStore.getState();
    const { cursor, announce } = diffCapsules({
        walletId,
        vault,
        utxos,
        cursor: store.cursors[walletId],
        tipHeight: BlueElectrum.estimateCurrentBlockheight(),
        now: Date.now(),
        isOwnSpend: u => isOwnSpend(wallet, u, spent.get(u.txid) ?? null),
    });
    store.setCursor(walletId, cursor);
    store.enqueue(announce);
    // a queued capsule that was spent before the user saw it has nothing left to label
    store.retainLive(walletId, utxos.map(u => outpointId(u.txid, u.vout)));
    return announce;
}

let running: Promise<void> | null = null;
let again = false;
// a check that outlived its timeout keeps running; the vault waits for it rather than start another
const inFlight = new Map<string, Promise<unknown>>();

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(undefined), ms);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });

/**
 * Checks every vault `getTargets` returns, one wallet after the other. Only one
 * run at a time: a request during a run makes it go round once more, with the
 * vaults as they are then.
 */
export function checkVaultsForNewCapsules(
    getTargets: () => CapsuleTarget[],
    timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<void> {
    if (!isCapsuleStoreHydrated()) return Promise.resolve();
    if (running) {
        again = true;
        return running;
    }
    running = (async () => {
        do {
            again = false;
            let targets: CapsuleTarget[] = [];
            try {
                targets = getTargets();
            } catch (_) {
                // no vaults to look at this time round
            }
            for (const { wallet, vault } of targets) {
                const walletId = wallet.getID();
                if (inFlight.has(walletId)) continue;
                const check = checkWalletForNewCapsules(wallet, vault).finally(() => inFlight.delete(walletId));
                inFlight.set(walletId, check);
                try {
                    await withTimeout(check, timeoutMs);
                } catch (e) {
                    if (__DEV__) console.log(`[CapsuleReceived] ${vault} vault check failed:`, (e as Error)?.message);
                }
            }
        } while (again);
    })().finally(() => {
        running = null;
    });
    return running;
}

let requester: (() => void) | null = null;

/** Set by the popup's watcher; push notifications use it to look right away. */
export const setCapsuleCheckRequester = (fn: (() => void) | null) => {
    requester = fn;
};

/** Asks for a vault check now, for example after a push about an on-chain payment. */
export const requestCapsuleCheck = () => {
    requester?.();
};
