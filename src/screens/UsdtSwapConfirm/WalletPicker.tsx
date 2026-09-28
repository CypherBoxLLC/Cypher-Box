import React from "react";
import { Image, TouchableOpacity, View } from "react-native";

import { Text } from "@Cypher/component-library";
import { CoinOS, Cold1, Electricity, Hot } from "@Cypher/assets/images";
import { FEATURE_ARK_ENABLED } from "@Cypher/services/ark";
import { isCoinosAllowed } from "@Cypher/services/featureFlags";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";

import { picker } from "./styles";

/**
 * The wallets a USDT swap can put bitcoin into, or take it out of.
 *
 * The same four the buy flow offers (see ReviewPayment's deposit picker), less
 * Strike: Strike holds fiat and a swap here is already the bitcoin leg. The ids
 * match that screen's PurchaseDest so the two read the same way.
 */
export type SwapWallet = 'coinos' | 'ark' | 'hot' | 'cold';

export const WALLET_LABEL: Record<SwapWallet, string> = {
    coinos: 'CoinOS',
    ark: 'Bark Vault',
    hot: 'Hot Vault',
    cold: 'Cold Vault',
};

/**
 * Which of them this phone actually has, in the order they are shown.
 *
 * The same conditions the buy flow uses: a connected CoinOS account that the
 * storefront allows, an authenticated Bark Vault behind its feature flag, and
 * the two on-chain vaults by whether their wallet exists.
 */
export function useAvailableSwapWallets(): SwapWallet[] {
    const { isAuth, isArkAuth, walletID: hotVaultWalletID, coldStorageWalletID } = useAuthStore();
    const available: SwapWallet[] = [];
    if (!!isAuth && isCoinosAllowed()) available.push('coinos');
    if (!!isArkAuth && FEATURE_ARK_ENABLED) available.push('ark');
    if (hotVaultWalletID) available.push('hot');
    if (coldStorageWalletID) available.push('cold');
    return available;
}

/** The ring each wallet wears when it is the one selected. */
const OUTLINE: Record<SwapWallet, string> = {
    coinos: colors.pink.shadowTopNew,
    ark: colors.ark.light,
    hot: colors.green,
    cold: colors.blueText,
};

/**
 * One wallet, as a tile.
 *
 * Deliberately a copy of ReviewPayment's DestPickerTile rather than a shared
 * component: that one is local to a 2,200 line screen that handles live buys
 * and sends, and lifting it out would touch that screen for no gain here. If a
 * third picker appears, extract it then.
 */
function WalletTile({
    wallet,
    selected,
    onPress,
}: {
    wallet: SwapWallet;
    selected: boolean;
    onPress: () => void;
}) {
    const label = WALLET_LABEL[wallet];
    return (
        <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.75}
            style={[picker.tile, { borderColor: selected ? OUTLINE[wallet] : colors.gray.disable }]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
        >
            {wallet === 'coinos' ? (
                <Image source={CoinOS} style={picker.logo} resizeMode="contain" />
            ) : (
                <View style={picker.tileInner}>
                    <Image
                        source={wallet === 'ark' ? Electricity : wallet === 'hot' ? Hot : Cold1}
                        style={[
                            picker.icon,
                            wallet === 'ark'
                                ? picker.iconBolt
                                : wallet === 'hot'
                                  ? picker.iconHot
                                  : picker.iconCold,
                        ]}
                        resizeMode="contain"
                    />
                    <Text bold style={picker.tileLabel}>{label}</Text>
                </View>
            )}
        </TouchableOpacity>
    );
}

/**
 * Pick the wallet on the bitcoin side of the swap.
 *
 * Two to a row, so the four sit in a square and no tile stretches when only
 * some of them exist. An odd one out gets an invisible spacer beside it rather
 * than half the screen, the same trick the buy flow's picker uses.
 */
export default function WalletPicker({
    title,
    available,
    selected,
    onSelect,
}: {
    /** What the picker is choosing, for example "DEPOSIT BITCOIN TO". */
    title: string;
    available: readonly SwapWallet[];
    selected: SwapWallet | null;
    onSelect: (wallet: SwapWallet) => void;
}) {
    const rows: SwapWallet[][] = [];
    for (let i = 0; i < available.length; i += 2) {
        rows.push(available.slice(i, i + 2));
    }

    return (
        <View style={picker.container}>
            <Text style={picker.title}>{title}</Text>
            {rows.map((row) => (
                <View key={row.join('-')} style={picker.row}>
                    {row.map((wallet) => (
                        <WalletTile
                            key={wallet}
                            wallet={wallet}
                            selected={selected === wallet}
                            onPress={() => onSelect(wallet)}
                        />
                    ))}
                    {row.length === 1 && <View style={picker.spacer} pointerEvents="none" />}
                </View>
            ))}
        </View>
    );
}
