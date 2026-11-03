import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, RefreshControl, ScrollView, SectionList, StyleSheet, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import { Icon } from 'react-native-elements';
import SimpleToast from "react-native-simple-toast";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientCard, GradientTab, GradientText } from "@Cypher/components";
import { CoinOS, Information, Line, Time } from "@Cypher/assets/images";
import { colors, ltr, rtl } from "@Cypher/style-guide";
import Items from "./Items";
import Header from "./Header";
import { dispatchNavigate } from "@Cypher/helpers";
import Modal from "react-native-modal";
import { getTransactionHistory } from "@Cypher/api/coinOSApis";
import screenHeight from "@Cypher/style-guide/screenHeight";
import { btc, formatNumber } from "@Cypher/helpers/coinosHelper";
import useAuthStore from "@Cypher/stores/authStore";
import { getInvoices } from "@Cypher/api/strikeAPIs";
import loc from "../../../loc";

interface Transaction {
    date: string;
    sender: string;
    recipient: string;
    amount: number;
    fiatAmount: number;
}

const data = [
    { sats: 100000 },
    { sats: 200000 },
    { sats: 300000 },
    { sats: 400000 },
    { sats: 500000 },
    { sats: 600000 },
    { sats: 700000 },
    { sats: 800000 },
    { sats: 900000 },
    { sats: 1000000 },
    { sats: 2000000 },
    { sats: 3000000 },
    { sats: 4000000 },
    { sats: 5000000 },
    { sats: 6000000 },
    { sats: 7000000 },
    { sats: 8000000 },
    { sats: 9000000 },
    { sats: 10000000 },
];

const reserveData = [
    {
        sats: 100000,
    },
    {
        sats: 200000,
    },
    {
        sats: 300000,
    },
    {
        sats: 400000,
    },
    {
        sats: 500000,
    },
    {
        sats: 600000,
    },
    {
        sats: 700000,
    },
    {
        sats: 800000,
    },
    {
        sats: 900000,
    },
    {
        sats: 1000000,
    },
    {
        sats: 1100000,
    },
    {
        sats: 1200000,
    },
    {
        sats: 1300000,
    },
    {
        sats: 1400000,
    },
    {
        sats: 1500000,
    },
    {
        sats: 1600000,
    },
    {
        sats: 1700000,
    },
    {
        sats: 1800000,
    },
    {
        sats: 1900000,
    },
    {
        sats: 2000000,
    }
];

export default function CheckAccount({ navigation, route }: any) {
    const { withdrawThreshold, reserveAmount, withdrawStrikeThreshold, reserveStrikeAmount, setWithdrawThreshold, setWithdrawStrikeThreshold, setReserveStrikeAmount, setReserveAmount } = useAuthStore();
    const { matchedRate, receiveType } = route.params;
    const [isTab, setIsTab] = useState(true);
    const [value, setValue] = useState(receiveType ? Number(withdrawThreshold) : Number(withdrawStrikeThreshold));
    const [isError, setIsError] = useState(false);
    const [isErrorReserve, setIsErrorReserve] = useState(false);
    const [reserveAmt, setReserveAmt] = useState(receiveType ? Number(reserveAmount) : Number(reserveStrikeAmount));
    const [isLoading, setIsLoading] = useState(false);
    const [payments, setPayments] = useState([]);
    const [totalCount, setTotalCount] = useState(0);
    const [limit] = useState(7);
    const [offset, setOffset] = useState(0);
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const currency = btc(1);

    useEffect(() => {
        if(receiveType)
            loadPayments();
        else
            loadStrikePayments();
    }, [offset, receiveType]);

    useEffect(() => {
        if(receiveType){
            if (withdrawThreshold < data[0].sats || withdrawThreshold > data[data.length - 1].sats) {
                setIsError(true);
            } else {
                setIsError(false);
            }
        } else {
            if (withdrawStrikeThreshold < data[0].sats || withdrawStrikeThreshold > data[data.length - 1].sats) {
                setIsError(true);
            } else {
                setIsError(false);
            }
        }
    }, [withdrawThreshold, withdrawStrikeThreshold, receiveType])

    useEffect(() => {
        if(receiveType) {
            if (reserveAmount < reserveData[0].sats || reserveAmount > reserveData[reserveData.length - 1].sats) {
                setIsErrorReserve(true);
            } else {
                setIsErrorReserve(false);
            }
        } else {
            if (reserveStrikeAmount < reserveData[0].sats || reserveStrikeAmount > reserveData[reserveData.length - 1].sats) {
                setIsErrorReserve(true);
            } else {
                setIsErrorReserve(false);
            }
        }
    }, [reserveAmount, reserveStrikeAmount, receiveType])


    const [isModalVisible, setModalVisible] = useState(false);
    const [isModalRAVisible, setModalRAVisible] = useState(false);

    const toggleModal = () => {
        setModalVisible(!isModalVisible);
    };

    const onPressHandler = (item: any) => {
        dispatchNavigate('Invoice', {
            item: item,
            matchedRate,
            receiveType
        });
    }

    const decreaseClickHandler = () => {
        const currentIndex = data.findIndex(item => item.sats === value);
        if (currentIndex > 0) {
            const newValue = data[currentIndex - 1].sats;
            console.log('index: ', currentIndex - 1);
            console.log('temp: ', newValue);
            setValue(Number(newValue));
            receiveType ? setWithdrawThreshold(newValue) : setWithdrawStrikeThreshold(newValue);
        } else {
            SimpleToast.show(loc.cypherbox.account.checking_account.withdraw_min_toast, SimpleToast.SHORT);
        }
    };

    const increaseClickHandler = () => {
        const currentIndex = data.findIndex(item => item.sats === value);
        if (currentIndex >= 0 && currentIndex < data.length - 1) {
            const newValue = data[currentIndex + 1].sats;
            console.log('index: ', currentIndex + 1);
            console.log('temp: ', newValue);
            setValue(Number(newValue));
            receiveType ? setWithdrawThreshold(newValue) : setWithdrawStrikeThreshold(newValue);
        } else {
            SimpleToast.show(loc.cypherbox.account.checking_account.withdraw_max_toast, SimpleToast.SHORT);
        }
    };

    const decreaseClickHandler_ = () => {
        const currentIndex = reserveData.findIndex(item => item.sats === reserveAmt);
        if (currentIndex > 0) {
            const newValue = reserveData[currentIndex - 1].sats;
            console.log('index: ', currentIndex - 1);
            console.log('temp: ', newValue);
            setReserveAmt(Number(newValue));
            receiveType ? setReserveAmount(newValue) : setReserveStrikeAmount(newValue);
        } else {
            SimpleToast.show(loc.cypherbox.account.checking_account.reserve_min_toast, SimpleToast.SHORT);
        }
    }

    const increaseClickHandler_ = () => {
        const currentIndex = reserveData.findIndex(item => item.sats === reserveAmt);
        if (currentIndex >= 0 && currentIndex < reserveData.length - 1) {
            const newValue = reserveData[currentIndex + 1].sats;
            console.log('index: ', currentIndex + 1);
            console.log('temp: ', newValue);
            setReserveAmt(Number(newValue));
            receiveType ? setReserveAmount(newValue) : setReserveStrikeAmount(newValue);
        } else {
            SimpleToast.show(loc.cypherbox.account.checking_account.reserve_max_toast, SimpleToast.SHORT);
        }
    }

    const selectClickHandler = (val: number) => {
        receiveType ? setWithdrawThreshold(val) : setWithdrawStrikeThreshold(val);
        setValue(Number(val));
        setModalVisible(false);
    }

    const selectRAClickHandler = (val: number) => {
        receiveType ? setReserveAmount(val) : setReserveStrikeAmount(val);
        setReserveAmt(Number(val));
        setModalRAVisible(false);
    }

    const customizeClickHandler = (index: number) => {
        // WithdrawThreshold   
        dispatchNavigate('WithdrawThreshold', {
            title: index == 0 ? loc.cypherbox.account.checking_account.withdraw_threshold : loc.cypherbox.account.checking_account.reserve_amount,
            titleBtn: index == 0 ? loc.cypherbox.account.checking_account.set_threshold : loc.cypherbox.account.checking_account.set_reserve_amount,
            onSelect: onSelect,
            index,
            matchedRate
        });
    }

    const onSelect = (value: number, index: number) => {
        if(receiveType){
            if (index == 0) {
                if (withdrawThreshold < data[0].sats || withdrawThreshold > data[data.length - 1].sats) {
                    setIsError(true);
                } else {
                    setIsError(false);
                }
                setValue(Number(value));
                setWithdrawThreshold(value)
            } else {
                if (reserveAmount < reserveData[0].sats || reserveAmount > reserveData[reserveData.length - 1].sats) {
                    setIsErrorReserve(true);
                } else {
                    setIsErrorReserve(false);
                }
                setReserveAmt(Number(value));
                receiveType ? setReserveAmount(value) : setReserveStrikeAmount(value)
            }
        } else {
            if (index == 0) {
                if (withdrawStrikeThreshold < data[0].sats || withdrawStrikeThreshold > data[data.length - 1].sats) {
                    setIsError(true);
                } else {
                    setIsError(false);
                }
                setValue(Number(value));
                setWithdrawStrikeThreshold(value)
            } else {
                if (reserveStrikeAmount < reserveData[0].sats || reserveStrikeAmount > reserveData[reserveData.length - 1].sats) {
                    setIsErrorReserve(true);
                } else {
                    setIsErrorReserve(false);
                }
                setReserveAmt(Number(value));
                setReserveStrikeAmount(value)
            }
        }
    }


    const loadPayments = async (append = true) => {
        offset == 0 && setIsLoading(true);
        try {
            const paymentList = await getTransactionHistory(offset, limit);
            if (append && offset > 0) {
                setPayments((prevPayments) => [...prevPayments, ...paymentList.payments]);
            } else {
                setPayments(paymentList.payments);
            }
            setTotalCount(paymentList.count);
        } catch (error) {
            console.error('Error loading payments:', error);
        } finally {
            setIsLoading(false);
            setIsFetchingMore(false);
            setIsRefreshing(false);
        }
    };

    const loadStrikePayments = async () => {
        setIsLoading(true);
        try {
            const paymentList = await getInvoices();
            let payments = paymentList.items;
            payments = payments.filter((item: any) => item.state !== "UNPAID");
            setPayments(payments);
        } catch (error) {
            console.error('Error loading payments:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLoadMore = () => {
        if (!isLoading && !isFetchingMore && payments.length < totalCount) {
            setIsFetchingMore(true);
            setOffset((prevOffset) => prevOffset + limit);
        }
    };

    const handleRefresh = () => {
        setIsRefreshing(true);
        if (offset == 0) {
            loadPayments(false)
        } else {
            setOffset(0);
        }
    };

    const groupedPayments = payments.reduce((acc: any, payment: any) => {
        const date = new Date(payment?.created);
        const dateString = date.toDateString();
        if (!acc[dateString]) {
            acc[dateString] = [];
        }
        acc[dateString].push(payment);
        return acc;
    }, {});

    const sections = Object.entries(groupedPayments).map(([date, data]) => ({
        title: date,
        data: data,
    }));

    return (
        <ScreenLayout disableScroll showToolbar isBackButton>
            <View style={styles.container}>
                <View style={[styles.innerView, { borderBottomColor: isTab ? '#333333' : colors.primary }]}>
                    <Text subHeader bold>{loc.cypherbox.account.common.lightning_account}</Text>
                    <GradientTab isTextAfter firstTabImg={Time} secondTabImg={
                        <View style={[styles.lineView, !isTab && { borderColor: colors.white }]}>
                            <Image source={Line} style={[styles.line, !isTab && { tintColor: colors.white }]} resizeMode="contain" />
                        </View>
                    } tab1={loc.cypherbox.account.checking_account.history} tab2={loc.cypherbox.account.checking_account.threshold} isSats={isTab} setIsSats={setIsTab}
                        imageStyle={{ width: 30, height: 26 }}
                        color_={['#454545', '#3636368C']} />
                </View>
                {isTab ?
                    <View style={styles.container}>
                        {isLoading && !isRefreshing ? (
                            <View style={styles.container}>
                                <ActivityIndicator size={100} color={colors.white} />
                            </View>
                        ) : (
                            <View style={styles.container}>
                                <SectionList
                                    sections={sections}
                                    onEndReached={handleLoadMore}
                                    onEndReachedThreshold={0.1}
                                    ListFooterComponent={() =>
                                        isFetchingMore ? ( // Show loader at the end of the list when loading more
                                            <ActivityIndicator style={{ marginTop: 10, marginBottom: 20 }} color={colors.white} />
                                        ) : null
                                    }
                                    ListEmptyComponent={() => (
                                        <View style={{ height: screenHeight / 2.2, justifyContent: 'center', alignItems: 'center', marginTop: 30 }}>
                                            <Text white h3 bold>{loc.cypherbox.account.checking_account.no_transactions}</Text>
                                        </View>
                                    )}
                                    refreshControl={
                                        receiveType ? (
                                            <RefreshControl
                                                refreshing={isRefreshing}
                                                onRefresh={handleRefresh}
                                                tintColor="white"
                                            />
                                        ) : null
                                    }
                                    keyExtractor={(item, index) => index.toString()}
                                    renderItem={({ item }) => <Items matchedRate={matchedRate} item={item} receiveType={receiveType} onPressHandler={onPressHandler} />}
                                    renderSectionHeader={({ section: { title } }) => <Header title={title} />}
                                // invertStickyHeaders
                                />
                            </View>
                        )}
                        <View style={styles.bottomView}>
                            <Image source={receiveType ? CoinOS : require("../../../img/Strike.png")} />
                        </View>
                    </View>
                    :
                    <View style={styles.main}>
                        <Text h2 semibold>{loc.cypherbox.account.checking_account.withdraw_threshold}</Text>
                        <Text>
                            {loc.cypherbox.account.checking_account.threshold_desc}
                        </Text>
                        <Text>
                            {loc.cypherbox.account.checking_account.threshold_fees_note}
                            {/* <Text>fsds</Text> */}
                        </Text>
                        {/* <GradientText style={{ fontSize: 14 }}>Learn more</GradientText> */}
                        <View style={styles.priceView}>
                            <TouchableOpacity onPress={() => setModalVisible(true)} activeOpacity={0.7}>
                                <GradientCard disabled
                                    colors_={isError ? [colors.yellow2, colors.yellow2] : ['#FFFFFF', '#B6B6B6']}
                                    style={styles.linearGradientStroke} linearStyle={styles.linearGradient}>
                                    <View style={styles.background}>
                                        <Text bold style={{ fontSize: 18 }}>{formatNumber(value)}</Text>
                                        <View style={styles.straightLine} />
                                        <View>
                                            <Icon name="angle-up" type="font-awesome" color="#FFFFFF" />
                                            <Icon name="angle-down" type="font-awesome" color="#FFFFFF" />
                                        </View>
                                    </View>
                                </GradientCard>
                            </TouchableOpacity>
                            <Text style={styles.text}>Sats</Text>
                        </View>
                        <Modal isVisible={isModalVisible}>
                            <View>
                                <GradientCard disabled
                                    style={styles.modal} linearStyle={styles.linearGradient2}>
                                    <ScrollView style={styles.background2}>
                                        {data.map((item, index) => {
                                            return (
                                                <TouchableOpacity style={[styles.row, index % 2 == 0 && { backgroundColor: colors.primary }]}
                                                    onPress={() => selectClickHandler(item?.sats)}>
                                                    <Text bold style={[{ fontSize: 18 }, rtl.ltrText]}>{formatNumber(item?.sats) + " sats"}</Text>
                                                    <Text style={[{ fontSize: 18, marginStart: 30 }, rtl.ltrText]}>{ltr(`~$${(item?.sats * matchedRate * currency).toFixed(2)}`)}</Text>
                                                </TouchableOpacity>
                                            )
                                        })}
                                    </ScrollView>
                                </GradientCard>
                            </View>
                        </Modal>
                        <Text center style={[styles.usd, rtl.ltrText]}>${(value * matchedRate * currency).toFixed(2)}</Text>
                        <TouchableOpacity onPress={() => customizeClickHandler(0)}>
                            <GradientText style={styles.gradientText}>{loc.cypherbox.account.checking_account.customize}</GradientText>
                        </TouchableOpacity>
                        {/* <Text h3 center>Estimated withdraw fee: 0.2%</Text> */}
                        <View style={styles.reserve}>
                            <Text h2 semibold>{loc.cypherbox.account.checking_account.reserve_amount}</Text>
                            {/* <Image source={Information} style={styles.image} /> */}
                        </View>
                        <View style={styles.priceView}>
                            <TouchableOpacity onPress={() => setModalRAVisible(true)} activeOpacity={0.7}>
                                <GradientCard disabled
                                    colors_={isErrorReserve ? [colors.yellow2, colors.yellow2] : ['#FFFFFF', '#B6B6B6']}
                                    style={StyleSheet.flatten([styles.linearGradientStroke, { height: 60 }])} linearStyle={StyleSheet.flatten([styles.linearGradient, { height: 60 }])}>
                                    <View style={styles.background}>
                                        <Text bold style={{ fontSize: 18 }}>{formatNumber(reserveAmt)}</Text>
                                        <View style={styles.straightLine} />
                                        <View>
                                            <Icon name="angle-up" type="font-awesome" color="#FFFFFF" />
                                            <Icon name="angle-down" type="font-awesome" color="#FFFFFF" />
                                        </View>
                                    </View>
                                </GradientCard>
                            </TouchableOpacity>
                            <Text style={styles.text}>Sats</Text>
                        </View>
                        <Text center style={[styles.usd, rtl.ltrText]}>${(reserveAmt * matchedRate * currency).toFixed(2)}</Text>
                        <TouchableOpacity onPress={() => customizeClickHandler(1)}>
                            <GradientText style={styles.gradientText}>{loc.cypherbox.account.checking_account.customize}</GradientText>
                        </TouchableOpacity>
                        <Modal isVisible={isModalRAVisible}>
                            <View>
                                <GradientCard disabled
                                    style={styles.modal} linearStyle={styles.linearGradient2}>
                                    <ScrollView style={styles.background2}>
                                        {reserveData.map((item, index) => {
                                            return (
                                                <TouchableOpacity style={[styles.row, index % 2 == 0 && { backgroundColor: colors.primary }]}
                                                    onPress={() => selectRAClickHandler(item?.sats)}>
                                                    <Text bold style={[{ fontSize: 18 }, rtl.ltrText]}>{formatNumber(item?.sats) + " sats"}</Text>
                                                    <Text style={[{ fontSize: 18, marginStart: 30 }, rtl.ltrText]}>{ltr(`~$${(item?.sats * matchedRate * currency).toFixed(2)}`)}</Text>
                                                </TouchableOpacity>
                                            )
                                        })}
                                    </ScrollView>
                                </GradientCard>
                            </View>
                        </Modal>
                    </View>
                }
            </View>
        </ScreenLayout>
    )
}