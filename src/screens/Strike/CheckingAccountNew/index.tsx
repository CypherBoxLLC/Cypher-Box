import { ScreenLayout } from "@Cypher/component-library";
import { Tabs } from "@Cypher/components";
import useAuthStore from "@Cypher/stores/authStore";
import { useRoute } from "@react-navigation/native";
import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { default as Account, default as Vault } from "./Account";
import History from "./History";
import Settings from "./Settings";
import styles from "./styles";
import Threshold from "./Threshold";

export default function CheckingAccountNew({ navigation, route }: any) {
    const { wallet, matchedRate, receiveType} = useRoute().params as { wallet: string, matchedRate: string, to: null | string,receiveType: boolean};
    const [selectedTab, setSelectedTab] = useState(0);
    const { vaultTab } = useAuthStore();

    const onChangeSelectedTab = useCallback((id: number) => {
        setSelectedTab(id);
    }, []);

    const renderView = useCallback(() => {
        switch (selectedTab) {
            case 0:
                return <Account matchedRate={matchedRate} wallet={wallet}/>;
            case 1:
                return <Threshold matchedRate={matchedRate} receiveType={receiveType} />;
            case 2:
                return <History matchedRate={matchedRate} receiveType={receiveType} />;
            case 3:
                return <Settings />;
            default:
                return <Account matchedRate={matchedRate} wallet={wallet}/>;
        }
    }, [selectedTab, vaultTab, wallet, matchedRate]);

    return (
        <ScreenLayout showToolbar disableScroll title={'Checking Account'}>
            <View style={styles.container}>
                <Tabs onChangeSelectedTab={onChangeSelectedTab} selectedTab={selectedTab} vaultTab={vaultTab} />
                {renderView()}
            </View>
        </ScreenLayout>
    )
}
