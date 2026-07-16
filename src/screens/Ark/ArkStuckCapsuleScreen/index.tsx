import React, { useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, TextInput, TouchableOpacity, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import {
    AVG_BLOCK_MINUTES,
    cancelArkPendingRound,
    estimateArkOffboardFee,
    fetchArkBalance,
    fetchArkVtxos,
    getArkCancelling,
    offboardArkVtxos,
    setArkCancelling,
    syncArkWallet,
} from "@Cypher/services/ark";
import { estimateSwapFee, listLightningSwapProviders, swap } from "@Cypher/services/lightningSwap";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import { BlueStorageContext } from "../../../../blue_modules/storage-context";

/**
 * ArkStuckCapsuleScreen: the "your refresh is stuck, move your funds out" rescue.
 *
 * Self-contained, no keyboard, no swap screen. On mount it cancels the wedged
 * round to UNLOCK the funds (cancelling only unlocks, never spends, per Erik /
 * Bark), then selects the capsules that are ABOUT TO EXPIRE and moves exactly
 * those out when the user picks a wallet and taps Exit:
 *   - Hot / Cold vault / External address: `offboardArkVtxos(expiringIds, addr)`,
 *     exact coin control on-chain (the offboard fee is taken out of the amount).
 *   - Strike / Coinos: the Lightning swap engine. bark has no LN coin control,
 *     but Second confirmed the wallet spends closest-to-expiry VTXOs first, so
 *     swapping the near-expiry sum spends exactly those. The Ark LN routing fee
 *     is charged ON TOP, so we swap (sum - fee) to leave headroom.
 *
 * The unilateral Emergency Exit is deliberately NOT offered here (it needs ~a
 * day of runway to unroll before expiry, so it is an early tool, not a
 * near-expiry rescue). It stays in Settings.
 */

type Dest = "strike" | "coinos" | "hot" | "cold" | "external";

// "About to expire" window. The feature is reached at 12h; 24h captures the
// at-risk set with margin. Tunable.
const ABOUT_TO_EXPIRE_BLOCKS = Math.round((24 * 60) / AVG_BLOCK_MINUTES);

function looksLikeBitcoinAddress(s: string): boolean {
    const t = s.trim();
    if (t.length < 14 || t.length > 100) return false;
    return /^(bc1|tb1|bcrt1|[13]|[mn2])[a-zA-Z0-9]+$/.test(t);
}

export default function ArkStuckCapsuleScreen() {
    const arkVtxos = useAuthStore((s) => s.arkVtxos);
    const tip = useAuthStore((s) => s.arkChainTipHeight);
    const walletID = useAuthStore((s) => s.walletID);
    const coldStorageWalletID = useAuthStore((s) => s.coldStorageWalletID);
    const { wallets } = useContext(BlueStorageContext);

    const [preparing, setPreparing] = useState(true);
    const [selected, setSelected] = useState<Dest | null>(null);
    const [externalAddr, setExternalAddr] = useState("");
    const [feeSats, setFeeSats] = useState<number | null>(null);
    const [estimating, setEstimating] = useState(false);
    const [exiting, setExiting] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

    // Cancel the wedged round on mount to unlock the funds, then reconcile.
    useEffect(() => {
        let done = false;
        (async () => {
            const stuck = useAuthStore.getState().arkRefreshStuck;
            if (stuck && stuck.stuckRoundIds.length > 0 && !getArkCancelling()) {
                setArkCancelling(true);
                try {
                    for (const id of stuck.stuckRoundIds) {
                        try {
                            await cancelArkPendingRound(id);
                        } catch {
                            // cancelArkPendingRound already logs the inner BarkError.
                        }
                    }
                    try {
                        await syncArkWallet();
                        await Promise.all([fetchArkBalance(), fetchArkVtxos()]);
                    } catch {
                        // Non-fatal; the next sync tick reconciles.
                    }
                    useAuthStore.getState().setArkRefreshStuck(null);
                } finally {
                    setArkCancelling(false);
                }
            }
            if (!done) setPreparing(false);
        })();
        return () => {
            done = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Capsules about to expire: spendable, non-arkoor, within the window.
    const expiring = useMemo(() => {
        if (tip == null) return { ids: [] as string[], sats: 0 };
        const ids: string[] = [];
        let sats = 0;
        for (const v of arkVtxos) {
            if (v.state.toLowerCase() !== "spendable") continue;
            if (v.expiryHeight <= 0) continue; // arkoor (no own expiry)
            const blocksLeft = v.expiryHeight - tip;
            if (blocksLeft <= 0) continue; // already expired
            if (blocksLeft > ABOUT_TO_EXPIRE_BLOCKS) continue;
            ids.push(v.id);
            sats += v.sats;
        }
        return { ids, sats };
    }, [arkVtxos, tip]);

    const strikeMe = useAuthStore((s) => s.strikeMe);
    const coinosUser = useAuthStore((s) => s.user);
    const swapAvail = useMemo(() => {
        const providers = listLightningSwapProviders();
        return {
            strike: providers.find((p) => p.id === "strike")?.isAvailable() ?? false,
            coinos: providers.find((p) => p.id === "coinos")?.isAvailable() ?? false,
        };
    }, []);

    const resolveVaultAddress = (id?: string): string | null => {
        if (!id) return null;
        const w: any = (wallets || []).find((x: any) => x?.getID?.() === id);
        if (!w) return null;
        try {
            const next = w.getNextFreeAddressIndex?.() ?? 0;
            return w._getExternalAddressByIndex?.(next) || null;
        } catch {
            return null;
        }
    };

    const addressFor = (dest: Dest): string | null => {
        if (dest === "hot") return resolveVaultAddress(walletID);
        if (dest === "cold") return resolveVaultAddress(coldStorageWalletID);
        if (dest === "external") return looksLikeBitcoinAddress(externalAddr) ? externalAddr.trim() : null;
        return null;
    };

    const isOnchain = (dest: Dest) => dest === "hot" || dest === "cold" || dest === "external";

    // Estimate the fee whenever the selection (or external address) changes.
    useEffect(() => {
        if (!selected || expiring.ids.length === 0) {
            setFeeSats(null);
            return;
        }
        let cancelled = false;
        (async () => {
            setEstimating(true);
            setFeeSats(null);
            try {
                if (selected === "strike" || selected === "coinos") {
                    const est = await estimateSwapFee(selected, expiring.sats);
                    if (!cancelled) setFeeSats(est?.feeSats ?? null);
                } else {
                    const addr = addressFor(selected);
                    if (!addr) {
                        if (!cancelled) setFeeSats(null);
                        return;
                    }
                    const est = await estimateArkOffboardFee(addr, expiring.ids);
                    if (!cancelled) setFeeSats(est.feeSats);
                }
            } catch {
                if (!cancelled) setFeeSats(null);
            } finally {
                if (!cancelled) setEstimating(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected, externalAddr, expiring.sats, expiring.ids.length]);

    const handleExit = async () => {
        if (!selected || expiring.ids.length === 0 || exiting) return;
        setExiting(true);
        setResult(null);
        try {
            if (selected === "strike" || selected === "coinos") {
                // Ark LN fee is on top, so swap (sum - fee) to leave headroom.
                const fee = feeSats ?? 0;
                const amount = Math.max(0, expiring.sats - fee);
                if (amount <= 0) throw new Error("Amount too small after the Lightning fee.");
                await swap("ark", selected, amount);
                setResult({
                    ok: true,
                    msg: `Moving ${amount.toLocaleString()} sats to ${selected === "strike" ? "Strike" : "Coinos"}.`,
                });
            } else {
                const addr = addressFor(selected);
                if (!addr) {
                    setResult({ ok: false, msg: "Enter a valid Bitcoin address first." });
                    setExiting(false);
                    return;
                }
                await offboardArkVtxos(expiring.ids, addr);
                setResult({
                    ok: true,
                    msg: `Moving ${expiring.sats.toLocaleString()} sats on-chain. It will confirm shortly.`,
                });
            }
            try {
                await syncArkWallet();
                await Promise.all([fetchArkBalance(), fetchArkVtxos()]);
            } catch {
                // Non-fatal.
            }
        } catch (e: any) {
            const inner = e?.inner?.errorMessage ?? e?.message ?? "The move failed.";
            setResult({ ok: false, msg: `${inner} Your funds are unchanged, try another wallet.` });
        } finally {
            setExiting(false);
        }
    };

    const accent = colors.ark?.light ?? colors.pink.default;
    const options: { key: Dest; label: string; disabled: boolean }[] = [
        { key: "strike", label: "Strike", disabled: !swapAvail.strike },
        { key: "coinos", label: "Coinos", disabled: !swapAvail.coinos },
        { key: "hot", label: "Hot Vault (on-chain)", disabled: !walletID },
        { key: "cold", label: "Cold Vault (on-chain)", disabled: !coldStorageWalletID },
        { key: "external", label: "External Bitcoin address (on-chain)", disabled: false },
    ];

    const canExit =
        !!selected &&
        expiring.ids.length > 0 &&
        !estimating &&
        !exiting &&
        (!isOnchain(selected) || !!addressFor(selected));

    // ----- render -----
    if (preparing) {
        return (
            <ScreenLayout showToolbar isBackButton title="Stuck refresh">
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
                    <ActivityIndicator color={accent} />
                    <Text style={{ fontSize: 13, color: "#CCC", marginTop: 12 }}>
                        Unlocking your capsules…
                    </Text>
                </View>
            </ScreenLayout>
        );
    }

    if (result) {
        return (
            <ScreenLayout showToolbar isBackButton title="Stuck refresh">
                <View style={{ flex: 1, padding: 24 }}>
                    <Text bold style={{ fontSize: 18, color: result.ok ? colors.green : colors.redLight, marginBottom: 12 }}>
                        {result.ok ? "Funds on the way" : "Move failed"}
                    </Text>
                    <Text style={{ fontSize: 13, color: "#CCC", lineHeight: 19 }}>{result.msg}</Text>
                    {!result.ok && (
                        <TouchableOpacity
                            onPress={() => setResult(null)}
                            activeOpacity={0.7}
                            style={{ marginTop: 20, paddingVertical: 13, borderRadius: 10, alignItems: "center", backgroundColor: accent }}
                        >
                            <Text bold style={{ fontSize: 14, color: "#0B0B0B" }}>Try another wallet</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout showToolbar isBackButton title="Stuck refresh">
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 }}>
                <Text bold style={{ fontSize: 18, color: colors.redLight, lineHeight: 24, marginBottom: 12 }}>
                    Your {expiring.sats.toLocaleString()} sats lightning capsule (VTXO) is caught in a stuck-refresh loop
                </Text>
                <Text style={{ fontSize: 13, color: "#CCC", lineHeight: 19, marginBottom: 10 }}>
                    This is an ASP-side problem, not Cypher Box. Refresh rounds run on the Ark
                    server. When a round wedges, your capsule stays locked and keeps retrying
                    instead of finishing.
                </Text>
                <Text style={{ fontSize: 13, color: "#CCC", lineHeight: 19, marginBottom: 12 }}>
                    Your funds are safe, but the capsule still has an expiry. The safe move is to{" "}
                    <Text bold style={{ fontSize: 13, color: "#FFF", lineHeight: 19 }}>
                        move the funds into another wallet before it expires
                    </Text>
                    .
                </Text>

                {expiring.ids.length === 0 ? (
                    <Text style={{ fontSize: 13, color: colors.green, lineHeight: 19, marginTop: 8 }}>
                        No capsules are near expiry right now. The stuck refresh cleared and your
                        funds are safe.
                    </Text>
                ) : (
                    <>
                        <View style={{ marginTop: 4, marginBottom: 8, padding: 12, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.04)" }}>
                            <Text bold style={{ fontSize: 14, color: "#FFF" }}>
                                {expiring.ids.length} capsule{expiring.ids.length === 1 ? "" : "s"} about to expire
                            </Text>
                            <Text style={{ fontSize: 13, color: "#BBB", marginTop: 2 }}>
                                {expiring.sats.toLocaleString()} sats total
                            </Text>
                        </View>

                        <Text bold style={{ fontSize: 14, color: accent, marginTop: 12, marginBottom: 8 }}>
                            Move them to
                        </Text>
                        {options.map((opt) => {
                            const isSel = selected === opt.key;
                            return (
                                <TouchableOpacity
                                    key={opt.key}
                                    onPress={opt.disabled ? undefined : () => setSelected(opt.key)}
                                    disabled={opt.disabled}
                                    activeOpacity={0.7}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: isSel, disabled: opt.disabled }}
                                    accessibilityLabel={opt.label}
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        marginBottom: 8,
                                        paddingVertical: 12,
                                        paddingHorizontal: 14,
                                        borderRadius: 10,
                                        borderWidth: 1,
                                        borderColor: isSel ? accent : "#333",
                                        backgroundColor: isSel ? "rgba(255,255,255,0.05)" : "transparent",
                                        opacity: opt.disabled ? 0.4 : 1,
                                    }}
                                >
                                    <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: isSel ? accent : "#777", marginRight: 12, alignItems: "center", justifyContent: "center" }}>
                                        {isSel && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent }} />}
                                    </View>
                                    <Text bold style={{ fontSize: 14, color: "#FFF" }}>{opt.label}</Text>
                                </TouchableOpacity>
                            );
                        })}

                        {selected === "external" && (
                            <TextInput
                                value={externalAddr}
                                onChangeText={setExternalAddr}
                                placeholder="Paste a Bitcoin address"
                                placeholderTextColor="#777"
                                autoCapitalize="none"
                                autoCorrect={false}
                                style={{ marginTop: 2, marginBottom: 8, borderWidth: 1, borderColor: "#444", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, color: "#FFF", fontSize: 13 }}
                            />
                        )}

                        {selected && (
                            <View style={{ marginTop: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#333" }}>
                                {estimating ? (
                                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                                        <ActivityIndicator color={accent} />
                                        <Text style={{ fontSize: 13, color: "#BBB", marginLeft: 10 }}>Estimating fee…</Text>
                                    </View>
                                ) : (
                                    <Text style={{ fontSize: 13, color: "#DDD", lineHeight: 19 }}>
                                        {isOnchain(selected) && !addressFor(selected)
                                            ? "Enter a valid Bitcoin address to see the fee."
                                            : feeSats == null
                                            ? "Fee unavailable, you can still continue."
                                            : `Fee: ${feeSats.toLocaleString()} sats`}
                                    </Text>
                                )}
                            </View>
                        )}

                        <TouchableOpacity
                            onPress={canExit ? handleExit : undefined}
                            disabled={!canExit}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel="Exit"
                            style={{ marginTop: 16, paddingVertical: 14, borderRadius: 12, alignItems: "center", backgroundColor: canExit ? accent : "#444" }}
                        >
                            {exiting ? (
                                <ActivityIndicator color="#0B0B0B" />
                            ) : (
                                <Text bold style={{ fontSize: 15, color: "#0B0B0B" }}>Exit</Text>
                            )}
                        </TouchableOpacity>
                    </>
                )}
            </ScrollView>
        </ScreenLayout>
    );
}
