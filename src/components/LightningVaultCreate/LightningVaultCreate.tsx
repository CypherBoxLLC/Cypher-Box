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
import styles from "./styles";
import { Text } from "@Cypher/component-library";
import { Shadow } from "react-native-neomorph-shadows";
import { ProgressBar5, ProgressBarColdStorage } from "@Cypher/assets/images";
import ProgressBar from "../ProgressBar";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import LinearGradient from "react-native-linear-gradient";
import { jsiConfigureProps } from "react-native-reanimated/lib/typescript/reanimated2/core";

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

export default function LightningVaultCreate({ isVault, container, innerContainer, shadowTopBottom, shadowBottomBottom, bitcoinText, onPress, imageStyle, title = 'Savings Vault', titleStyle, bitcoinValue, inDollars, isColorable = false }: Props) {
    const { wallets } = useContext(BlueStorageContext);
    const { walletID, coldStorageWalletID, vaultTab, strikeToken } = useAuthStore();
    const isStrike = !!strikeToken;
    const vaultTabCheck = isVault === false || isVault === true ? isVault : vaultTab;
    const wallet = vaultTabCheck ? wallets.find(w => w.getID() === coldStorageWalletID) : wallets.find(w => w.getID() === walletID);
    const utxo = wallet?.getUtxo(true).sort((a, b) => a.height - b.height || a.txid.localeCompare(b.txid) || a.vout - b.vout) || [];
    // const inDollar = '6500';
    const emptyUTXO = !utxo ? 5 : utxo.length <= 5 ? 5 - utxo.length : utxo.length > 5 && 0;

    return (
        <TouchableOpacity style={[styles.container, container]} onPress={onPress}>
            <View style={[styles.innerContainer, innerContainer]}>
                <Shadow
                    style={StyleSheet.flatten([styles.shadowTopBottom, shadowTopBottom, vaultTabCheck && { shadowColor: colors.pink.light }])}
                    inner
                    useArt
                >
                    <View style={styles}>
                        <View style={styles.row}>
                        {/* {title === 'Hot Vault' ? 
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
                        } */}
                        <Text h3 bold>{title}</Text>
                        <View style={{flexDirection:'row',justifyContent:'flex-end', alignItems: 'flex-end'}}>
                            {/* <Text h4 bold style={StyleSheet.flatten([styles.bitcointext, bitcoinText])}>
                                Strike
                            </Text> */}
                            <Image
                            source={isStrike ? require('@Cypher/assets/images/StrikeText.png') : require('@Cypher/assets/images/coinos.png')}
                            style={{height: 20, width: 80, marginTop: 10, marginStart: 22}}
                            resizeMode="contain"
                            />
                        </View>
                        </View>
                        
                        <View style={styles.view}>
                            <Text bold style={[styles.sats, { fontSize: 12 }]}>
                            withdrawal threshold
                            </Text>
                            {/* <Text bold style={styles.totalsats}>
                            {formatNumber(Number(withdrawThreshold) + Number(reserveAmount))} sats
                            </Text> */}
                        </View>
                        <View>
                            <View style={styles.showLine} />
                            <View style={[styles.box,{/* , { left: `${calculatePercentage(Number(withdrawThreshold), (Number(reserveAmount)))}%` }*/}]} /> 
                            <LinearGradient
                            start={{ x: 0, y: 1 }} end={{ x: 1, y: 1 }}
                            colors={[colors.white, colors.pink.dark]}
                            style={[styles.linearGradient2,{/*, { width: `${calculateBalancePercentage(Number(balance), Number(withdrawThreshold), Number(reserveAmount))}%` }*/}]}>
                            {/* <View style={[styles.box, {marginLeft: `${Math.min((withdrawThreshold / (Number(withdrawThreshold + reserveAmount) || 0)) * 100, 100)}%`}]} /> */}
                            {/* <Shadow
                                inner // <- enable inner shadow
                                useArt // <- set this prop to use non-native shadow on ios
                                style={styles.top2} >
                            </Shadow> */}
                            </LinearGradient>
                            {/* </View>
                            {bitcoinValue &&
                            <View style={styles.bitcoin}>
                                <Text h2>{bitcoinValue} </Text>
                                <Text h3>~ {inDollars}</Text>
                            </View>
                            }

                            <View style={styles.tabs}>
                            {Array(utxo.length > 5 ? 5 : utxo.length).fill(0).map((item, i) => (
                                <ProgressBar key={item} image={vaultTabCheck ? ProgressBarColdStorage : ProgressBar5} />
                            ))}
                            {Array(emptyUTXO).fill(0).map((item, i) => (
                                <View key={item} style={styles.tab} />
                            ))}
                            </View> */}

                    
                        </View>
                        
                    
                    </View>
                </Shadow>
                <Shadow
                        inner
                        useArt
                        style={StyleSheet.flatten([styles.shadowBottomBottom])}
                    />
            </View>
        </TouchableOpacity>
    );
}
