import { ScreenLayout } from "@Cypher/component-library";
import { Tabs } from "@Cypher/components";
import useAuthStore from "@Cypher/stores/authStore";
import { useRoute } from "@react-navigation/native";
import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { default as Account, default as Vault } from "./Account";
import ArkCapsules from "./ArkCapsules";
import ArkHistory from "./ArkHistory";
import History from "./History";
import Settings from "./Settings";
import styles from "./styles";
import Threshold from "./Threshold";

export default function CheckingAccountNew({ navigation, route }: any) {
    const { wallet, matchedRate, receiveType, accountType, balance, converted, currency, reserveAmount, withdrawThreshold } = useRoute().params as {
        wallet: any,
        matchedRate: string,
        to: null | string,
        receiveType: boolean,
        accountType?: string,
        balance: any,
        converted: any,
        currency: any,
        reserveAmount: any,
        withdrawThreshold: any,
    };
    const [selectedTab, setSelectedTab] = useState(0);
    const { vaultTab } = useAuthStore();
    const isArk = accountType === 'ark';

    const onChangeSelectedTab = useCallback((id: number) => {
        setSelectedTab(id);
    }, []);

    const renderView = useCallback(() => {
        switch (selectedTab) {
            case 0:
                return <Account isArk={isArk} currency={currency} matchedRate={matchedRate} receiveType={receiveType} balance={balance} converted={converted} reserveAmount={reserveAmount} withdrawThreshold={withdrawThreshold} />;
            case 1:
                // Ark replaces "Threshold" (a custodial trigger concept that
                // doesn't apply to non-custodial Ark) with "Capsules" — the
                // VTXO management surface. Strike/CoinOS keep Threshold.
                return isArk
                    ? <ArkCapsules currency={currency} matchedRate={matchedRate} />
                    : <Threshold currency={currency} matchedRate={matchedRate} receiveType={receiveType} />;
            case 2:
                // Ark pulls movements from the local SQLite datadir via
                // `handle.history()` — a totally different shape from the
                // Strike/CoinOS remote-paginated payload, so we fork the
                // History tab for Ark rather than teaching one component two
                // incompatible data sources.
                return isArk
                    ? <ArkHistory currency={currency} matchedRate={matchedRate} />
                    : <History currency={currency} matchedRate={matchedRate} receiveType={receiveType} />;
            case 3:
                return <Settings receiveType={receiveType} currency={currency} />;
            default:
                return <Account isArk={isArk} currency={currency} matchedRate={matchedRate} receiveType={receiveType} balance={balance} converted={converted} reserveAmount={reserveAmount} withdrawThreshold={withdrawThreshold} />;
        }
    }, [selectedTab, vaultTab, wallet, matchedRate, receiveType, currency, isArk]);

    return (
        <ScreenLayout showToolbar disableScroll title={isArk ? 'Ark Vault' : 'Lightning Account'}>
            <View style={styles.container}>
                <Tabs onChangeSelectedTab={onChangeSelectedTab} selectedTab={selectedTab} vaultTab={vaultTab} accountType={accountType} />
                {renderView()}
            </View>
        </ScreenLayout>
    )
}
