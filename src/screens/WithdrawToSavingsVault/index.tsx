import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, TouchableOpacity, View, Dimensions } from 'react-native';
import styles from './styles';
import { CoinOSSmall, ProgressBar1, ProgressIndicator } from '@Cypher/assets/images';
import { ScreenLayout, Text } from '@Cypher/component-library';
import { dispatchNavigate } from '@Cypher/helpers';
import { Shadow } from 'react-native-neomorph-shadows';
import { colors } from '@Cypher/style-guide';
import LinearGradient from 'react-native-linear-gradient';
import useAuthStore from '@Cypher/stores/authStore';
import { getCurrencyRates, getMe, getTransactionHistory } from '@Cypher/api/coinOSApis';
import { matchKeyAndValue } from '@Cypher/helpers/coinosHelper';
import Svg, { SvgProps, Path } from 'react-native-svg';
import { ProgressBar } from '@Cypher/components';
import { mostRecentFetchedRate } from '../../../blue_modules/currency';

const { width } = Dimensions.get('screen');

interface Props {
    route: any;
}

const Arrow = (props: SvgProps) => (
    <Svg width={202} height={211} fill="none" {...props} style={styles.arrowConnector}>
        <Path
            fill="#fff"
            d="M201.5 1.5a1 1 0 0 0-2 0h2Zm-170 208.44c0 .552.676.943 1.155.667l7.69-4.44c.479-.276.479-1.058 0-1.334l-7.69-4.44c-.479-.276-1.155.115-1.155.667v8.88ZM199.5 1.5v75h2v-75h-2Zm-23 98H25v2h151.5v-2ZM0 124.5v57h2v-57H0Zm25 82h7.5v-2H25v2Zm-25-25c0 13.807 11.193 25 25 25v-2c-12.703 0-23-10.297-23-23H0Zm25-82c-13.807 0-25 11.193-25 25h2c0-12.703 10.297-23 23-23v-2Zm174.5-23c0 12.703-10.297 23-23 23v2c13.807 0 25-11.193 25-25h-2Z"
        />
    </Svg>
);

export const calculatePercentage = (withdrawThreshold: number, reserveAmount: number) => {
    const threshold = Number(withdrawThreshold);
    const reserve = Number(reserveAmount);

    const percentage = (threshold / (threshold + reserve)) * 100;
    return Math.min(percentage, 100);
};

export default function WithdrawToSavingsVault({ route }: Props) {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [balance, setBalance] = useState(0);

    const [matchedRate, setMatchedRate] = useState(0);
    const [payment, setPayments] = useState([]);

    const { isAuth, token, withdrawThreshold, reserveAmount, setUser } = useAuthStore();

    useEffect(() => {
        async function handleToken() {
            if (isAuth && token) {
                handleUser();
                loadPayments();
            } else {
                const rates = await exchangeRate();
                console.log('rates: ', rates)
                if (rates && rates?.Rate) {
                  const numericAmount = Number(rates.Rate.replace(/[^0-9\.]/g, ''));
                  setMatchedRate(numericAmount);
                }
                setIsLoading(false);
            }
        }

        handleToken();
    }, [isAuth, token]);

    const exchangeRate = async () => {
        const rates = await mostRecentFetchedRate();
        return rates
    }
    
    const handleUser = async () => {
        try {
            const response = await getMe();
            const responsetest = await getCurrencyRates();
            const matched = matchKeyAndValue(responsetest, 'USD');
            setMatchedRate(matched || 0);
            if (response?.balance) {
                setBalance(response?.balance || 0);
            }
            setUser(response?.username);
        } catch (error) {
            console.error('error: ', error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadPayments = async (append = true) => {
        try {
            const paymentList = await getTransactionHistory(0, 5);
            setPayments(paymentList.payments);
        } catch (error) {
            console.error('Error loading payments:', error);
        }
    };

    const checkingAccountClickHandler = () => {
        dispatchNavigate('CheckingAccount', { matchedRate });
    };

    const nextClickHandler = () => {
        dispatchNavigate('ReviewWithdrawal', {
            value: withdrawThreshold,
            // converted: sats,
            isSats: withdrawThreshold,
            to: 'sadiq',
            fees: 100,
            currency: 'usd',
            type: 'bitcoin',
            recommendedFee: 10,
        });
    };

    return (
        <ScreenLayout title="Coin Withdrawal" showToolbar isBackButton disableScroll>
            <View style={styles.container}>
                <TouchableOpacity style={styles.shadowView} onPress={checkingAccountClickHandler}>
                    <Shadow style={StyleSheet.flatten([styles.shadowTop, { shadowColor: colors.pink.shadowTop, padding: 0 }])} inner useArt>
                        <View style={styles.view}>
                            <Text h2 bold style={styles.check}>
                                Lightning Account
                            </Text>
                            <Image source={CoinOSSmall} style={styles.blink} resizeMode="contain" />
                        </View>
                        <View style={{ flexDirection: 'row', bottom: 30 }}>
                            <LinearGradient
                                start={{ x: 0, y: 1 }}
                                end={{ x: 1, y: 1 }}
                                colors={[colors.white, colors.white]}
                                style={[styles.linearGradient2, { width: `20%`, right: 3 }]}
                            />
                            <View style={styles.progress}>
                                <View style={styles.showLine} />
                                <View style={[styles.box, { left: `${calculatePercentage(withdrawThreshold, reserveAmount)}%` }]} />
                                <LinearGradient
                                    start={{ x: 0, y: 1 }}
                                    end={{ x: 1, y: 1 }}
                                    colors={[colors.white, colors.pink.dark]}
                                    style={[styles.linearGradient2, { width: `100%`, }]}
                                />
                            </View>
                        </View>
                        <Shadow inner useArt style={StyleSheet.flatten([styles.shadowBottom, { shadowColor: colors.pink.shadowBottom }])} />
                    </Shadow>
                </TouchableOpacity>
                <View style={styles.shadowViewBottom}>
                    <Shadow
                        style={StyleSheet.flatten([
                            styles.shadowTop,
                            {
                                shadowColor: colors.greenShadow,
                                paddingStart: 20,
                                paddingEnd: 10,
                            },
                        ])}
                        inner
                        useArt
                    >
                        <View style={styles.bottominner}>
                            <Text h2 bold>
                                Savings Vault
                            </Text>
                            <View style={styles.row}>
                                <Text h3 bold style={styles.bitcointext}>
                                    Bitcoin Network
                                </Text>
                                <Image style={styles.bitcoinimg} resizeMode="contain" source={require('../../../img/bitcoin.png')} />
                            </View>
                        </View>
                        <View style={styles.utxoCapsule}>
                            <ProgressBar image={ProgressBar1} />
                            <ProgressBar />
                            <ProgressBar />
                            <ProgressBar />
                            <ProgressBar />
                        </View>
                    </Shadow>
                </View>
                <View style={styles.arrowContainer}>
                    <Image source={ProgressIndicator} style={styles.progressBarIndicator} />
                    <Arrow />
                </View>

                <View style={styles.textContainer}>
                    <Text>
                        The full pink bar represents the funds accumulated inside the Lightning Account. By clicking ‘Withdraw’ it will convert most of
                        the funds into a real verifiable bitcoin ‘capsule’ (also known as a UTXO) filling one of the five slots in your Hot Vault, and
                        leaving a small amount as pocket money for quick spending (Reserve Amount).
                    </Text>
                </View>

                <TouchableOpacity style={styles.nextButton} onPress={nextClickHandler}>
                    <LinearGradient start={{ x: 0, y: 1 }} end={{ x: 1, y: 1 }} colors={['#FF65D4', '#D617A1']} style={styles.nextButton}>
                        <Text bold style={styles.textStyle}>
                            Next
                        </Text>
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </ScreenLayout>
    );
}
