import { getArkWalletHandle } from './walletHandle';

/**
 * Plain-JS view of one Ark movement, suitable for the history list UI.
 *
 * The SDK's `Movement` struct carries bigints (i64/u64 balance + fee) and a
 * stringly-typed JSON blob (`metadataJson`) whose shape depends on the
 * subsystem that produced the movement (Ark round, Lightning send/receive,
 * on-chain board/exit, arkoor OOR send, …). We flatten all of that into a
 * single predictable shape so list components don't have to care.
 *
 * Sign convention: `amountSats` is positive for inflows (balance went up),
 * negative for outflows (balance went down). We use `effectiveBalanceSats` —
 * the actual settled change — not `intendedBalanceSats`, so a failed/refunded
 * send surfaces with a zero (or small fee-only) delta rather than the ghost
 * amount the user originally tried to move.
 */
export type ArkMovementView = {
    /** SDK-assigned row id; stable across refetches, good for keyExtractor. */
    id: number;
    /** Signed sats. Positive = received, negative = sent. */
    amountSats: number;
    /** Offchain fee the wallet paid for this movement (0 for inbound). */
    feeSats: number;
    /** Lower-cased SDK status: `pending` | `successful` | `failed` | `canceled`. */
    status: ArkMovementStatus;
    /** Coarse category for UI tagging — drives the row icon + sub-label. */
    kind: ArkMovementKind;
    /** One-line human-readable summary ("Received via Lightning", etc.). */
    description: string;
    /** Milliseconds since epoch. Built from `createdAt` for stable grouping. */
    timestamp: number;
    /** Addresses/invoices the wallet paid to (non-empty for sends). */
    sentTo: string[];
    /** Addresses/invoices the wallet received on (non-empty for receives). */
    receivedOn: string[];
    /** VTXOs consumed by this movement (informational; surface on details). */
    inputVtxoIds: string[];
    /** VTXOs produced by this movement. */
    outputVtxoIds: string[];
    /** Parsed `metadataJson`, best-effort. `null` if parse failed or empty. */
    metadata: Record<string, unknown> | null;
    /** Raw SDK fields — kept so power-user / debug screens can surface them. */
    raw: {
        status: string;
        subsystemName: string;
        subsystemKind: string;
        metadataJson: string;
        createdAt: string;
        completedAt?: string;
    };
};

export type ArkMovementStatus =
    | 'pending'
    | 'successful'
    | 'failed'
    | 'canceled'
    | 'unknown';

/**
 * Coarse UI categories. Derived from the SDK's `subsystemKind` /
 * `subsystemName`, which we don't want to leak directly into the UI because
 * (a) they're PascalCase / free-form, (b) Rust can rename them across SDK
 * upgrades without warning. This mapping is the one place we'd change if
 * that happens.
 */
export type ArkMovementKind =
    | 'lightning'
    | 'ark'
    | 'onchain'
    | 'board'
    | 'exit'
    | 'refresh'
    | 'other';

function normaliseStatus(status: string): ArkMovementStatus {
    const s = status.toLowerCase();
    if (s === 'pending' || s === 'successful' || s === 'failed' || s === 'canceled') {
        return s;
    }
    return 'unknown';
}

/**
 * Classify a Movement into a UI-facing kind.
 *
 * SDK emits fields like:
 *   subsystemKind="Ark", subsystemName="Round"
 *   subsystemKind="Ark", subsystemName="ArkoorSend"
 *   subsystemKind="Lightning", subsystemName="Send" | "Receive"
 *   subsystemKind="Onchain", subsystemName="Board" | "Exit"
 *
 * We pick the most specific label that still has a useful UI meaning. When
 * in doubt, fall back to `'other'` — the row will still render with a
 * generic label rather than disappear.
 */
function classifyKind(subsystemKind: string, subsystemName: string): ArkMovementKind {
    const k = subsystemKind.toLowerCase();
    const n = subsystemName.toLowerCase();

    if (k === 'lightning') return 'lightning';
    if (k === 'onchain' || k === 'bitcoin') {
        if (n.includes('board')) return 'board';
        if (n.includes('exit')) return 'exit';
        return 'onchain';
    }
    if (k === 'ark') {
        if (n.includes('refresh')) return 'refresh';
        return 'ark';
    }
    return 'other';
}

/**
 * Build the row description. Direction is derived from the effective sats
 * delta (positive = received) rather than the subsystem name — same verb set
 * works for every kind and survives SDK renames.
 *
 * Pending / failed / canceled movements get a status prefix so the user
 * doesn't mis-read them as completed.
 */
function describe(
    amountSats: number,
    kind: ArkMovementKind,
    status: ArkMovementStatus,
): string {
    const direction = amountSats >= 0 ? 'Received' : 'Sent';
    const via = ((): string => {
        switch (kind) {
            case 'lightning': return 'via Lightning';
            case 'ark':       return 'via Ark';
            case 'onchain':   return 'on-chain';
            case 'board':     return 'boarded to Ark';
            case 'exit':      return 'exit to on-chain';
            case 'refresh':   return 'Ark refresh';
            default:          return '';
        }
    })();

    // Refresh movements don't really have a "direction" from the user's
    // perspective — the VTXOs come back with a fresh expiry, minus the fee.
    // Label them explicitly so the row doesn't read as "Sent via Ark
    // refresh", which is technically true but reads weirdly.
    const body =
        kind === 'refresh'
            ? 'Capsule refresh'
            : via
                ? `${direction} ${via}`
                : direction;

    switch (status) {
        case 'pending':   return `Pending — ${body.toLowerCase()}`;
        case 'failed':    return `Failed — ${body.toLowerCase()}`;
        case 'canceled':  return `Canceled — ${body.toLowerCase()}`;
        default:          return body;
    }
}

function parseMetadata(json: string): Record<string, unknown> | null {
    if (!json) return null;
    try {
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function parseTimestamp(iso: string): number {
    // SDK emits RFC3339 strings. Date.parse returns NaN on malformed input —
    // fall back to "now" so the row still groups into today rather than
    // crashing the list. Better to show with a slightly-wrong date than not
    // at all.
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : Date.now();
}

/**
 * Fetch the full Ark transaction history from the local SQLite datadir.
 *
 * Returns `null` when the wallet handle isn't open — callers should treat
 * that the same as "not signed in yet" and keep whatever they previously
 * rendered. A freshly-created wallet with zero movements resolves to `[]`,
 * not `null`.
 *
 * Movements are returned sorted newest-first so SectionList rendering is
 * straightforward. The SDK's native order appears to already be chronological
 * but we don't rely on that — explicit sort beats a future SDK change that
 * silently flips it.
 */
export async function fetchArkHistory(): Promise<ArkMovementView[] | null> {
    const handle = getArkWalletHandle();
    if (!handle) {
        console.log('[Ark history] handle not initialized — returning null');
        return null;
    }

    const raw = await handle.history();
    const views: ArkMovementView[] = raw.map((m) => {
        const amountSats = Number(m.effectiveBalanceSats);
        const feeSats = Number(m.offchainFeeSats);
        const status = normaliseStatus(m.status);
        const kind = classifyKind(m.subsystemKind, m.subsystemName);
        return {
            id: m.id,
            amountSats,
            feeSats,
            status,
            kind,
            description: describe(amountSats, kind, status),
            timestamp: parseTimestamp(m.createdAt),
            sentTo: m.sentToAddresses,
            receivedOn: m.receivedOnAddresses,
            inputVtxoIds: m.inputVtxoIds,
            outputVtxoIds: m.outputVtxoIds,
            metadata: parseMetadata(m.metadataJson),
            raw: {
                status: m.status,
                subsystemName: m.subsystemName,
                subsystemKind: m.subsystemKind,
                metadataJson: m.metadataJson,
                createdAt: m.createdAt,
                completedAt: m.completedAt,
            },
        };
    });

    // Newest first — sort by timestamp desc, stable on id for same-instant ties.
    views.sort((a, b) => {
        if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
        return b.id - a.id;
    });

    // One-line diagnostic: counts by kind/status help triage "history is
    // empty but I know I sent something" reports without needing to inspect
    // individual rows. Cheap, keep on until the history flow is solid.
    if (views.length > 0) {
        const counts: Record<string, number> = {};
        for (const v of views) {
            const key = `${v.kind}/${v.status}`;
            counts[key] = (counts[key] ?? 0) + 1;
        }
        console.log('[Ark history] fetched', views.length, 'movements:', counts);
    } else {
        console.log('[Ark history] fetched 0 movements');
    }

    return views;
}
