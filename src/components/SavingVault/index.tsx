import React, { useContext } from "react";
import {
    I18nManager,
    Image,
    ImageStyle,
    StyleSheet,
    TextStyle,
    TouchableOpacity,
    TouchableOpacityProps,
    View,
    ViewStyle,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import styles from "./styles";
import loc from "../../../loc";
import { Text } from "@Cypher/component-library";
import { ProgressBar5, ProgressBarColdStorage } from "@Cypher/assets/images";
import ProgressBar from "../ProgressBar";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import useAuthStore from "@Cypher/stores/authStore";
import { colors, ltr } from "@Cypher/style-guide";
import { HIDDEN_AMOUNT, maskAmount } from "@Cypher/helpers/hiddenAmount";
import { largestCapsules, VAULT_CARD_CAPSULES } from "@Cypher/helpers/vaultCardCapsules";
import { useBalancesHidden } from "@Cypher/stores/balancePrivacy";
import VaultCapsules from "../VaultCapsules";

interface Props extends TouchableOpacityProps {
    isVault?: boolean;
    container?: ViewStyle;
    innerContainer?: ViewStyle;
    shadowTopBottom?: any;
    shadowBottomBottom?: any;
    bitcoinText?: TextStyle;
    imageStyle?: ImageStyle;
    titleStyle?: TextStyle;
    onPress?(): void;
    title?: string;
    bitcoinValue?: string | false | undefined;
    inDollars?: any;
    isColorable?: boolean;
    /** The "Bitcoin Network" label beside the title. Off inside a vault's own menu, where the screen already says
     *  which vault it is and long titles such as "Watch-&-Broadcast-Only" need the row. */
    showNetwork?: boolean;
    /** Home's cards: the amounts and capsules go behind *** while Home's balances are hidden (the logo button on
     *  the total balance card). */
    hideWithBalances?: boolean;
}

/**
 * The dollar amount that follows the BTC amount, with the ~ between the two numbers in either language: before the
 * dollars in English, after them in Arabic, where the row puts the dollars to the left of the BTC amount. The no-break
 * space keeps a gap to the BTC amount when the row flips in RTL.
 */
const fiatAfterBtc = (fiat: string) => ltr(I18nManager.isRTL ? `${fiat} ~\u00A0` : `~ ${fiat}\u00A0`);

export default function SavingVault({ isVault, container, innerContainer, shadowTopBottom, shadowBottomBottom, bitcoinText, onPress, imageStyle, title = loc.cypherbox.components.saving_vault.savings_vault, titleStyle, bitcoinValue, inDollars, isColorable = false, showNetwork = true, hideWithBalances = false }: Props) {
    const { wallets } = useContext(BlueStorageContext);
    // Per-field selectors, NOT a whole-store destructure. The bare
    // `useAuthStore()` re-rendered this card on EVERY store change (the Ark
    // sync writes balance/vtxo/tip fields every ~30s and more), and each
    // re-render repaints the LinearGradient + icons under RN 0.77's Fabric
    // interop, which flickers the "Hot Vault" / "Bitcoin Network" text and
    // icons. Selecting only the three fields we use means the card re-renders
    // only when they actually change.
    const walletID = useAuthStore(s => s.walletID);
    const coldStorageWalletID = useAuthStore(s => s.coldStorageWalletID);
    const vaultTab = useAuthStore(s => s.vaultTab);
    const balancesHidden = useBalancesHidden();
    const hidden = hideWithBalances && balancesHidden;
    const vaultTabCheck = isVault === false || isVault === true ? isVault : vaultTab;
    const wallet = vaultTabCheck ? wallets.find(w => w.getID() === coldStorageWalletID) : wallets.find(w => w.getID() === walletID);
    // the flame for the Hot Vault's card, the snowflake for the Cold Vault's: the same choice as the wallet above, so
    // it holds in any language and for titles like "Hot Savings"
    const isHotCard = !vaultTabCheck;
    const utxo = largestCapsules(wallet?.getUtxo(true));
    return (
        <TouchableOpacity style={[styles.container, container]} onPress={onPress}>
            <View style={[styles.innerContainer, innerContainer]}>
                <View
                    style={StyleSheet.flatten([
                        styles.shadowTopBottom,
                        shadowTopBottom,
                        // Cold-vault override: keep the blue rim but tame the
                        // glow. The new app-wide shadow values (8/8 offset,
                        // opacity .7, radius 16) made the bright #21C7FB blow
                        // out into a halo; trim opacity / radius / offset so
                        // the cold card matches the hot card's footprint.
                        vaultTabCheck && {
                            // Cold vault keeps its blue rim but the shadow
                            // inherits the base 8/8 black drop from
                            // shadowTopBottom — same direction + intensity
                            // as the Hot vault, just a different border.
                            borderColor: '#21C7FB',
                        },
                    ])}
                >
                    {/* Solid deep-grey → black gradient. Opaque colours so
                        the gradient is visibly grey at the top fading to
                        true black at the bottom. Content siblings render
                        after this in tree order so they sit on top. */}
                    <LinearGradient
                        colors={['#2A2A2A', '#000000']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        pointerEvents="none"
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            borderRadius: 25,
                        }}
                    />
                    {/* Translucent shield watermark — same treatment as
                        the "Unlock Hot/Cold Vault" CTAs and the Lightning
                        wallet cards, so the visual motif carries over
                        once the vault is created. Sits between the
                        background gradient and the foreground content. */}
                    <Image
                        source={
                            isHotCard
                                ? require('@Cypher/assets/images/fireShield.png')
                                : require('@Cypher/assets/images/coldShield.png')
                        }
                        style={{
                            position: 'absolute',
                            alignSelf: 'center',
                            top: 10,
                            bottom: 0,
                            width: 90,
                            height: '100%',
                            opacity: 0.10,
                        }}
                        resizeMode="contain"
                        pointerEvents="none"
                    />
                    <View style={styles.bottominner}>
                        <View style={{flexDirection: "row", flex:1, justifyContent: "flex-start", alignItems: "center"}}>
                        {isHotCard ?
                            <Image
                            source={require('@Cypher/assets/images/fireShield.png')}
                            style={{width:25, height: 25, marginRight:8}}
                            resizeMode="contain"
                            /> :
                            <Image
                                source={require('@Cypher/assets/images/coldShield.png')}
                                style={{width:25, height: 25, marginRight:8}}
                                resizeMode="contain"
                            />
                        }
                        <Text h3 bold style={titleStyle}>{title}</Text>
                        </View>
                        {showNetwork ? (
                            <View style={styles.row}>
                                <Text h4 bold style={StyleSheet.flatten([styles.bitcointext, bitcoinText])}>
                                    {loc.cypherbox.components.saving_vault.bitcoin_network}
                                </Text>
                                <Image
                                    style={[styles.bitcoinimg, imageStyle]}
                                    resizeMode="contain"
                                    source={require("../../../img/bitcoin.png")}
                                />
                            </View>
                        ) : null}
                    </View>
                    {bitcoinValue &&
                        <View style={[styles.bitcoin, { marginTop: 11, marginLeft: 6 }]}>
                            <Text h2 bold amount style={{ fontSize: 18 }}>{`${hidden ? maskAmount(bitcoinValue) : bitcoinValue} `}</Text>
                            <Text h3>{fiatAfterBtc(hidden ? maskAmount(inDollars) : inDollars)}</Text>
                        </View>
                    }

                    <View style={styles.tabs} testID={hidden ? 'vault-capsules-hidden' : 'vault-capsules'}>
                        {hidden ? (
                            // Every slot the same, so neither the sizes nor the count show.
                            Array(VAULT_CARD_CAPSULES).fill(0).map((_, i) => (
                                <View key={`h-${i}`} style={[styles.tab, styles.hiddenTab]}>
                                    <Text style={styles.hiddenTabText}>{HIDDEN_AMOUNT}</Text>
                                </View>
                            ))
                        ) : (
                            <>
                                {utxo.map((capsule) => (
                                    <VaultCapsules key={`${capsule.txid}:${capsule.vout}`} item={capsule.amount} isPending={capsule.height === 0} isVault={vaultTabCheck} />
                                ))}
                                {Array(VAULT_CARD_CAPSULES - utxo.length).fill(0).map((_, i) => (
                                    <View key={`e-${i}`} style={styles.tab} />
                                ))}
                            </>
                        )}
                    </View>
                </View>
            </View>
        </TouchableOpacity>
    );
}
