import React, { useState } from "react";
import { View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout } from "@Cypher/component-library";
import { CustomKeyboard, GradientInput } from "@Cypher/components";
import { getStrikeCurrency } from "@Cypher/helpers/coinosHelper";
import { createArkLightningInvoice } from "@Cypher/services/ark";

import styles from "./styles";

/**
 * Amount entry for an Ark BOLT11 invoice.
 *
 * Mirrors `CreateInvoice` (the CoinOS/Strike version) so it reuses the same
 * `GradientInput` + `CustomKeyboard` — invoice generation goes through the
 * Bark SDK instead of a server API.
 *
 * USD / sats toggle uses `matchedRate` from the caller (BlueWallet's
 * FiatUnit, the same rate every other wallet card in the app uses), so the
 * displayed fiat stays consistent with the home-screen balance and with the
 * Ark History tab's row cards.
 */
export default function ArkInvoiceScreen({ navigation, route }: any) {
    const { matchedRate, currency } = route.params || {};
    const [isSats, setIsSats] = useState(true);
    const [sats, setSats] = useState("");
    const [usd, setUSD] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const handleCreate = async () => {
        if (!sats) {
            SimpleToast.show("Please enter an amount", SimpleToast.SHORT);
            return;
        }
        // Resolve the sat amount from whichever mode the keyboard last wrote
        // to. Both `sats` and `usd` are kept in sync by CustomKeyboard's
        // onchange, but we defend against a torn state by recomputing from
        // `usd` when the user submitted in USD mode. Integer-rounded so the
        // SDK doesn't reject a fractional sat.
        const rate = Number(matchedRate) || 0;
        let satsAmount = Number(sats);
        if (!isSats && rate > 0 && usd) {
            satsAmount = Math.round((Number(usd) / rate) * 100000000);
        }
        if (!Number.isFinite(satsAmount) || satsAmount <= 0) {
            SimpleToast.show("Please enter a valid amount", SimpleToast.SHORT);
            return;
        }

        setIsLoading(true);
        try {
            const invoice = await createArkLightningInvoice(satsAmount);
            // Pre-formatted fiat string — CopyInvoice renders `converted`
            // directly into a Text, so we do the formatting here rather
            // than in the presenter. Empty string when rate is unknown, so
            // the row simply collapses rather than showing "$0.00" next to
            // a non-zero sat amount.
            //
            // `matchedRate` is already USD-per-sat (HomeScreen stores it
            // that way — see `handleUser` line 671), so sats × rate = USD
            // directly. Don't multiply by btc(1) — that bug made the fiat
            // come out ~1e-8× too small and always display $0.
            const fiat = rate > 0 ? satsAmount * rate : 0;
            const formattedFiat = fiat > 0
                ? `${getStrikeCurrency(currency || "USD")}${fiat.toFixed(2)}`
                : "";

            navigation.replace("CopyInvoice", {
                value: `Receive ${satsAmount} sats`,
                converted: formattedFiat,
                hash: invoice,
                receiveType: false,
            });
        } catch (err) {
            console.error("Ark invoice creation failed:", err);
            SimpleToast.show(
                `Failed to create Ark invoice: ${(err as Error)?.message ?? "unknown error"}`,
                SimpleToast.LONG,
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title="Ark Lightning invoice">
            <View style={styles.main}>
                <GradientInput
                    isSats={isSats}
                    walletInfo={route.params}
                    sats={sats}
                    setSats={setSats}
                    usd={usd}
                />
            </View>
            <CustomKeyboard
                title="Create invoice"
                onPress={handleCreate}
                disabled={!sats.length || isLoading}
                prevSats={sats}
                setSATS={setSats}
                setUSD={setUSD}
                setIsSATS={setIsSats}
                matchedRate={matchedRate}
                currency={currency}
            />
        </ScreenLayout>
    );
}
