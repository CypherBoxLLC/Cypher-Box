import React, { useCallback, useContext, useEffect, useState } from "react";
import {
    Alert,
    Linking,
    Modal,
    Text as RNText,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import Clipboard from "@react-native-clipboard/clipboard";
import SimpleToast from "react-native-simple-toast";

import { Text } from "@Cypher/component-library";
import {
    classifyArkDestination,
    estimateArkOnchainRecover,
    recoverArkOnchainBoard,
} from "@Cypher/services/ark";
import type { ArkOnchainRecoverEstimate } from "@Cypher/services/ark";
import useAuthStore from "@Cypher/stores/authStore";
import { recordEvent } from "@Cypher/stores/eventLogStore";
import { colors } from "@Cypher/style-guide";
import { BlueStorageContext } from "../../../../blue_modules/storage-context";

// ark.second.tech server minimum board amount. Deposits below this can never
// board into a VTXO, so they sit stuck in bark's on-chain (BDK) wallet until
// recovered here. 50k is the known mainnet minimum (and the value
// fetchArkMinBoardSats() falls back to). See .claude/ARK_STUCK_UTXO_UX_SPEC.md.
const MIN_BOARD_SATS = 50000;

/**
 * Stuck on-chain (boarding) recovery capsule — rendered under the VTXO list in
 * the Ark account tab (ArkCapsules FlatList footer).
 *
 * Funds sent to an Ark boarding address that are below the server's board
 * minimum can never become a VTXO; they're invisible in the Ark VTXO balance.
 * This surfaces them as a capsule and lets the user send them back out to any
 * Bitcoin address (their Hot Vault prefilled by default), draining bark's
 * on-chain wallet via `recoverArkOnchainBoard`.
 *
 * After a broadcast it shows a persistent "pending confirmation" state with the
 * txid (instead of vanishing) until the next sync reflects the spend.
 *
 * Note on destination: the bark SDK's OnchainWallet exposes no utxos()/drain(),
 * so we can't resolve the original sender's address automatically — the user
 * pastes/enters the destination (Hot Vault prefilled). For in-app top-ups the
 * Hot Vault IS where the funds came from.
 */
export default function ArkOnchainRecoverSection() {
    const arkBalanceDetail = useAuthStore((s) => s.arkBalanceDetail);
    const walletID = useAuthStore((s) => s.walletID);
    const { wallets } = useContext(BlueStorageContext);

    const confirmedSats = arkBalanceDetail?.onchainBoardingSats ?? 0;
    const confirmingSats = arkBalanceDetail?.onchainConfirmingSats ?? 0;

    const [visible, setVisible] = useState(false);
    const [addr, setAddr] = useState("");
    const [busy, setBusy] = useState(false);
    const [est, setEst] = useState<ArkOnchainRecoverEstimate | null>(null);

    // Post-broadcast "pending" state. Set on a successful send so the capsule
    // shows a clear "broadcast, pending confirmation" row (with the txid)
    // instead of silently vanishing. `recoverFromSats` is the balance at send
    // time; once the on-chain balance drops below it (the next sync reflects
    // the spend), the pending state clears and the capsule resolves to the
    // happy path (gone) or to any remaining change.
    const [recoverTxid, setRecoverTxid] = useState<string | null>(null);
    const [recoverFromSats, setRecoverFromSats] = useState(0);
    useEffect(() => {
        if (recoverTxid && confirmedSats < recoverFromSats) {
            setRecoverTxid(null);
            setRecoverFromSats(0);
        }
    }, [confirmedSats, recoverTxid, recoverFromSats]);

    const resolveHotVaultAddress = useCallback((): string | null => {
        const hv: any = (wallets || []).find(
            (w: any) => typeof w?.getID === "function" && w.getID() === walletID,
        );
        if (!hv || typeof hv._getInternalAddressByIndex !== "function") return null;
        try {
            return hv._getInternalAddressByIndex(hv.getNextFreeChangeAddressIndex()) || null;
        } catch {
            return null;
        }
    }, [wallets, walletID]);

    // Whether `address` belongs to the user's Hot Vault, so the recorded event
    // (and its history copy) can say "back to your Hot Vault" vs "to the address
    // you entered" honestly. weOwnAddress checks the wallet's derived address
    // set, so it's correct whether the user used the prefill, tapped "Use Hot
    // Vault", or pasted one of their own addresses. Degrades to false (external)
    // if the wallet lacks the method or the check throws.
    const isHotVaultAddress = useCallback((address: string): boolean => {
        const hv: any = (wallets || []).find(
            (w: any) => typeof w?.getID === "function" && w.getID() === walletID,
        );
        try {
            return !!hv && typeof hv.weOwnAddress === "function" && !!hv.weOwnAddress(address);
        } catch {
            return false;
        }
    }, [wallets, walletID]);

    const openRecover = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        try {
            const e = await estimateArkOnchainRecover(confirmedSats);
            setEst(e);
            if (e.confirmedSats <= 0) {
                SimpleToast.show("Nothing to recover right now.", SimpleToast.SHORT);
                return;
            }
            // Prefill the user's Hot Vault address as the default destination.
            setAddr(resolveHotVaultAddress() ?? "");
            setVisible(true);
        } catch {
            SimpleToast.show("Could not read the on-chain balance. Try again.", SimpleToast.LONG);
        } finally {
            setBusy(false);
        }
    }, [busy, confirmedSats, resolveHotVaultAddress]);

    const onPaste = useCallback(async () => {
        try {
            const s = (await Clipboard.getString())?.trim();
            if (s) setAddr(s);
        } catch {
            /* ignore clipboard errors */
        }
    }, []);

    const doRecover = useCallback(async () => {
        const dest = addr.trim();
        if (!dest || classifyArkDestination(dest).kind !== "onchain") {
            SimpleToast.show("Enter a valid Bitcoin address.", SimpleToast.LONG);
            return;
        }
        if (!est || !est.economical) {
            SimpleToast.show("Too small to recover (the network fee is larger than the amount).", SimpleToast.LONG);
            return;
        }
        setBusy(true);
        try {
            const res = await recoverArkOnchainBoard(dest, est.confirmedSats, est.feeRateSatPerVb);
            setVisible(false);
            if (res.status === "already-cleared") {
                Alert.alert("Nothing to recover", "These funds already cleared.");
            } else {
                // Show the pending state with the txid (persists until the
                // balance drops on the next sync).
                setRecoverFromSats(est.confirmedSats);
                setRecoverTxid(res.txid);
                // Persist a history/activity record. The recover is an on-chain
                // BDK tx, not an Ark movement, so it never appears in bark's
                // history; this event is its only durable trace.
                recordEvent({
                    kind: "ark-onchain-recovered",
                    sats: res.sentSats,
                    feeSats: res.feeSats,
                    txid: res.txid,
                    dest: isHotVaultAddress(dest) ? "hot-vault" : "external",
                });
                Alert.alert(
                    "Recovery broadcast",
                    `${res.sentSats.toLocaleString()} sats sent on-chain. It is pending confirmation and will appear at the destination shortly.\n\nTxid:\n${res.txid}`,
                );
            }
        } catch (e: any) {
            Alert.alert(
                "Recovery failed",
                String(e?.message || "") || "The recovery transaction could not be sent. Your funds are unchanged.",
            );
        } finally {
            setBusy(false);
        }
    }, [addr, est, isHotVaultAddress]);

    // --- Post-broadcast pending state (takes priority over the normal capsule) ---
    if (recoverTxid) {
        return (
            <View style={{ marginTop: 16, marginBottom: 8 }}>
                <Text bold style={{ color: "#FFF", fontSize: 14, marginHorizontal: 24, marginBottom: 8 }}>
                    On-chain recovery
                </Text>
                <View style={{ marginHorizontal: 18, borderRadius: 16, overflow: "hidden" }}>
                    <LinearGradient
                        colors={["#3A3A3A", "#1C1C1C"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0.5, y: 0.866 }}
                        style={{ padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.green }}
                    >
                        <Text bold style={{ color: "#FFF", fontSize: 16 }}>Recovery broadcast</Text>
                        <Text style={{ color: colors.green, fontSize: 12, marginTop: 4, fontStyle: "italic" }}>
                            Pending confirmation. Funds are on the way and will clear here shortly.
                        </Text>
                        <TouchableOpacity
                            onPress={() => {
                                Clipboard.setString(recoverTxid);
                                SimpleToast.show("Txid copied", SimpleToast.SHORT);
                            }}
                            activeOpacity={0.7}
                            style={{ marginTop: 12 }}
                        >
                            <Text style={{ color: colors.gray.light, fontSize: 11 }}>Transaction id (tap to copy)</Text>
                            <RNText style={{ color: "#FFF", fontSize: 12 }} numberOfLines={1} ellipsizeMode="middle">
                                {recoverTxid}
                            </RNText>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => {
                                const url = `https://mempool.space/tx/${recoverTxid}#details`;
                                Linking.openURL(url).catch(() =>
                                    SimpleToast.show("Could not open the explorer.", SimpleToast.SHORT),
                                );
                            }}
                            activeOpacity={0.7}
                            style={{
                                marginTop: 14,
                                paddingVertical: 9,
                                borderRadius: 8,
                                borderWidth: 1,
                                borderColor: colors.green,
                                alignItems: "center",
                            }}
                        >
                            <RNText style={{ color: colors.green, fontSize: 12, fontWeight: "700" }}>
                                View in Bitcoin network explorer
                            </RNText>
                        </TouchableOpacity>
                    </LinearGradient>
                </View>
            </View>
        );
    }

    if (confirmedSats <= 0 && confirmingSats <= 0) return null;

    const belowMin = confirmedSats > 0 && confirmedSats < MIN_BOARD_SATS;
    const headlineSats = confirmedSats > 0 ? confirmedSats : confirmingSats;
    const statusText =
        confirmedSats <= 0
            ? "Confirming on-chain…"
            : belowMin
                ? `Too small to board (min ${MIN_BOARD_SATS.toLocaleString()} sats). Recover it on-chain.`
                : "Waiting to board. You can recover it on-chain instead.";
    const accent = belowMin ? "#FFD54F" : colors.ark.light;

    return (
        <View style={{ marginTop: 16, marginBottom: 8 }}>
            <Text bold style={{ color: "#FFF", fontSize: 14, marginHorizontal: 24, marginBottom: 8 }}>
                On-chain (not boarded)
            </Text>

            {/* Capsule card — echoes the VTXO row gradient so it reads as part
                of the same surface. */}
            <View style={{ marginHorizontal: 18, borderRadius: 16, overflow: "hidden" }}>
                <LinearGradient
                    colors={["#3A3A3A", "#1C1C1C"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0.5, y: 0.866 }}
                    style={{ padding: 16, borderRadius: 16, borderWidth: 1, borderColor: accent }}
                >
                    <Text bold style={{ color: "#FFF", fontSize: 18 }}>
                        {headlineSats.toLocaleString()} sats
                    </Text>
                    <Text style={{ color: belowMin ? accent : colors.gray.light, fontSize: 12, marginTop: 4, fontStyle: "italic" }}>
                        {statusText}
                    </Text>
                    {confirmedSats > 0 && (
                        <TouchableOpacity
                            onPress={openRecover}
                            disabled={busy}
                            activeOpacity={0.7}
                            style={{
                                marginTop: 12,
                                paddingVertical: 10,
                                borderRadius: 8,
                                backgroundColor: busy ? "#444" : accent,
                                alignItems: "center",
                            }}
                        >
                            <RNText style={{ color: "#1C1C1C", fontWeight: "700", fontSize: 14 }}>
                                {busy ? "Working…" : "Recover to a Bitcoin address"}
                            </RNText>
                        </TouchableOpacity>
                    )}
                </LinearGradient>
            </View>

            {/* Recover dialog — amount + fee + destination address entry */}
            <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !busy && setVisible(false)}>
                <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", paddingHorizontal: 24 }}>
                    <View style={{ backgroundColor: "#1C1C1C", borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.ark.light }}>
                        <Text bold style={{ color: "#FFF", fontSize: 16, marginBottom: 12 }}>
                            Recover on-chain funds
                        </Text>
                        {est && (
                            <Text style={{ color: colors.gray.light, fontSize: 13, marginBottom: 12, lineHeight: 19 }}>
                                {est.economical
                                    ? `Send ${est.recoverableSats.toLocaleString()} sats to the address below. On-chain fee about ${est.feeSats.toLocaleString()} sats (${est.feeRateSatPerVb} sat/vB).`
                                    : "This amount is too small to recover economically: the network fee would be larger than it."}
                            </Text>
                        )}
                        <Text style={{ color: "#FFF", fontSize: 12, marginBottom: 6 }}>Destination Bitcoin address</Text>
                        <TextInput
                            value={addr}
                            onChangeText={setAddr}
                            placeholder="bc1…"
                            placeholderTextColor="#666"
                            autoCapitalize="none"
                            autoCorrect={false}
                            multiline
                            style={{ color: "#FFF", borderWidth: 1, borderColor: "#444", borderRadius: 8, padding: 10, fontSize: 13, minHeight: 48 }}
                        />
                        <View style={{ flexDirection: "row", marginTop: 8 }}>
                            <TouchableOpacity
                                onPress={onPaste}
                                style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: "#555", marginRight: 8 }}
                            >
                                <RNText style={{ color: colors.ark.light, fontSize: 12, fontWeight: "700" }}>Paste</RNText>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={() => {
                                    const hv = resolveHotVaultAddress();
                                    if (hv) setAddr(hv);
                                    else SimpleToast.show("No Hot Vault address found.", SimpleToast.SHORT);
                                }}
                                style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: "#555" }}
                            >
                                <RNText style={{ color: colors.ark.light, fontSize: 12, fontWeight: "700" }}>Use Hot Vault</RNText>
                            </TouchableOpacity>
                        </View>
                        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 18, alignItems: "center" }}>
                            <TouchableOpacity onPress={() => !busy && setVisible(false)} style={{ paddingVertical: 10, paddingHorizontal: 16, marginRight: 8 }}>
                                <RNText style={{ color: "#999", fontSize: 14, fontWeight: "700" }}>Cancel</RNText>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={doRecover}
                                disabled={busy || !est?.economical}
                                style={{ paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8, backgroundColor: busy || !est?.economical ? "#444" : colors.ark.light }}
                            >
                                <RNText style={{ color: "#1C1C1C", fontSize: 14, fontWeight: "700" }}>{busy ? "Sending…" : "Recover"}</RNText>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}
