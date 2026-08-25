import React, { useState, useCallback, useEffect } from "react";
import { Text, ScreenLayout } from "@Cypher/component-library";
import { CustomFlatList, GradientView } from "@Cypher/components";
import styles from "./styles";
import Tabs from "./Tabs";
import Vault from "./Vault";
import History from "./History";
import Settings from "./Settings";
import Capsules from "./Capsules";
import ListView from "./ListView";
import { useRoute } from "@react-navigation/native";
import useAuthStore from "@Cypher/stores/authStore";



const HotStorageVault = ({ _, route }: any) => {
    const routeParams = useRoute().params as { wallet: any, matchedRate: string, currency: string, to: null | string, toStrike: null | string, tapTab?: number };
    const { wallet, matchedRate, currency, to = null, toStrike = null, tapTab } = routeParams;
    const [selectedTab, setSelectedTab] = useState(0);
    const [utxo, setUtxo] = useState(null);
    const { vaultTab } = useAuthStore();

    useEffect(() => {
        if (to || toStrike) {
            setSelectedTab(1)
        }
    }, [to, toStrike])

    // Returning from the address picker: show the tab the choice affects, so
    // the new QR is what the user sees rather than something they must go and
    // find. Cleared straight after so re-selecting the Settings tab by hand
    // does not get yanked back here.
    useEffect(() => {
        if (typeof tapTab === 'number') {
            setSelectedTab(tapTab);
            routeParams.tapTab = undefined;
        }
    }, [tapTab, routeParams])

    const onChangeSelectedTab = useCallback((id: number) => {
        setSelectedTab(id);
    }, []);

    const renderView = useCallback(() => {
        // LayoutAnimation.linear();
        switch (selectedTab) {
            case 0:
                return <Vault wallet={wallet} matchedRate={matchedRate} setSelectedTab={setSelectedTab} />;
            case 1:
                return <Capsules wallet={wallet} currency={currency} matchedRate={matchedRate} to={to} toStrike={toStrike} vaultTab={vaultTab} />;
            case 2:
                return <History wallet={wallet} matchedRate={matchedRate} vaultTab={vaultTab} />;
            case 3:
                return <Settings wallet={wallet} currency={currency} matchedRate={matchedRate} vaultTab={vaultTab} to={to} toStrike={toStrike} />;
            default:
                return <Vault wallet={wallet} matchedRate={matchedRate} setSelectedTab={setSelectedTab} />;
        }
    }, [selectedTab, vaultTab, wallet, matchedRate, to, toStrike]);

    return (
        <ScreenLayout
            showToolbar
            title={vaultTab ? 'Cold Storage Vault' : 'Hot Storage Vault'}
            disableScroll
            style={{ paddingBottom: 20 }}
        >
            <Tabs onChangeSelectedTab={onChangeSelectedTab} selectedTab={selectedTab} vaultTab={vaultTab} />
            {renderView()}
        </ScreenLayout>
    );
}

export default HotStorageVault;
