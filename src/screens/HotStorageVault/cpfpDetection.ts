/**
 * cpfpDetection — identifies fee-only self-spend children that exist solely
 * to accelerate a wallet-owned parent transaction (Child Pays For Parent).
 *
 * Why this exists:
 *   When the Accelerate-transaction flow runs CPFP via
 *   `HDSegwitBech32Transaction.createCPFPbumpFee`, the resulting child tx
 *   spends an unconfirmed output back to a change address in the same
 *   wallet. BlueWallet's stock tx list renders that child as a separate
 *   row showing the negative fee amount (e.g. "-1,344 sats"), which reads
 *   as a regular outbound spend and confuses users right after they
 *   accelerated a deposit.
 *
 *   We suppress the child row entirely and badge the parent row with
 *   "⚡ Accelerated · +X sats fee" so the history reads naturally as
 *   "I received X, with a small bump fee" rather than as two separate
 *   apparent movements.
 *
 * Detection criteria for a CPFP child (all must hold):
 *   1. The wallet's net for the tx is negative (we initiated it).
 *   2. All outputs go to addresses our wallet owns (self-spend).
 *   3. At least one input references the txid of another tx in our own
 *      wallet's history (the parent). That parent is what we badge.
 *
 * Limitations:
 *   - Requires `input.txid` (or `.hash` / `.prev_hash`) to be present on
 *     the tx item. BlueWallet's electrum-fetched tx items typically have
 *     this; if a fetch returned a stub without prevout txids the child
 *     won't be classified and will fall through to the default render
 *     (still correct, just not pretty). Failing-open is the safe choice
 *     because misclassification could hide a real outbound spend.
 *   - Does not handle chained CPFPs (child of a child). For now those
 *     render as a normal tx — rare enough that bespoke handling isn't
 *     worth the LOC.
 */

interface CpfpChildInfo {
    childTxid: string;
    childFeeSats: number;
}

export interface CpfpRelations {
    /** Map parent-txid → { childTxid, childFeeSats }. Use this to badge parents. */
    accelerators: Map<string, CpfpChildInfo>;
    /** Set of child txids to drop from the displayed list. */
    suppressedChildIds: Set<string>;
}

function getTxid(tx: any): string | null {
    return (tx?.hash || tx?.txid) ?? null;
}

function getOutputAddresses(output: any): string[] {
    if (!output) return [];
    const fromScript = output?.scriptPubKey?.addresses;
    if (Array.isArray(fromScript)) return fromScript;
    if (Array.isArray(output?.addresses)) return output.addresses;
    return [];
}

function getInputParentTxid(input: any): string | null {
    if (!input) return null;
    // BlueWallet shape varies by provider — electrum returns `txid`,
    // BIP47 paths sometimes use `hash`, raw bitcoind RPC uses `prev_hash`.
    return input.txid || input.hash || input.prev_hash || null;
}

export function detectCpfpRelations(txs: any[], wallet: any): CpfpRelations {
    const accelerators = new Map<string, CpfpChildInfo>();
    const suppressedChildIds = new Set<string>();

    if (!Array.isArray(txs) || txs.length === 0) {
        return { accelerators, suppressedChildIds };
    }

    const ownTxByHash = new Map<string, any>();
    for (const t of txs) {
        const id = getTxid(t);
        if (id) ownTxByHash.set(id, t);
    }

    const weOwn: (addr: string) => boolean =
        typeof wallet?.weOwnAddress === 'function'
            ? (addr: string) => Boolean(wallet.weOwnAddress(addr))
            : () => false;

    for (const tx of txs) {
        // Criterion 1: wallet's net is negative (we initiated)
        if (typeof tx?.value !== 'number' || tx.value >= 0) continue;

        const childTxid = getTxid(tx);
        if (!childTxid) continue;

        // Criterion 2: every output addr is ours
        const outputs = Array.isArray(tx.outputs) ? tx.outputs : [];
        if (outputs.length === 0) continue;
        const allOutputsOurs = outputs.every((o: any) => {
            const addrs = getOutputAddresses(o);
            return addrs.length > 0 && addrs.every(weOwn);
        });
        if (!allOutputsOurs) continue;

        // Criterion 3: at least one input references one of our own txs
        const inputs = Array.isArray(tx.inputs) ? tx.inputs : [];
        let parentTxid: string | null = null;
        for (const input of inputs) {
            const candidateId = getInputParentTxid(input);
            if (
                candidateId &&
                candidateId !== childTxid &&
                ownTxByHash.has(candidateId)
            ) {
                parentTxid = candidateId;
                break;
            }
        }
        if (!parentTxid) continue;

        // All criteria met — register this child as a CPFP accelerator
        // for its parent.
        accelerators.set(parentTxid, {
            childTxid,
            childFeeSats: Math.abs(tx.value),
        });
        suppressedChildIds.add(childTxid);
    }

    return { accelerators, suppressedChildIds };
}
