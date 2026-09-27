import React, { useState } from "react";
import { Text, View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout } from "@Cypher/component-library";
import { CustomKeyboard, GradientInput } from "@Cypher/components";
import { getStrikeCurrency, SATS } from "@Cypher/helpers/coinosHelper";
import {
    ARK_SERVER_URL,
    ESPLORA_URLS,
    arkNetworkFaultMessage,
    classifyArkNetworkFault,
    createArkLightningInvoice,
} from "@Cypher/services/ark";
import { colors } from "@Cypher/style-guide";

import styles from "./styles";

// Ark yellow palette for the input border, sats/fiat tab strip, MAX
// button, and Create-invoice CTA — replaces the pink defaults inherited
// from the CoinOS/Strike `CreateInvoice` flow. Both GradientInput and
// CustomKeyboard already accept a `colors_` override, so this is purely
// a presentation swap.
const ARK_GRADIENT = [colors.ark.gradient1, colors.ark.gradient2];
// Warning-yellow gradient for the small-amount "Create anyways" CTA and the
// dust note. A sub-700-sat receive can leave un-refreshable dust that expires.
const WARN_YELLOW = ['#FFD54F', '#FFB300'];
// COPY: Bam finalizes.
const SMALL_RECEIVE_SATS = 700;

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

    // Small-amount warning: in sats mode the typed value is the sat amount; in
    // fiat mode CustomKeyboard mirrors the sat equivalent into `usd`.
    const currentSats = Math.round(isSats ? Number(sats) : Number(usd)) || 0;
    // Strictly below the floor. 700 is the amount the warning tells users to
    // reach, so warning AT 700 contradicted its own advice: you typed the
    // number it asked for and it still called the amount small. 699 warns,
    // 700 does not.
    const smallAmountWarn = currentSats > 0 && currentSats < SMALL_RECEIVE_SATS;

    const handleCreate = async () => {
        if (!sats) {
            SimpleToast.show("Please enter an amount", SimpleToast.SHORT);
            return;
        }
        // Resolve the sat amount. CustomKeyboard writes the raw typed value to
        // `sats` and the converted counterpart to `usd`, so in fiat mode `usd`
        // ALREADY holds the sat amount (and `sats` holds the dollars) — the same
        // contract the CoinOS CreateInvoice sibling reads as
        // `isSats ? Number(sats) : Number(usd)`. The old code re-divided that
        // already-in-sats `usd` value by the rate and multiplied by 1e8 again,
        // double-converting: a $100 fiat entry asked the ASP for ~1.1 BTC
        // (~1000x too much), which it can't invoice — the "Failed to create Ark
        // invoice" the user hit. Round because the fiat-mode value carries 2
        // decimals from the keyboard's toFixed.
        const rate = Number(matchedRate) || 0;
        const satsAmount = Math.round(isSats ? Number(sats) : Number(usd));
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
                // A Lightning payment resolves to an out-of-round capsule, so
                // the receive screen warns and tells the user to stay in the
                // app until the refresh lands. Not set on the on-chain
                // boarding path, which has no such step.
                arkoorNotice: true,
            });
        } catch (err) {
            console.error("Ark invoice creation failed:", err);
            // Minting an invoice needs the Ark server, so this fails whenever
            // the ASP is unreachable. Naming the side that is down beats
            // pasting a raw SDK string, and it decides whether "try mobile
            // data" is useful advice or a waste of the user's time. Falls back
            // to the raw message when the cause is not recognisable.
            const faultMsg = arkNetworkFaultMessage(
                classifyArkNetworkFault(err, {
                    chainUrls: ESPLORA_URLS,
                    arkUrl: ARK_SERVER_URL,
                }),
            );
            SimpleToast.show(
                faultMsg
                    ? `Could not create the invoice. ${faultMsg}`
                    : `Failed to create Ark invoice: ${(err as Error)?.message ?? "unknown error"}`,
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
            {smallAmountWarn && (
                <Text style={{ textAlign: 'center', marginHorizontal: 24, marginBottom: 6, fontSize: 12, color: '#FFD54F', lineHeight: 17 }}>
                    Small amounts can leave un-refreshable dust that expires. Receiving 700 sats or more keeps them refreshable.
                </Text>
            )}
            <CustomKeyboard
                title={smallAmountWarn ? "Create anyways" : "Create invoice"}
                onPress={handleCreate}
                disabled={!sats.length || isLoading}
                prevSats={sats}
                setSATS={setSats}
                setUSD={setUSD}
                setIsSATS={setIsSats}
                matchedRate={matchedRate}
                currency={currency}
                colors_={ARK_GRADIENT}
                buttonColors_={smallAmountWarn ? WARN_YELLOW : undefined}
                // The button's title defaults to white, and both gradients it
                // can wear here are light: ARK_GRADIENT is #FFFFFF to #E6E6E6
                // and WARN_YELLOW is #FFD54F to #FFB300. White on either is
                // invisible, so once an amount was entered the CTA read as a
                // blank slab. Disabled keeps white, because GradientButton
                // swaps to a grey fill in that state. Same pattern as
                // ArkSendScreen's CTA.
                titleColor={sats.length && !isLoading ? colors.black.default : colors.whiteText}
                // Invoices have no "max" semantics — the receiver picks
                // any amount they want to be paid. MAX is a send-side
                // affordance (drain the wallet); suppress it on receive.
                hideMax
            />
        </ScreenLayout>
    );
}
