import { CircularView, CoinosWallet, StrikeDollarWallet, StrikeWallet } from "@Cypher/components";
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
    setReceiveType: any;
    strikeBalance: any;
    matchedRateStrike?: number;
    currencyStrike?: string;
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
    setReceiveType,
    strikeBalance,
    matchedRateStrike = 0,
    currencyStrike = 'USD',
}: Props) {
    const { allBTCWallets, setWalletTab } = useAuthStore();

    const [indexStrike, setIndexStrike] = useState(0);
    const [wTabs, setWTabs] = useState([]);

    useEffect(() => {
        const tabs: any = [];

        if (allBTCWallets && !isLoading) {
            (allBTCWallets as WalletName[]).map((wallet, index) => {
                if (walletTabsMap[wallet]) {
                    tabs.push(walletTabsMap[wallet]);
                    if(allBTCWallets.length > 1) {
                        tabs.length = 0;
                        tabs.push({ key: "divider", component: () => <CircularView balance={balance} convertedRate={convertedRate} currency={currency} wallet={walletTabsMap[wallet].key} matchedRate={matchedRateStrike} refRBSheet={refRBSheet} refSendRBSheet={refSendRBSheet} setReceiveType={setReceiveType}/> });                                    
                        tabs.push({ key: "divider", component: () => <StrikeDollarWallet currency={currencyStrike} matchedRate={matchedRateStrike} /> });
                    } else if (walletTabsMap[wallet].key === 'strike') {
                        tabs.push({ key: "divider", component: () => <StrikeDollarWallet currency={currencyStrike} matchedRate={matchedRateStrike} /> });
                    }
                }
            });

            setWTabs(tabs)
        }
    }, [allBTCWallets, isLoading]);

    type WalletName = keyof typeof walletTabsMap;

    const walletTabsMap = {
        COINOS: { key: 'coinos', component: () => <CoinosWallet balance={balance} convertedRate={convertedRate} currency={currency} isLoading={isLoading} matchedRate={matchedRate} refRBSheet={refRBSheet} refSendRBSheet={refSendRBSheet} setReceiveType={setReceiveType} wallet={wallet}/> },
        STRIKE: { key: 'strike', component: () => <StrikeWallet currency={currencyStrike} isLoading={isLoading} matchedRate={matchedRateStrike} refRBSheet={refRBSheet} refSendRBSheet={refSendRBSheet} setReceiveType={setReceiveType} strikeBalance={strikeBalance} /> },
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

    console.log('allBTCWallets: ', allBTCWallets, wTabs)
    return (
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
            }}
        />
    );
}
