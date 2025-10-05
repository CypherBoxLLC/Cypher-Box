import { createInvoice } from "@Cypher/api/coinOSApis";
import { Text } from "@Cypher/component-library";
import { GradientCardWithShadow, GradientView, SavingVault } from "@Cypher/components";
import { dispatchNavigate } from "@Cypher/helpers";
import { btc, SATS } from "@Cypher/helpers/coinosHelper";
import useAuthStore from "@Cypher/stores/authStore";
import { colors, shadow } from "@Cypher/style-guide";
import screenWidth from "@Cypher/style-guide/screenWidth";
import React, { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, TouchableOpacity, View } from "react-native";
import SimpleToast from "react-native-simple-toast";
import Carousel from "react-native-snap-carousel";
import styles from "../styles";
import TabBar from "../TabBar";
import { createInvoice as createInvoiceStrike } from "@Cypher/api/strikeAPIs";

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
    currencyStrike: any;
    matchedRateStrike: any;
}

export default function BottomBar({
    balance,
    wallet,
    refWithdrawRBSheet,
    currency,
    matchedRate,
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
    console.log("🚀 ~ hasSavingVault:", hasSavingVault)
    const { isAuth, isStrikeAuth, strikeUser, withdrawStrikeThreshold, withdrawThreshold, vaultTab, setVaultTab } = useAuthStore();

    const carouselRef = useRef<Carousel<any>>(null);

    const [index, setIndex] = useState(vaultTab ? 1 : 0);

    // useEffect(() => {
    //     if(vaultTab && (wallet || coldStorageWallet)) {
    //         carouselRef.current?.snapToItem(1, true);
    //     } else if(!vaultTab && (wallet || coldStorageWallet)) {
    //         carouselRef.current?.snapToItem(0, true);
    //     }
    // }, [vaultTab]);

    const coldStorageClickHandler = () => {
        setVaultTab(true);
        carouselRef.current?.snapToItem(1, true);
    };
    const hotStorageClickHandler = () => {
        setVaultTab(false);
        carouselRef.current?.snapToItem(0, true);
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

    const topupClickHandler = async () => {
        // dispatchNavigate('PurchaseVault', {
        //   data: {}
        // });
        if (!isAuth && !isStrikeAuth) {
            SimpleToast.show('You need to be logged in to wallet to top up', SimpleToast.SHORT);
            return
        }

        // if (!isAuth) {
        //     SimpleToast.show('You need to be logged in to Coinos.io to top up', SimpleToast.SHORT);
        //     return
        // }
        // if (vaultTab && !coldStorageWallet) {
        //     SimpleToast.show('You need to have a cold storage wallet to top up', SimpleToast.SHORT);
        //     return
        // }
        try {
            let response, responseStrike;
            if(isAuth){
                response = await createInvoice({
                    type: 'bitcoin',
                });
            }
            if(isStrikeAuth) {
                responseStrike = await createInvoiceStrike({
                    onchain: {
                    },
                    targetCurrency: strikeUser?.[1]?.currency || "USD"
                });
            }

            dispatchNavigate('HotStorageVault', { wallet: vaultTab && coldStorageWallet ? coldStorageWallet : wallet && wallet, matchedRate, to: isAuth ? response?.hash : null, toStrike: isStrikeAuth ? responseStrike.onchain?.address : null });
        } catch (error) {
            console.error('Error generating bitcoin address topupClickHandler:', error);
        } finally {
            // setIsLoading(false);
        }
    };

    const withdrawClickHandler = () => {
        if (!isAuth && !isStrikeAuth) {
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

        if ((wallet && coldStorageWallet) || (isAuth && isStrikeAuth)) {
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
            console.log('amount: ', amount)
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
              console.log('amount: ', amount)
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
        dispatchNavigate('HotStorageVault', { wallet: vaultTab ? coldStorageWallet : wallet, matchedRate });
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
                    inDollars={`$${(Number(balanceWithoutSuffix || 0) * Number(matchedRate || 0)).toFixed(2)}`}
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
                        <GradientCardWithShadow
                            style={styles.createView}
                            onPress={handleCreateVault}
                            colors_={[colors.green_.greenGradient1, colors.green_.greenGradient2]}
                        >
                            <Text h2 style={[styles.createVaultText, shadow.text25]}>
                                Create Hot Vault
                            </Text>
                        </GradientCardWithShadow>
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
                    container={StyleSheet.flatten([styles.savingVault, { marginTop: 10 }])}
                    innerContainer={styles.savingVault}
                    shadowTopBottom={styles.savingVault}
                    shadowBottomBottom={styles.savingVault}
                    bitcoinText={styles.bitcoinText}
                    title={"Cold Storage"}
                    isVault={true}
                    onPress={savingVaultClickHandler}
                    bitcoinValue={coldStorageBalanceVault}
                    inDollars={`$${(Number(coldStorageBalanceWithoutSuffix) * Number(matchedRate)).toFixed(2)}`}
                    isColorable
                />
            ) : (
                <GradientCardWithShadow
                    style={StyleSheet.flatten([styles.createVaultContainer, { top: 15 }])}
                    onPress={handleCreateColdVault}
                    colors_={[colors.cold.gradient1, colors.cold.gradient2]}
                >
                    <Text h2 style={[styles.createVaultText, shadow.text25]}>
                        Create Cold Vault
                    </Text>
                </GradientCardWithShadow>
            )}
        </View>
    );

    const TopUpWithdrawView = ({ isVault }: any) => (
        <View style={styles.bottominner}>
            <GradientView
                onPress={topupClickHandler}
                topShadowStyle={[styles.outerShadowStyle, isVault && { shadowColor: colors.blueText }]}
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
                topShadowStyle={[styles.outerShadowStyle, isVault && { shadowColor: colors.blueText }]}
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

    const renderItem = ({ item }: any) => {
        return (
            <View style={{ width: screenWidth * 0.905 }}>
                {item.component()}
            </View>
        )
    };

    console.log('index: ', index, vaultTab)
    return (
        <>
            {((hasSavingVault && wallet) || coldStorageWallet ) && (isAuth || isStrikeAuth) &&
                <TopUpWithdrawView isVault={index == 1 ? true : false} />
            }
            <Carousel
                data={tabs}
                ref={carouselRef}
                renderItem={renderItem}
                firstItem={index}
                vertical={false}
                sliderWidth={screenWidth}
                itemWidth={screenWidth}
                onSnapToItem={(index) => {
                    console.log('onSnappppp')
                    setIndex(index)
                    setVaultTab(index === 1 && coldStorageWallet ? true : wallet && false);
                }}
            />
            <TabBar isVault={index == 1 ? true : false} coldStorageClickHandler={coldStorageClickHandler} hotStorageClickHandler={hotStorageClickHandler} />
        </>
    )
}