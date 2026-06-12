import React, { useContext } from "react";
import {
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
import { Text } from "@Cypher/component-library";
import { ProgressBar5, ProgressBarColdStorage } from "@Cypher/assets/images";
import ProgressBar from "../ProgressBar";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
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
}

export default function SavingVault({ isVault, container, innerContainer, shadowTopBottom, shadowBottomBottom, bitcoinText, onPress, imageStyle, title = 'Savings Vault', titleStyle, bitcoinValue, inDollars, isColorable = false }: Props) {
    const { wallets } = useContext(BlueStorageContext);
    const { walletID, coldStorageWalletID, vaultTab } = useAuthStore();
    const vaultTabCheck = isVault === false || isVault === true ? isVault : vaultTab;
    const wallet = vaultTabCheck ? wallets.find(w => w.getID() === coldStorageWalletID) : wallets.find(w => w.getID() === walletID);
    const utxo = wallet?.getUtxo(true).sort((a, b) => a.height - b.height || a.txid.localeCompare(b.txid) || a.vout - b.vout) || [];
    // const inDollar = '6500';
    const emptyUTXO = !utxo ? 5 : utxo.length <= 5 ? 5 - utxo.length : utxo.length > 5 && 0;
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
                            title === 'Hot Vault'
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
                        {title === 'Hot Vault' ?
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
                        <View style={styles.row}>
                            <Text h4 bold style={StyleSheet.flatten([styles.bitcointext, bitcoinText])}>
                                Bitcoin Network
                            </Text>
                            <Image
                                style={[styles.bitcoinimg, imageStyle]}
                                resizeMode="contain"
                                source={require("../../../img/bitcoin.png")}
                            />
                        </View>
                    </View>
                    {bitcoinValue &&
                        <View style={[styles.bitcoin, { marginTop: 11, marginLeft: 6 }]}>
                            <Text h2 bold style={{ fontSize: 18 }}>{bitcoinValue} </Text>
                            <Text h3>~ {inDollars}</Text>
                        </View>
                    }

                    <View style={styles.tabs}>
                        {Array(utxo.length > 5 ? 5 : utxo.length).fill(0).map((item, i) => (
                            <VaultCapsules key={i} item={utxo[i].amount} isPending={utxo[i].height === 0} isVault={vaultTabCheck}></VaultCapsules>
                            // <ProgressBar key={item} image={vaultTabCheck ? ProgressBarColdStorage : ProgressBar5} />
                        ))}
                        {Array(emptyUTXO).fill(0).map((item, i) => (
                            <View key={i} style={styles.tab} />
                        ))}
                    </View>
                </View>
            </View>
        </TouchableOpacity>
    );
}
