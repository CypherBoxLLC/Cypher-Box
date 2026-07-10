import React, { useState } from "react";
import { View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout } from "@Cypher/component-library";
import { CustomKeyboard, GradientInput } from "@Cypher/components";
import { getStrikeCurrency, SATS } from "@Cypher/helpers/coinosHelper";
import { createArkLightningInvoice } from "@Cypher/services/ark";
import { colors } from "@Cypher/style-guide";

import styles from "./styles";

// Ark yellow palette for the input border, sats/fiat tab strip, MAX
// button, and Create-invoice CTA — replaces the pink defaults inherited
// from the CoinOS/Strike `CreateInvoice` flow. Both GradientInput and
// CustomKeyboard already accept a `colors_` override, so this is purely
// a presentation swap.
const ARK_GRADIENT = [colors.ark.gradient1, colors.ark.gradient2];

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
            // `matchedRate` is now currency-per-BTC (matches the convention
            // CustomKeyboard + Strike's matchedRateStrike use), so convert
            // sats → BTC first, then multiply by rate to get fiat. The
            // earlier per-sat formula (sats × rate) silently broke when
            // ArkReceiveScreen started supplying a per-BTC rate from
            // BlueWallet's getFiatRate.
            const fiat = rate > 0 ? (satsAmount / SATS) * rate : 0;
            const formattedFiat = fiat > 0
                ? `${getStrikeCurrency(currency || "USD")}${fiat.toFixed(2)}`
                : "";

            navigation.replace("CopyInvoice", {
                value: `Receive ${satsAmount} sats`,
                converted: formattedFiat,
                hash: invoice,
                receiveType: false,
                theme: 'ark',
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
                    colors_={ARK_GRADIENT}
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
                colors_={ARK_GRADIENT}
                // Invoices have no "max" semantics — the receiver picks
                // any amount they want to be paid. MAX is a send-side
                // affordance (drain the wallet); suppress it on receive.
                hideMax
            />
        </ScreenLayout>
    );
}
