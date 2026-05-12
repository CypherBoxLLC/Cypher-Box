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
    const { wallet, matchedRate, receiveType, accountType, balance, converted, currency, reserveAmount, withdrawThreshold, initialTab } = useRoute().params as {
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
        // Optional deep-link target so callers can land directly on a
        // specific tab (e.g. Capsules = 1, Settings = 3) instead of the
        // default Account tab. Used by the home-screen bg-refresh banner
        // tap which should drop the user straight into the Capsules tab.
        initialTab?: number,
    };
    const [selectedTab, setSelectedTab] = useState(initialTab ?? 0);
    const { vaultTab, matchedRateStrike, strikeUser } = useAuthStore();
    const isArk = accountType === 'ark';
    // Strike branch (not Ark, not CoinOS-receive): rate + currency must
    // read live from the auth store. matchedRateStrike comes from Strike's
    // /rates/ticker (HomeScreen.loadStrikeData) and keeps refreshing — the
    // route-param snapshot would freeze at navigate time and leave the
    // capsule fiat conversion, BTC-price box, and per-tx History conversion
    // stuck at 0 if rates hadn't loaded by the time the user tapped through.
    const isStrike = !isArk && !receiveType;
    const effMatchedRate = isStrike ? (matchedRateStrike ?? matchedRate) : matchedRate;
    const effCurrency = isStrike ? (strikeUser?.[1]?.currency || currency) : currency;

    const onChangeSelectedTab = useCallback((id: number) => {
        setSelectedTab(id);
    }, []);

    const renderView = useCallback(() => {
        switch (selectedTab) {
            case 0:
                // Ark surfaces Capsules first (day-to-day VTXO management);
                // Strike/CoinOS keep Account first (custodial balance view).
                return isArk
                    ? <ArkCapsules currency={effCurrency} matchedRate={effMatchedRate} />
                    : <Account isArk={isArk} currency={effCurrency} matchedRate={effMatchedRate} receiveType={receiveType} balance={balance} converted={converted} reserveAmount={reserveAmount} withdrawThreshold={withdrawThreshold} />;
            case 1:
                // For Ark this is the Vault tab — same Account component,
                // renders the Ark balance Card + threshold/reserve pickers
                // via its `isArk` branch. For Strike/CoinOS this is the
                // Threshold tab (custodial-only trigger concept).
                return isArk
                    ? <Account isArk={isArk} currency={effCurrency} matchedRate={effMatchedRate} receiveType={receiveType} balance={balance} converted={converted} reserveAmount={reserveAmount} withdrawThreshold={withdrawThreshold} />
                    : <Threshold currency={effCurrency} matchedRate={effMatchedRate} receiveType={receiveType} />;
            case 2:
                // Ark pulls movements from the local SQLite datadir via
                // `handle.history()` — a totally different shape from the
                // Strike/CoinOS remote-paginated payload, so we fork the
                // History tab for Ark rather than teaching one component two
                // incompatible data sources.
                return isArk
                    ? <ArkHistory currency={effCurrency} matchedRate={effMatchedRate} />
                    : <History currency={effCurrency} matchedRate={effMatchedRate} receiveType={receiveType} />;
            case 3:
                // Forward `isArk` so Settings can render an Ark-specific
                // panel (seed phrase reveal + non-custodial copy) instead
                // of the Strike/CoinOS account-management surface.
                return <Settings receiveType={receiveType} currency={effCurrency} isArk={isArk} />;
            default:
                // Default matches case 0 — Ark lands on Capsules, others on Account.
                return isArk
                    ? <ArkCapsules currency={effCurrency} matchedRate={effMatchedRate} />
                    : <Account isArk={isArk} currency={effCurrency} matchedRate={effMatchedRate} receiveType={receiveType} balance={balance} converted={converted} reserveAmount={reserveAmount} withdrawThreshold={withdrawThreshold} />;
        }
    }, [selectedTab, vaultTab, wallet, effMatchedRate, receiveType, effCurrency, isArk]);

    return (
        <ScreenLayout showToolbar disableScroll title={isArk ? 'Ark Vault' : 'Lightning Account'}>
            <View style={styles.container}>
                <Tabs onChangeSelectedTab={onChangeSelectedTab} selectedTab={selectedTab} vaultTab={vaultTab} accountType={accountType} />
                {renderView()}
            </View>
        </ScreenLayout>
    )
}
