import { CircularView, CoinosWallet, StrikeDollarWallet, StrikeWallet } from "@Cypher/components";
import { btc } from "@Cypher/helpers/coinosHelper";
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
}: Props) {
    const { allBTCWallets, setWalletTab, matchedRateStrike, strikeUser } = useAuthStore();

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
                        tabs.push({ key: "divider", component: () => <CircularView balance={balance} convertedRate={convertedRate} currency={currency} strikeCurrency={strikeUser?.[1]?.currency || 'USD'} matchedRateStrike={Number(matchedRateStrike || 0)} wallet={wallet} matchedRate={matchedRate} refRBSheet={refRBSheet} refSendRBSheet={refSendRBSheet} setReceiveType={setReceiveType} /> });                                    
                        tabs.push({ key: "divider", component: () => <StrikeDollarWallet currency={strikeUser?.[1]?.currency || 'USD'} matchedRate={(matchedRateStrike || 0)} /> });
                    } else if (walletTabsMap[wallet].key === 'strike') {
                        tabs.push({ key: "divider", component: () => <StrikeDollarWallet currency={strikeUser?.[1]?.currency || 'USD'} matchedRate={(matchedRateStrike || 0)} /> });
                    }
                }
            });

            setWTabs(tabs)
        }
    }, [allBTCWallets, isLoading, matchedRateStrike]);

    type WalletName = keyof typeof walletTabsMap;

    const walletTabsMap = {
        COINOS: { key: 'coinos', component: () => <CoinosWallet balance={balance} convertedRate={convertedRate} currency={currency} isLoading={isLoading} matchedRate={matchedRate} refRBSheet={refRBSheet} refSendRBSheet={refSendRBSheet} setReceiveType={setReceiveType} wallet={wallet}/> },
        STRIKE: { key: 'strike', component: () => <StrikeWallet currency={strikeUser?.[1]?.currency || 'USD'} convertedRate={(matchedRateStrike || 0) * btc(1) * (strikeBalance || 0)} isLoading={isLoading} matchedRate={(matchedRateStrike || 0)} refRBSheet={refRBSheet} refSendRBSheet={refSendRBSheet} setReceiveType={setReceiveType} strikeBalance={strikeBalance} wallet={wallet} /> },
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
