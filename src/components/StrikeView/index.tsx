import { Minus, Plus, Strike } from '@Cypher/assets/images'
import { Text } from '@Cypher/component-library'
import React, { useState } from 'react'
import { Image, View } from 'react-native'
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
    const { strikeUser, clearStrikeAuth } = useAuthStore();
    const [dollarStrikeText, setDollarStrikeText] = useState(1000000);
    const navigation = useNavigation();

    const addClickHandler = () => {
      setDollarStrikeText(dollarStrikeText + 100000)
    }

    const subClickHandler = () => {
      if(dollarStrikeText !== 0)
        setDollarStrikeText(dollarStrikeText - 100000)    
    }

    const buyClickHandler = () => {
      const amt = Number(dollarStrikeText * matchedRate * btc(1))
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
        dispatchNavigate('BuyBitcoin', { currency, matchedRate, fiatAmount: 0, fiatTotal: Number(strikeUser?.[1]?.available), fiatType: "SELL" });    
        
        // SimpleToast.show('Amount is exceeded', SimpleToast.SHORT);
        return
      }
      dispatchNavigate('SendScreen', { currency, matchedRate, fiatAmount: amt, fiatType: "BUY" });
    }

    const sellClickHandler = () => {
        const amt = Number(dollarStrikeText * matchedRate * btc(1))
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
            dispatchNavigate('BuyBitcoin', { currency, matchedRate, fiatAmount: 0, fiatTotal: Number(strikeUser?.[0]?.available), fiatType: "BUY" });    
            return
        }
        dispatchNavigate('SendScreen', { currency, matchedRate, fiatAmount: amt, fiatType: "SELL" });    
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
                                <Text h2 bold>{`${getStrikeCurrency(currency || 'USD')}${Number(strikeUser?.[1]?.available)}`}</Text>
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
                                <Text h3 bold >{`${formatStrikeNumber(dollarStrikeText)} sats`}</Text>
                                <Text h4 semibold>{getStrikeCurrency(currency || 'USD') + (dollarStrikeText * matchedRate * btc(1)).toFixed(2)}</Text>
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
            {isShowButtons &&
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
                    <GradientView
                        style={styles.sellBuyButton4}
                        linearGradientStyle={styles.sellBuyGradient4}
                        topShadowStyle={styles.topShadow4}
                        bottomShadowStyle={styles.bottomShadow4}
                        linearGradientStyleMain={styles.linearGradientStyleMain4}
                        onPress={handleStrikeLogout}
                    >
                        <Text h3 bold center>Logout</Text>
                    </GradientView>
                </View>
            }
            <BlackBGView linearFirstStyle={styles.bitcoinPriceContainer}>
                <Text bold style={styles.bitcoinPriceText}>{matchedRate.toLocaleString('en-US', { style: 'currency', currency: currency || 'USD' }) + ' /BTC' || `${getStrikeCurrency(currency || 'USD')}0.00` + ' /BTC'}</Text>
            </BlackBGView>
            {showLogo &&
                <Image source={Strike} style={styles.strikeLogo} resizeMode='contain' />
            }
        </View>
    )
}

export default StrikeView

