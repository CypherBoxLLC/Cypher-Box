import { Minus, Plus, Strike } from '@Cypher/assets/images'
import { Text } from '@Cypher/component-library'
import React, { useState } from 'react'
import { Image, TouchableOpacity, View } from 'react-native'
import BlackBGView from '../BlackBGView'
import CustomProgressBar from '../CustomProgressBar'
import GradientView from '../GradientView'
import LinearBorderView from './LinearBorderView'
import styles from './styles'
import { dispatchNavigate, formatStrikeNumber } from '@Cypher/helpers'
import { btc, getStrikeCurrency, SATS } from '@Cypher/helpers/coinosHelper'
import useAuthStore from '@Cypher/stores/authStore'
import SimpleToast from "react-native-simple-toast";
import { useNavigation } from '@react-navigation/native'

interface Props {
    showLogo?: boolean;
    isShowButtons?: boolean;
    btcValue?: string;
    matchedRate: number;
    currency: string;
}

function StrikeView({ showLogo = false, isShowButtons = false,
    btcValue = '$80,000 /BTC',
    matchedRate,
    currency
}: Props) {
    // Validate currency is a valid ISO 4217 code, fallback to USD
    const safeCurrency = (currency && /^[A-Z]{3}$/.test(currency)) ? currency : 'USD';
    const { strikeUser, clearStrikeAuth } = useAuthStore();
    const [dollarStrikeText, setDollarStrikeText] = useState(1000000);
    const navigation = useNavigation();

    const addClickHandler = () => {
      if (dollarStrikeText >= 1_000_000_000) {
        // 10 BTC - go to custom amount screen
        buyClickHandler();
        return;
      } else if (dollarStrikeText >= 100_000_000) {
        // BTC range: step 1 BTC (100M sats)
        setDollarStrikeText(dollarStrikeText + 100_000_000);
      } else if (dollarStrikeText >= 20_000_000) {
        setDollarStrikeText(dollarStrikeText + 10_000_000);
      } else if (dollarStrikeText >= 11_000_000) {
        setDollarStrikeText(20_000_000);
      } else if (dollarStrikeText >= 10_000_000) {
        setDollarStrikeText(11_000_000);
      } else if (dollarStrikeText >= 2_000_000) {
        setDollarStrikeText(dollarStrikeText + 1_000_000);
      } else if (dollarStrikeText >= 1_100_000) {
        setDollarStrikeText(2_000_000);
      } else if (dollarStrikeText >= 1_000_000) {
        setDollarStrikeText(1_100_000);
      } else if (dollarStrikeText >= 100_000) {
        setDollarStrikeText(dollarStrikeText + 100_000);
      } else {
        setDollarStrikeText(dollarStrikeText + 10_000);
      }
    }

    const subClickHandler = () => {
      if (dollarStrikeText <= 10_000) return;
      if (dollarStrikeText > 100_000_000) {
        setDollarStrikeText(dollarStrikeText - 100_000_000);
      } else if (dollarStrikeText === 100_000_000) {
        setDollarStrikeText(90_000_000);
      } else if (dollarStrikeText > 20_000_000) {
        setDollarStrikeText(dollarStrikeText - 10_000_000);
      } else if (dollarStrikeText === 20_000_000) {
        setDollarStrikeText(11_000_000);
      } else if (dollarStrikeText === 11_000_000) {
        setDollarStrikeText(10_000_000);
      } else if (dollarStrikeText > 2_000_000) {
        setDollarStrikeText(dollarStrikeText - 1_000_000);
      } else if (dollarStrikeText === 2_000_000) {
        setDollarStrikeText(1_100_000);
      } else if (dollarStrikeText === 1_100_000) {
        // First green chunk → back to full orange (1M)
        setDollarStrikeText(1_000_000);
      } else if (dollarStrikeText > 100_000) {
        // Orange range: step 100K
        const newVal = dollarStrikeText - 100_000;
        setDollarStrikeText(newVal < 100_000 ? 100_000 : newVal);
      } else if (dollarStrikeText === 100_000) {
        // First orange chunk → back to full white (90K)
        setDollarStrikeText(90_000);
      } else {
        // White range: step 10K
        const newVal = dollarStrikeText - 10_000;
        setDollarStrikeText(newVal < 10_000 ? 10_000 : newVal);
      }
    }

    const buyClickHandler = () => {
      const amt = Number(dollarStrikeText * (Number(matchedRate) || 0) * btc(1))
      console.log('amt: ', amt, strikeUser?.[1]?.available)
      if(strikeUser?.[1]?.available == 0){
        SimpleToast.show('Fiat balance is empty, please add cash to buy BTC', SimpleToast.SHORT);
        return
      }
      if(amt == 0){
        SimpleToast.show('Amount cannot be 0', SimpleToast.SHORT);
        return
      }
      if(Number(strikeUser?.[1]?.available) < amt){
        dispatchNavigate('BuyBitcoin', { currency: safeCurrency, matchedRate, fiatAmount: 0, fiatTotal: Number(strikeUser?.[1]?.available), fiatType: "BUY" });    
        
        // SimpleToast.show('Amount is exceeded', SimpleToast.SHORT);
        return
      }
      dispatchNavigate('SendScreen', { currency: safeCurrency, matchedRate, fiatAmount: amt, fiatType: "BUY" });
    }

    const sellClickHandler = () => {
        const amt = Number(dollarStrikeText * (Number(matchedRate) || 0) * btc(1))
        console.log('strikeUser?.[0]?.available: ', strikeUser?.[0]?.available * SATS, dollarStrikeText)
        if(strikeUser?.[0]?.available == 0){
            SimpleToast.show('Bitcoin balance is empty, please add cash to buy Fiat', SimpleToast.SHORT);
            return
        }
        if(dollarStrikeText == 0){
            SimpleToast.show('Amount cannot be 0', SimpleToast.SHORT);
            return
        }
        if(Number(strikeUser?.[0]?.available) < dollarStrikeText){
            // SimpleToast.show('Amount is exceeded', SimpleToast.SHORT);
            dispatchNavigate('BuyBitcoin', { currency: safeCurrency, matchedRate, fiatAmount: 0, fiatTotal: Number(strikeUser?.[0]?.available), fiatType: "SELL" });    
            return
        }
        dispatchNavigate('SendScreen', { currency: safeCurrency, matchedRate, fiatAmount: amt, fiatType: "SELL" });    
    }

    const handleStrikeLogout = async () => {
        clearStrikeAuth();
        setTimeout(() => {
            navigation.goBack();
        }, 500);
    };

    return (
        <View style={styles.container}>
            <View style={styles.rowContainer}>
                <LinearBorderView>
                    <View style={styles.strikeRow}>
                        <View style={styles.sideContainer}>
                            <View style={styles.fiatBalanceBox}>
                                <Text h2 bold>Fiat Balance</Text>
                                <Text h2 bold>{`${getStrikeCurrency(safeCurrency)}${Number(strikeUser?.[1]?.available || 0).toFixed(2)}`}</Text>
                            </View>
                            <GradientView
                                style={styles.sellBuyButton}
                                linearGradientStyle={styles.sellBuyGradient}
                                topShadowStyle={styles.topShadow}
                                bottomShadowStyle={styles.bottomShadow}
                                linearGradientStyleMain={styles.linearGradientStyleMain}
                                onPress={sellClickHandler}
                            >
                                <Text h3 bold center>SELL</Text>
                            </GradientView>
                        </View>

                        <View style={styles.sideContainer}>
                            <BlackBGView linearFirstStyle={styles.fiatBalanceBox2}
                                linearSecondStyle={styles.fiatBalanceBox3}>
                                <CustomProgressBar value={dollarStrikeText} />
                                <Text h3 bold >{dollarStrikeText >= 100_000_000 ? `${(dollarStrikeText / 100_000_000)} BTC` : `${formatStrikeNumber(dollarStrikeText)} sats`}</Text>
                                <Text h4 semibold>{getStrikeCurrency(safeCurrency) + (dollarStrikeText * (Number(matchedRate) || 0) * btc(1)).toFixed(2)}</Text>
                            </BlackBGView>
                            <GradientView
                                style={styles.sellBuyButton}
                                linearGradientStyle={styles.sellBuyGradient}
                                topShadowStyle={styles.topShadow}
                                bottomShadowStyle={styles.bottomShadow}
                                linearGradientStyleMain={styles.linearGradientStyleMain}
                                onPress={buyClickHandler}
                            >
                                <Text h3 bold center>BUY</Text>
                            </GradientView>
                        </View>
                    </View>
                </LinearBorderView>
                <View>
                    <GradientView
                        style={styles.sellBuyButton2}
                        linearGradientStyle={styles.sellBuyGradient2}
                        topShadowStyle={styles.topShadow2}
                        bottomShadowStyle={styles.bottomShadow2}
                        linearGradientStyleMain={styles.linearGradientStyleMain2}
                        onPress={addClickHandler}
                    >
                        <Image source={Plus} resizeMode='contain' />
                    </GradientView>
                    <GradientView
                        style={[styles.sellBuyButton2, { marginTop: 5 }]}
                        linearGradientStyle={styles.sellBuyGradient2}
                        topShadowStyle={styles.topShadow2}
                        bottomShadowStyle={styles.bottomShadow2}
                        linearGradientStyleMain={styles.linearGradientStyleMain2}
                        onPress={subClickHandler}
                    >
                        <Image source={Minus} resizeMode='contain' />
                    </GradientView>
                </View>
            </View>
            {/* TODO: Deposit-Withdraw fiat - implement with Strike banking API later */}
            {/* {isShowButtons &&
                <View style={styles.bottomButtonsContainer}>
                    <GradientView
                        style={styles.sellBuyButton3}
                        linearGradientStyle={styles.sellBuyGradient3}
                        topShadowStyle={styles.topShadow3}
                        bottomShadowStyle={styles.bottomShadow3}
                        linearGradientStyleMain={styles.linearGradientStyleMain3}
                    >
                        <Text h3 bold center>Deposit-Withdraw fiat</Text>
                    </GradientView>
                </View>
            } */}
            <BlackBGView linearFirstStyle={styles.bitcoinPriceContainer}>
                <Text bold style={styles.bitcoinPriceText}>{(Number(matchedRate) || 0).toLocaleString('en-US', { style: 'currency', currency: safeCurrency }) + ' /BTC'}</Text>
            </BlackBGView>
            {isShowButtons &&
                <GradientView
                    style={[styles.sellBuyButton4, { marginTop: 60 }]}
                    linearGradientStyle={styles.sellBuyGradient4}
                    topShadowStyle={styles.topShadow4}
                    bottomShadowStyle={styles.bottomShadow4}
                    linearGradientStyleMain={styles.linearGradientStyleMain4}
                    onPress={handleStrikeLogout}
                >
                    <Text h3 bold center>Logout</Text>
                </GradientView>
            }
            {showLogo &&
                <Image source={Strike} style={styles.strikeLogo} resizeMode='contain' />
            }
        </View>
    )
}

export default StrikeView

