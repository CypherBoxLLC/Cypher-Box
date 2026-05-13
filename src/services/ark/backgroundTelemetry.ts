import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Rolling buffer of the last N background-refresh attempts.
 *
 * Lives in AsyncStorage so it survives process death — which is exactly
 * what we need to diagnose iOS BGAppRefreshTask scheduling weirdness. The
 * OS won't tell us when (or whether) it ran our task; the only ground
 * truth is what the task itself recorded before exiting.
 *
 * 50 entries × ~200 bytes ≈ 10 KB. Comfortable for AsyncStorage.
 */
const STORAGE_KEY = 'ark-bg-refresh-telemetry';
const MAX_ENTRIES = 50;

export type ArkBgRefreshTrigger = 'scheduled' | 'push' | 'manual-test' | 'arrival' | 'foreground';

export type ArkBgRefreshOutcome =
    | 'success'
    | 'no_eligible_vtxos'
    | 'rate_limited'
    | 'pending_round_conflict'
    | 'fee_gated'
    | 'dust_uneconomic'
    | 'dust_stranded'
    | 'no_seed'
    | 'disabled'
    | 'error';

export type ArkBgRefreshTelemetryEntry = {
    at: number;
    trigger: ArkBgRefreshTrigger;
    outcome: ArkBgRefreshOutcome;
    elapsedMs: number;
    vtxoCount?: number;
    feeSats?: number;
    errorMsg?: string;
};

export async function recordTelemetry(entry: ArkBgRefreshTelemetryEntry): Promise<void> {
    try {
        const existing = await readTelemetry();
        const next = [entry, ...existing].slice(0, MAX_ENTRIES);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
        // Telemetry must not break the refresh flow. Log and move on.
        console.warn('[Ark bg telemetry] write failed:', err);
    }
}

export async function readTelemetry(): Promise<ArkBgRefreshTelemetryEntry[]> {
    try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed as ArkBgRefreshTelemetryEntry[];
    } catch {
        return [];
    }
}

export async function clearTelemetry(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY);
}
