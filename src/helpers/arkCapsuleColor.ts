import { colors } from "@Cypher/style-guide";

export type CapsuleColorBand = {
    color: string;
    status: 'green' | 'yellow' | 'orange' | 'red';
};

/**
 * Map a VTXO's days-remaining to its expiry colour band.
 *
 * Same thresholds and palette as the per-row depletion ring in
 * src/screens/Strike/CheckingAccountNew/ArkCapsules.tsx so the in-Card
 * capsule slots, the per-row rings on the V-capsules tab, and the
 * help-screen legend all read off the same colors.
 *
 *   >=21d  → green  (fresh, no action)
 *   14-20d → yellow (past midlife, monitor)
 *   7-13d  → orange (refresh window — auto-refresh will pick it up)
 *   <7d    → red    (urgent — refresh now or risk losing chain-enforced exit)
 */
export function getCapsuleColorBand(daysLeft: number): CapsuleColorBand {
    if (daysLeft >= 21) return { color: '#4ADE80', status: 'green' };
    if (daysLeft >= 14) return { color: colors.ark?.light ?? '#F2C94C', status: 'yellow' };
    if (daysLeft >= 7) return { color: '#FB923C', status: 'orange' };
    return { color: colors.redLight ?? '#FF6B6B', status: 'red' };
}
