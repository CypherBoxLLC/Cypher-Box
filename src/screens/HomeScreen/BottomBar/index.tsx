// createInvoice moved to TopupList

import { Text } from "@Cypher/component-library";
import { GradientView, SavingVault } from "@Cypher/components";
import { dispatchNavigate } from "@Cypher/helpers";
import { btc, SATS } from "@Cypher/helpers/coinosHelper";
import useAuthStore from "@Cypher/stores/authStore";
import { colors, shadow } from "@Cypher/style-guide";
import screenWidth from "@Cypher/style-guide/screenWidth";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, FlatList, Image, NativeScrollEvent, NativeSyntheticEvent, StyleSheet, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import SimpleToast from "react-native-simple-toast";
import { useFocusEffect } from "@react-navigation/native";
import styles from "../styles";
import TabBar from "../TabBar";
// createInvoiceStrike moved to TopupList

interface Props {
    balance: any;
    wallet: any;
    currency: any;
    matchedRate: any;
    balanceVault: any;
    hasSavingVault: any;
    balanceWithoutSuffix: any;
    hasColdStorage: any;
    coldStorageWallet: any;
    coldStorageAddress: any;
    coldStorageBalanceVault: any;
    coldStorageBalanceWithoutSuffix: any;
    vaultAddress: any;
    recommendedFee: any;
    refWithdrawRBSheet: any;
    refTopupRBSheet: any;
    currencyStrike: any;
    matchedRateStrike: any;
    matchedRateBTC: any;
}

export default function BottomBar({
    balance,
    wallet,
    refWithdrawRBSheet,
    refTopupRBSheet,
    currency,
    matchedRate,
    matchedRateBTC,
    balanceVault,
    hasSavingVault,
    balanceWithoutSuffix,
    hasColdStorage,
    coldStorageWallet,
    coldStorageAddress,
    coldStorageBalanceVault,
    coldStorageBalanceWithoutSuffix,
    vaultAddress,
    recommendedFee,
    currencyStrike,
    matchedRateStrike
}: Props) {
    if (__DEV__) console.log("🚀 ~ hasSavingVault:", hasSavingVault)
    const { isAuth, isStrikeAuth, isArkAuth, strikeUser, withdrawStrikeThreshold, withdrawThreshold, reserveAmount, reserveStrikeAmount, vaultTab, setVaultTab } = useAuthStore();
    const bothVaultsExist = !!(wallet && coldStorageWallet);

    const flatListRef = useRef<FlatList<any>>(null);
    const glowAnim = useRef(new Animated.Value(0)).current;

    // Check if either account has reached its threshold
    const coinosBalance = Number(balance) || 0;
    const strikeBalance = Math.round(Number(strikeUser?.[0]?.available || 0) * SATS);
    const coinosTotal = Number(withdrawThreshold) + Number(reserveAmount);
    const strikeTotal = Number(withdrawStrikeThreshold) + Number(reserveStrikeAmount);
    const shouldGlow = (isAuth && coinosBalance >= coinosTotal) || (isStrikeAuth && strikeBalance >= strikeTotal);

    const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

    const startPulse = useCallback(() => {
        pulseRef.current?.stop();
        glowAnim.setValue(0);
        pulseRef.current = Animated.loop(
            Animated.sequence([
                Animated.timing(glowAnim, { toValue: 1, duration: 1200, useNativeDriver: false }),
                Animated.timing(glowAnim, { toValue: 0, duration: 1200, useNativeDriver: false }),
            ])
        );
        pulseRef.current.start();
    }, []);

    // Start on mount + whenever shouldGlow changes
    useEffect(() => {
        if (shouldGlow) {
            startPulse();
        } else {
            pulseRef.current?.stop();
            pulseRef.current = null;
            glowAnim.setValue(0);
        }
        return () => {
            pulseRef.current?.stop();
            pulseRef.current = null;
        };
    }, [shouldGlow]);

    // Also restart on screen focus (coming back from other screens, app reopen)
    useFocusEffect(
        useCallback(() => {
            if (shouldGlow) {
                startPulse();
            }
        }, [shouldGlow])
    );

    const getInitialIndex = () => {
        if (vaultTab) return 1;
        if (!hasSavingVault && hasColdStorage) return 1;
        return 0;
    };
    const [index, setIndex] = useState(getInitialIndex());

    useEffect(() => {
        if (!hasSavingVault && hasColdStorage && !vaultTab) {
            setVaultTab(true);
        }
    }, []);

    const coldStorageClickHandler = () => {
        setVaultTab(true);
        flatListRef.current?.scrollToIndex({ index: 1, animated: true });
    };
    const hotStorageClickHandler = () => {
        setVaultTab(false);
        flatListRef.current?.scrollToIndex({ index: 0, animated: true });
    };

    const handleCreateVault = () => {
        dispatchNavigate('SavingVaultIntro');
    }

    const handleRecoverSavingVault = () => {
        dispatchNavigate('RecoverSavingVault');
    };

    const handleCreateColdVault = () => {
        dispatchNavigate('ColdVaultIntro');
    }

    const topupClickHandler = () => {
        if (!isAuth && !isStrikeAuth && !isArkAuth) {
            SimpleToast.show('You need to be logged in to wallet to top up', SimpleToast.SHORT);
            return;
        }
        if (!wallet && !coldStorageWallet) {
            SimpleToast.show('You need to create a vault first', SimpleToast.SHORT);
            return;
        }
        refTopupRBSheet?.current?.open();
    };

    const withdrawClickHandler = () => {
        if (!isAuth && !isStrikeAuth && !isArkAuth) {
            SimpleToast.show('You need to be logged in to wallet to withdraw', SimpleToast.SHORT);
            return
        }
        if(!wallet && !coldStorageWallet) {
            dispatchNavigate('SavingVaultIntro');
        }
        // if (vaultTab && !coldStorageWallet) {
        //     SimpleToast.show('You need to have a cold storage wallet to withdraw', SimpleToast.SHORT);
        //     return
        // }

        // Open the popup when there's any ambiguity to resolve: multiple
        // vaults to choose between, OR multiple sources (Strike/CoinOS/Ark)
        // to withdraw from. For Ark we always go through the popup —
        // selecting hot/cold vault at the destination step is part of the
        // Ark flow, even if there's just one source.
        if ((wallet && coldStorageWallet) || (isAuth && isStrikeAuth) || isArkAuth) {
            refWithdrawRBSheet.current?.open();
            // const amount = withdrawThreshold > balance ? balance : withdrawThreshold;
            // dispatchNavigate('ReviewPayment', {
            //     value: amount,
            //     converted: ((Number(matchedRate) || 0) * btc(1) * Number(amount)).toFixed(2),
            //     isSats: true,
            //     to: vaultTab ? coldStorageAddress : vaultAddress,
            //     fees: 0,
            //     matchedRate: matchedRate,
            //     currency: currency,
            //     type: 'bitcoin',
            //     feeForBamskki: 0,
            //     recommendedFee,
            //     wallet: vaultTab ? coldStorageWallet : wallet,
            //     isWithdrawal: true,
            // });
        } else if(isAuth) {
            const amount = withdrawThreshold > balance ? balance : withdrawThreshold;
            if (__DEV__) console.log('amount: ', amount)
            dispatchNavigate('ReviewPayment', {
                value: amount,
                converted: ((Number(matchedRate) || 0) * btc(1) * Number(amount)).toFixed(2),
                isSats: true,
                to: coldStorageWallet ? coldStorageAddress : vaultAddress,
                fees: 0,
                total: btc(Number(amount)),
                matchedRate: matchedRate,
                currency: currency,
                type: 'bitcoin',
                feeForBamskki: 0,
                recommendedFee,
                vaultTab: coldStorageWallet ? true : false,
                receiveType: true,
                wallet: coldStorageWallet ? coldStorageWallet : wallet,
                isWithdrawal: true,
            });
        } else if (isStrikeAuth) {
              const strikeBalance = Math.round(Number(strikeUser?.[0]?.available || 0) * SATS);
              const amount = withdrawStrikeThreshold > strikeBalance ? strikeBalance : withdrawStrikeThreshold;
              if (__DEV__) console.log('amount: ', amount)
              dispatchNavigate('ReviewPayment', {
                  value: amount,
                  converted: ((Number(matchedRateStrike) || 0) * btc(1) * Number(amount)).toFixed(2),
                  isSats: true,
                  to: coldStorageWallet ? coldStorageAddress : vaultAddress,
                  fees: 0,
                  total: btc(Number(amount)),
                  matchedRate: matchedRateStrike,
                  currency: currencyStrike,
                  type: 'bitcoin',
                  feeForBamskki: 0,
                  recommendedFee,
                  vaultTab: coldStorageWallet ? true : false,
                  receiveType: false,
                  wallet: coldStorageWallet ? coldStorageWallet : wallet,
                  isWithdrawal: true,
              });
        }
    };

    const savingVaultClickHandler = () => {
        dispatchNavigate('HotStorageVault', { wallet: vaultTab ? coldStorageWallet : wallet, matchedRate: matchedRateBTC });
    };

    const tabs = [
        { key: "hot", title: "Hot Storage", component: () => <HotStorageTab /> },
        { key: "cold", title: "Cold Storage", component: () => <ColdStorageTab /> },
    ];

    const HotStorageTab = () => (
        <View>
            {(hasSavingVault && wallet) ? (
                <SavingVault
                    container={StyleSheet.flatten([styles.savingVault, { marginTop: 14 }])}
                    innerContainer={styles.savingVault}
                    shadowTopBottom={styles.savingVault}
                    shadowBottomBottom={styles.savingVault}
                    bitcoinText={styles.bitcoinText}
                    isVault={false}
                    title={"Hot Vault"}
                    onPress={savingVaultClickHandler}
                    bitcoinValue={balanceVault}
                    inDollars={`$${(Number(balanceWithoutSuffix || 0) * Number(matchedRateBTC || 0)).toFixed(2)}`}
                    isColorable
                />
            )
                :
                (
                    <View style={styles.createVaultContainer}>
                        <View style={styles.alreadyView}>
                            <Text bold style={styles.text}>
                                Already have a vault?
                            </Text>
                            <TouchableOpacity onPress={handleRecoverSavingVault}>
                                <Text bold style={[styles.login, { color: colors.green }]}>
                                    Recover
                                </Text>
                            </TouchableOpacity>
                        </View>
                        {/* Outlined-only "Unlock Hot Vault" card —
                            green gradient ring on a dark interior,
                            matching the slick treatment of the Unlock
                            Lightning Wallet CTA. Replaces the previous
                            solid green fill so the shield watermark
                            and label read against a dark surface. */}
                        <TouchableOpacity activeOpacity={0.85} onPress={handleCreateVault} style={[styles.createView, { borderRadius: 25, width: screenWidth - 40, height: 135 }]}>
                            <LinearGradient
                                colors={[colors.green_.greenGradient1, colors.green_.greenGradient2]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={{ borderRadius: 25, padding: 1.5, height: '100%' }}
                            >
                                <View style={{ flex: 1, borderRadius: 23.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                                    {/* Light grey → black inner fill, same
                                        gradient the created Hot/Cold vault
                                        cards (SavingVault) use. Sits inside
                                        the green ring so the unlock CTA and
                                        the created vault share one surface
                                        treatment. */}
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
                                            borderRadius: 23.5,
                                        }}
                                    />
                                    <Image
                                        source={require("@Cypher/assets/images/fireShield.png")}
                                        style={{
                                            position: 'absolute',
                                            alignSelf: 'center',
                                            top: '50%',
                                            marginTop: -45,
                                            width: 90,
                                            height: 90,
                                            opacity: 0.12,
                                        }}
                                        resizeMode="contain"
                                        pointerEvents="none"
                                    />
                                    <Text h2 style={[styles.createVaultText, shadow.text25]}>
                                        Unlock Hot Vault
                                    </Text>
                                </View>
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>
                )}
        </View>
    );

    const ColdStorageTab = () => (
        <View>
            {/* {coldStorageWallet ?
                <TopUpWithdrawView isVault={true} />
                :
                <View style={{ height: 40 }} />
            } */}
            {(hasColdStorage && coldStorageWallet) ? (
                <SavingVault
                    container={StyleSheet.flatten([styles.savingVault, { marginTop: 14 }])}
                    innerContainer={styles.savingVault}
                    shadowTopBottom={styles.savingVault}
                    shadowBottomBottom={styles.savingVault}
                    bitcoinText={styles.bitcoinText}
                    title={"Cold Vault"}
                    isVault={true}
                    onPress={savingVaultClickHandler}
                    bitcoinValue={coldStorageBalanceVault}
                    inDollars={`$${(Number(coldStorageBalanceWithoutSuffix) * Number(matchedRateBTC || 0)).toFixed(2)}`}
                    isColorable
                />
            ) : (
                // Outlined-only "Unlock Cold Vault" card — blue gradient
                // ring on a dark interior, matching the Hot Vault and
                // Lightning CTAs.
                <TouchableOpacity activeOpacity={0.85} onPress={handleCreateColdVault} style={[styles.createView, { borderRadius: 25, top: 15, width: screenWidth - 40, height: 135, alignSelf: 'center' }]}>
                    <LinearGradient
                        colors={[colors.cold.gradient1, colors.cold.gradient2]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{ borderRadius: 25, padding: 1.5, height: '100%' }}
                    >
                        <View style={{ flex: 1, borderRadius: 23.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                            {/* Light grey → black inner fill, same gradient
                                the created Hot/Cold vault cards use. */}
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
                                    borderRadius: 23.5,
                                }}
                            />
                            <Image
                                source={require("@Cypher/assets/images/coldShield.png")}
                                style={{
                                    position: 'absolute',
                                    alignSelf: 'center',
                                    top: '50%',
                                    marginTop: -45,
                                    width: 90,
                                    height: 90,
                                    opacity: 0.12,
                                }}
                                resizeMode="contain"
                                pointerEvents="none"
                            />
                            <Text h2 style={[styles.createVaultText, shadow.text25]}>
                                Unlock Cold Vault
                            </Text>
                        </View>
                    </LinearGradient>
                </TouchableOpacity>
            )}
        </View>
    );

    const TopUpWithdrawView = ({ isVault, style }: { isVault: boolean; style?: any }) => (
        <View style={styles.bottominner}>
            <GradientView
                onPress={topupClickHandler}
                topShadowStyle={styles.outerShadowStyle}
                bottomShadowStyle={styles.innerShadowStyle}
                style={styles.linearGradientStyle}
                linearGradientStyle={styles.mainShadowStyle}
            >
                <Image
                    style={styles.arrowLeft}
                    resizeMode="contain"
                    source={require("../../../../img/arrow-right.png")}
                />
                <Text bold h3 center style={{ textAlign: 'center' }}>Top-up</Text>
            </GradientView>
            <GradientView
                onPress={withdrawClickHandler}
                topShadowStyle={styles.outerShadowStyle}
                bottomShadowStyle={styles.innerShadowStyle}
                style={styles.linearGradientStyle}
                linearGradientStyle={styles.mainShadowStyle}
            >
                <Text bold h3 center style={{ textAlign: 'center' }}>Withdraw</Text>
                <Image
                    style={styles.arrowRight}
                    resizeMode="contain"
                    source={require("../../../../img/arrow-right.png")}
                />
            </GradientView>
        </View>
    );

    const renderItem = ({ item, index: itemIndex }: any) => {
        return (
            <View style={{ width: screenWidth }}>
                <View style={{ width: screenWidth * 0.905 }}>
                    {!bothVaultsExist && ((wallet && itemIndex == 0) || (coldStorageWallet && itemIndex == 1)) && (isAuth || isStrikeAuth || isArkAuth) &&
                        <TopUpWithdrawView isVault={itemIndex == 1 ? true : false} />
                    }
                    {item.component()}
                </View>
            </View>
        )
    };

    const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const next = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
        if (next === index) return;
        setIndex(next);
        setVaultTab(next === 1 && coldStorageWallet ? true : wallet && false);
    };

    if (__DEV__) console.log('index: ', index, vaultTab)
    return (
        <>
            {bothVaultsExist && (isAuth || isStrikeAuth || isArkAuth) && (
                <TopUpWithdrawView isVault={index === 1} />
            )}
            <FlatList
                ref={flatListRef}
                data={tabs}
                keyExtractor={(item) => item.key}
                renderItem={renderItem}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                snapToInterval={screenWidth}
                decelerationRate="fast"
                disableIntervalMomentum
                initialScrollIndex={index}
                getItemLayout={(_, i) => ({ length: screenWidth, offset: screenWidth * i, index: i })}
                onMomentumScrollEnd={onMomentumScrollEnd}
            />
            <TabBar isVault={index == 1 ? true : false} coldStorageClickHandler={coldStorageClickHandler} hotStorageClickHandler={hotStorageClickHandler} />
        </>
    )
}