import { ArkWallet, CircularView, CoinosWallet, StrikeDollarWallet, StrikeWallet } from "@Cypher/components";
import { Text } from "@Cypher/component-library";
import { FEATURE_ARK_ENABLED } from "@Cypher/services/ark";
import useAuthStore from "@Cypher/stores/authStore";
import screenWidth from "@Cypher/style-guide/screenWidth";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import Carousel from "react-native-snap-carousel";

interface Props {
    balance: any;
    wallet: any;
    coldStorageWallet: any;
    isLoading: boolean;
    matchedRate: any;
    currency: any;
    convertedRate: any;
    refRBSheet: any;
    refSendRBSheet: any;
    refSwapRBSheet?: any;
    setReceiveType: any;
    strikeBalance: any;
    matchedRateStrike?: number;
    strikeConvertedBalance?: number;
    currencyStrike?: string;
    homeMessage?: string | null;
    /** Fires when the active carousel page changes. Used by BalanceView to render the page indicator. */
    onPageChange?: (index: number, total: number) => void;
}

export default function WalletsView({
    balance,
    wallet,
    coldStorageWallet,
    isLoading,
    matchedRate,
    currency,
    convertedRate,
    refRBSheet,
    refSendRBSheet,
    refSwapRBSheet,
    setReceiveType,
    strikeBalance,
    matchedRateStrike = 0,
    strikeConvertedBalance = 0,
    currencyStrike = 'USD',
    homeMessage = null,
    onPageChange,
}: Props) {
    const { allBTCWallets, setWalletTab } = useAuthStore();

    const [indexStrike, setIndexStrike] = useState(0);
    const [wTabs, setWTabs] = useState([]);

    useEffect(() => {
        if (!allBTCWallets || isLoading) return;

        // Carousel composition rules:
        //   - Custodial Lightning providers (STRIKE / COINOS) collapse into a single
        //     CircularView page when BOTH are present, since they share the
        //     "Lightning Accounts" UX. Single-custodial = its own card.
        //   - ARK is a structurally different wallet (non-custodial, separate
        //     SDK, separate balance) and ALWAYS gets its own carousel page —
        //     never collapsed into CircularView (which has no Ark support).
        //   - StrikeDollarWallet (USD shadow balance) tags along whenever Strike
        //     is connected — same as the original behavior.
        const custodialLightning = (allBTCWallets as WalletName[]).filter(
            w => w === 'STRIKE' || w === 'COINOS'
        );
        // Ark is feature-flagged off until Second.tech's mainnet ASP launches.
        // Even if zustand still has 'ARK' in allBTCWallets from a previous
        // session, we never render the carousel card while the flag is false.
        const hasArk = FEATURE_ARK_ENABLED && (allBTCWallets as WalletName[]).includes('ARK');

        const tabs: any = [];
        // The carousel's `firstItem` prop is only respected on the Carousel
        // component's *initial mount*. Because we render the Carousel before
        // wTabs is populated (it starts as []), the Carousel mounts with
        // firstItem=0 and ignores any later bump — so even if we set
        // defaultIndex=1 here, the visible slide stays at index 0 on first
        // login, while our state + the page indicator claimed index 1. That
        // mismatch is the bug Bam saw: indicator on the middle line, but the
        // fiat card actually showing.
        //
        // Easiest fix that keeps the existing render order: align the state
        // with what the carousel actually shows — start on index 0 (fiat
        // when Strike is connected, CircularView's left neighbour when both
        // custodial providers are connected). Swiping left advances to the
        // BTC card, exactly the same gesture as before; only the *initial*
        // landing slide changes. The indicator now correctly points at the
        // left line on first login and tracks swipes from there.
        let defaultIndex = 0;

        const strikeDollarTab = {
            key: "strike-dollar",
            component: () => <StrikeDollarWallet currency={currencyStrike} matchedRateStrike={matchedRateStrike} />
        };

        if (custodialLightning.length > 1) {
            // Both custodial providers — fiat card left of the CircularView page.
            if (custodialLightning.includes('STRIKE')) {
                tabs.push(strikeDollarTab);
                // defaultIndex stays 0 — see comment above. Land on fiat,
                // user swipes left to reveal CircularView.
            }
            tabs.push({
                key: "lightning-circular",
                showTitle: true,
                component: () => (
                    <>
                        <Text bold h2 style={{ height: 32, marginTop: 10 }}>Lightning Accounts</Text>
                        <CircularView
                            balance={balance}
                            convertedRate={convertedRate}
                            currency={currency}
                            wallet={walletTabsMap[custodialLightning[0]].key}
                            matchedRateStrike={matchedRateStrike}
                            refRBSheet={refRBSheet}
                            refSendRBSheet={refSendRBSheet}
                            refSwapRBSheet={refSwapRBSheet}
                            setReceiveType={setReceiveType}
                            homeMessage={homeMessage}
                        />
                    </>
                )
            });
        } else if (custodialLightning.length === 1) {
            // Single custodial provider.
            const w = custodialLightning[0];
            if (w === 'STRIKE') {
                // Fiat card sits at index 0; Strike BTC at index 1. Carousel
                // mounts on fiat (see top-of-effect comment for why we don't
                // try to skip past it).
                tabs.push(strikeDollarTab);
            }
            tabs.push(walletTabsMap[w]);
        }

        // Ark is structurally separate — always its own page if present.
        if (hasArk) {
            tabs.push(walletTabsMap.ARK);
        }

        setIndexStrike(defaultIndex);
        setWTabs(tabs);
        onPageChange?.(defaultIndex, tabs.length);
    }, [allBTCWallets, isLoading, matchedRateStrike, strikeBalance, convertedRate]);

    type WalletName = keyof typeof walletTabsMap;

    const walletTabsMap = {
        COINOS: { key: 'coinos', component: () => <CoinosWallet balance={balance} convertedRate={convertedRate} currency={currency} isLoading={isLoading} matchedRate={matchedRate} refRBSheet={refRBSheet} refSendRBSheet={refSendRBSheet} setReceiveType={setReceiveType} wallet={wallet} homeMessage={homeMessage}/> },
        STRIKE: { key: 'strike', component: () => <StrikeWallet currency={currencyStrike} isLoading={isLoading} matchedRateStrike={matchedRateStrike} strikeConvertedBalance={strikeConvertedBalance} refRBSheet={refRBSheet} refSendRBSheet={refSendRBSheet} setReceiveType={setReceiveType} strikeBalance={strikeBalance} homeMessage={homeMessage}/> },
        // Ark (experimental non-custodial Lightning via Second.tech) — yellow-branded.
        ARK: { key: 'ark', component: () => <ArkWallet convertedRate={convertedRate} currency={currency} isLoading={isLoading} matchedRate={matchedRate} refRBSheet={refRBSheet} refSendRBSheet={refSendRBSheet} setReceiveType={setReceiveType} homeMessage={homeMessage}/> },
    };


    const renderWalletItem = ({ item }: any) => {
        return (
            <View style={{
                width: screenWidth * 0.905,
            }}>
                {item.component()}
            </View>
        )
    };

    if (__DEV__) console.log('allBTCWallets: ', allBTCWallets, wTabs)
    return (
        <View style={{ width: screenWidth }}>
            <Carousel
                data={wTabs}
                renderItem={renderWalletItem}
                firstItem={indexStrike}
                vertical={false}
                sliderWidth={screenWidth}
                itemWidth={screenWidth}
                onSnapToItem={(index) => {
                    setIndexStrike(index);
                    setWalletTab(index === 1);
                    onPageChange?.(index, wTabs.length);
                }}
            />
        </View>
    );
}
