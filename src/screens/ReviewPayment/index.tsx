import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import SimpleToast from "react-native-simple-toast";
import { Icon } from "react-native-elements";
import ReactNativeModal from "react-native-modal";
import styles from "./styles";
import { Input, LoadingSpinner, ScreenLayout, Text } from "@Cypher/component-library";
import { Check, CoinOSSmall, Edit } from "@Cypher/assets/images";
import { GradientButton, GradientCard, GradientCardWithShadow, GradientText, ImageText, SwipeButton } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";
import { dispatchNavigate, isIOS } from "@Cypher/helpers";
import LinearGradient from "react-native-linear-gradient";
import TextView from "./TextView";
import TextViewV2 from "../Invoice/TextView"
import useAuthStore from "@Cypher/stores/authStore";
import { bitcoinSendFee, getCurrencyRates, getMe, sendBitcoinPayment, sendCoinsViaUsername, sendLightningPayment } from "@Cypher/api/coinOSApis";
import { btc, formatNumber, getStrikeCurrency, matchKeyAndValue, SATS } from "@Cypher/helpers/coinosHelper";
import { FeeSelection } from "./FeeSelection/FeeSelection";
import { startsWithLn } from "../Send";
import { calculateBalancePercentage, calculatePercentage } from "../HomeScreen";
import { createFiatExchangeQuote, executeFiatExchangeQuote, getOnChainTiers, getPaymentQoute, getPaymentQouteByLightening, getPaymentQouteByLighteningURL, getPaymentQouteByOnChain } from "@Cypher/api/strikeAPIs";
import { mostRecentFetchedRate, fetchedRate } from "../../../blue_modules/currency";

interface Props {
    navigation: any;
    route: any;
}
type Fee = keyof Fees;

type Fees = {
    fastestFee: number;
    halfHourFee: number;
    hourFee: number;
    economyFee: number;
};

export const shortenAddress = (address: string) => {
    // Take the first 6 characters
    const start = address.substring(0, 6);
    // Take the last 6 characters
    const end = address.substring(address.length - 6);
    // Combine with three dots in the middle
    return `${start}...${end}`;
};

function usdToSats(usdAmount: number, exchangeRate: number): string {
  if (!exchangeRate || exchangeRate === 0) return '0';
  const btcAmount = usdAmount / exchangeRate;
  const satoshiAmount = Number(btcAmount * 100000000).toFixed(2);
  return isNaN(Number(satoshiAmount)) ? '0' : satoshiAmount;
}

export default function ReviewPayment({ navigation, route }: Props) {
    const { value, converted, isSats, isMaxUSDSelected = false, to, type, recommendedFee, currency, isWithdrawal = false, wallet = null, description, receiveType, vaultTab, total } = route?.params;
    const { withdrawThreshold, reserveAmount, strikeUser } = useAuthStore();
    const [note, setNote] = useState(description || '');
    const [balance, setBalance] = useState(0);
    const [convertedRate, setConvertedRate] = useState(0);
    const [matchedRate, setMatchedRate] = useState(0);
    const [isStartLoading, setIsStartLoading] = useState(false)
    const [selectedFee, setSelectedFee] = useState<number | null>(null);
    const [selectedFeeName, setSelectedFeeName] = useState<string>("Select Fee");
    const [estimatedFee, setEstimatedFee] = useState<number>(0);
    const [networkFee, setNetworkFee] = useState<number>(0);
    const [bamskiiFee, setBamskiiFee] = useState<number>(0);
    const [feeLoading, setFeeLoading] = useState<boolean>(false);
    const [isSendLoading, setIsSendLoading] = useState<boolean>(false);
    const [isModalVisible, setModalVisible] = useState(false);
    const [isEditAmount, setIsEditAmount] = useState(false);
    const [isCheck, setIsCheck] = useState(false);
    const [strikeFees, setStrikeFees] = useState<any[]>([]);
    const [selectedStrikeFee, setSelectedStrikeFee] = useState<any>(null);
    const [paymentQuoteData, setPaymentQuoteData] = useState<any>(null);

    const swipeButtonRef = useRef(null);
    const feeNames: Record<Fee, string> = {
        fastestFee: "Fastest",
        halfHourFee: "Fast",
        hourFee: "Medium",
        economyFee: "Slow",
    };

    useEffect(() => {
        if(receiveType)
            handleUser();
        else {
            handleRates();
            handleStrikeUser();
        }
    }, [receiveType]);

    useEffect(() => {
        if(to && to.startsWith('bc') && receiveType == false){
            handleStrikeOnChainFee();
        }
    }, [to, receiveType, isWithdrawal])

    useEffect(() => {
        if(to && !receiveType && !isWithdrawal){
            handlePaymentQuote();
        }
    }, [to, isSats, receiveType, isWithdrawal])

    useEffect(() => {
        if(to && to.startsWith('bc') && selectedStrikeFee && !receiveType){
            handleStrikeBTCFee(selectedStrikeFee?.id);
        }
    }, [to, selectedStrikeFee, receiveType])

    useEffect(() => {
        if(type == 'SELL' || type == 'BUY'){
            handleFiatPayment();
        }
    }, [type])

    const exchangeRate = async () => {
        const rates = await mostRecentFetchedRate();
        return rates
    }

    const handleStrikeUser = () => {
        setBalance(Math.round(Number(strikeUser?.[0]?.available || 0) * SATS))
    }

    const handleRates = async () => {
        // Use Strike account currency if available, otherwise default rate
        if (currency && currency !== 'USD') {
            const untypedFiatUnit = require('../../../models/fiatUnits.json');
            const fiatUnit = untypedFiatUnit?.[currency];
            if (fiatUnit) {
                const rates = await fetchedRate(fiatUnit);
                if (rates && rates?.Rate) {
                    const numericAmount = Number(rates.Rate.replace(/[^0-9\.]/g, ''));
                    console.log('Strike rate for', currency, ':', numericAmount);
                    setMatchedRate(numericAmount);
                }
                return;
            }
        }
        const rates = await exchangeRate();
        if (rates && rates?.Rate) {
          const numericAmount = Number(rates.Rate.replace(/[^0-9\.]/g, ''));
          setMatchedRate(numericAmount);
        }
    }

    const handleFiatPayment = async () => {
        const amount =  isSats ? converted : value;
        const sats = isSats ? value : converted;
        console.log('amount: ', amount, converted, currency)
        const fiatAmount = isSats ? converted : value;
        const btcAmount = (isSats ? value : converted) / SATS;
        let payload = {
            sell: type == "BUY" ? (currency || "USD") : "BTC",
            buy: type == "BUY" ? "BTC" : (currency || "USD"),
            amount: type === 'BUY' ? {
                amount: Number(fiatAmount),
                currency: currency || "USD",
                feePolicy: "INCLUSIVE"
            } : {
                amount: btcAmount,
                currency: "BTC",
                feePolicy: "EXCLUSIVE"
            }
        }
        const response = await createFiatExchangeQuote(payload, false);
        console.log('response createFiatExchangeQuote: ', response, response?.data?.validationErrors, payload)
        if(response?.data?.status === 401){
            dispatchNavigate('HomeScreen')
            return;
        }
        if(response?.source){
            setPaymentQuoteData(response)
        } else if (response?.data?.message){
            SimpleToast.show(response?.data?.message, SimpleToast.SHORT)
        }
    }

    const handleStrikeBTCFee = async (onChainTierId: string) => {
        const amount =  receiveType ? isSats ? value : converted : isSats ? converted : value;
        console.log('amount: ', amount, currency, strikeFees)
        const BTCAmount = Number(amount) / Number(matchedRate || 1)
        const currentOnChainTier = strikeFees.find((item: any) => item.id === onChainTierId)
        try {
            let payload = {
                btcAddress: to,
                sourceCurrency: 'BTC',
                amount: {
                    amount: isEditAmount && !isMaxUSDSelected ? BTCAmount : BTCAmount - Number(currentOnChainTier?.estimatedFee?.amount),
                    currency: 'BTC',
                    feePolicy: "INCLUSIVE"
                },
                description: note,
                onchainTierId: onChainTierId
            }
            console.log('payload handleStrikeBTCFee: ', payload)
            let url = 'onchain'
            const response = await getPaymentQoute(url, payload);
            console.log('response handleStrikeBTCFee: ', response, response?.data?.validationErrors)
            if(response?.amount){
                setPaymentQuoteData(response)
            } else if (response?.data?.message){
                SimpleToast.show(response?.data?.message, SimpleToast.SHORT)
            }
        } catch (error) {
            console.log('error: ', error)
        }
    }

    console.log('paymentQuoteData: ', paymentQuoteData, matchedRate)

    const handlePaymentQuote = async () => {
        setFeeLoading(true);
        try {
            let payload = {}, url = '';
            const amount =  receiveType ? isSats ? value : converted : isSats ? converted : value;
            if (startsWithLn(to)) {
                payload = {
                    lnInvoice: to,
                    sourceCurrency: 'BTC',
                    amount: {
                        amount: Number(amount),
                        currency: currency || "USD",
                        feePolicy: "INCLUSIVE"
                    },
                    description: note
                }
                url = 'lightning'
            } else if (to.includes("@")) { //username
                payload = {
                    lnAddressOrUrl: to,
                    sourceCurrency: 'BTC',
                    amount: {
                        amount: String(amount),
                        currency: currency || "USD"
                    },
                    // description: note
                }
                url = 'lightning/lnurl'
            } else {
                return;
            }
            console.log('payloadpayload: ', payload)
            const response = await getPaymentQoute(url, payload);
            console.warn('response handlePaymentQuote: ', response?.data?.validationErrors)
            if(response?.amount){
                console.log('setPaymentQuoteData paymentQuoteData?.paymentQuoteId: ', response?.paymentQuoteId)
                setPaymentQuoteData(response)
            } else if (response?.data?.message){
                SimpleToast.show(response?.data?.message, SimpleToast.SHORT);
                setTimeout(() => {
                    navigation.goBack();
                }, 2000)
                return
            }
            console.log('response getPaymentQoute: ', response)
        } catch (error) {
            console.error('Error handlePaymentQuote:', error);
            SimpleToast.show('Failed to Send. Please try again.', SimpleToast.SHORT);
        } finally {
            setFeeLoading(false);
        }
    }

    const handleStrikeOnChainFee = async () => {
        const amount =  receiveType ? isSats ? value : converted : isSats ? converted : value;
        const btcAmount = isSats ? Number(value) / SATS : Number(value);
        try {
            const payload = {
                btcAddress: to,
                sourceCurrency: 'BTC',
                amount: {
                    amount: btcAmount,
                    currency: "BTC",
                    feePolicy: "EXCLUSIVE"
                },
                description: note,
                // onchainTierId: 'tier_fast' + Math.floor(Math.random() * 100)
            }
            console.log('payload: ', payload)

            const fees = await getOnChainTiers(payload);
            console.log('strikeFees, ', fees)
            if(fees?.data?.code === "AMOUNT_TOO_LOW"){
                SimpleToast.show(fees?.data?.message, SimpleToast.SHORT);
                setTimeout(() => {
                    navigation.goBack();
                }, 2000)
                return
            }
            const labeledTiers = fees.map((tier: any) => {
                switch (tier.id) {
                    case 'tier_fast':
                        tier.label = 'Fast';
                        break;
                    case 'tier_standard':
                        tier.label = 'Standard';
                        break;
                    case 'tier_free':
                        tier.label = 'Free';
                        break;
                    default:
                        tier.label = 'Unknown';
                }
                return tier;
            });

            // console.log('labeledTiers: ', labeledTiers)
            setStrikeFees(labeledTiers);
        } catch (error) {
            console.log('error: ', error);
        }
    }

    const handleUser = async () => {
        setIsStartLoading(true);
        try {
            const response = await getMe();
            console.log('response getMe: ', response);
            const responsetest = await getCurrencyRates();
            const currency = btc(1);
            const matched = matchKeyAndValue(responsetest, 'USD')
            setMatchedRate(matched || 0)
            console.log('converter: ', (matched || 0) * currency * response.balance);
            setConvertedRate((matched || 0) * currency * response.balance)
            setCurrency("USD")
            console.log('currency: ', currency)
            if (response?.balance) {
                setBalance(response?.balance || 0);
            }
        } catch (error) {
            console.log('error: ', error);
        } finally {
            setIsStartLoading(false)
        }
    }

    const handleFeeEstimate = async (fee: string) => {
        setFeeLoading(true);
        const amount = isSats ? value : converted;
        if (to.startsWith('bc')) { //bitcoin onchain
            const feeForBamskki = (0.1 / 100) * Number(amount);
            // const remainingAmount = Number(amount) - feeForBamskki;
            const remainingAmount = Number(amount);
            console.log('feeForBamskki: ', feeForBamskki)
            console.log('remainingAmount: ', remainingAmount)
            if (remainingAmount <= 0) {
                SimpleToast.show("You don't have enough balance", SimpleToast.SHORT);
                setFeeLoading(false);
                return;
            }

            console.log('recommendedFee[fee]: ', recommendedFee[fee])
            try {
                const estimatedFee = await bitcoinSendFee(remainingAmount, to, recommendedFee[fee] < 9 ? 10 : Number(recommendedFee[fee]));
                let jsonObject = null;
                if (estimatedFee?.startsWith('{')) { // as estimatedFee is a string so this condition is helpful
                    jsonObject = JSON.parse(estimatedFee);
                    console.log(jsonObject, jsonObject.fee);
                    setEstimatedFee(Number(jsonObject.fee))
                    jsonObject?.ourfee && setNetworkFee(Number(jsonObject?.ourfee))
                    setBamskiiFee(Number(feeForBamskki))
                    setSelectedFee(recommendedFee[fee] < 9 ? 10 : Number(recommendedFee[fee]));
                    setSelectedFeeName(feeNames[fee as Fee])
                } else {
                    SimpleToast.show(estimatedFee, SimpleToast.SHORT);
                    return;
                }
                console.log('jsonObject: ', jsonObject);
            } catch (error) {
                console.error('Error Send to bitcoin:', error);
                SimpleToast.show(error?.message ? error?.message : 'Failed to estimate bitcoin fee. Please try again.', SimpleToast.SHORT);
            } finally {
                setModalVisible(false)
                setFeeLoading(false);
            }
        } else { //liquid address
            if (amount == '') {
                SimpleToast.show('Please enter an amount', SimpleToast.SHORT);
                setFeeLoading(false);
                return;
            }
            const feeForBamskki = (0.1 / 100) * Number(amount);
            const remainingAmount = Number(amount) - feeForBamskki;
            console.log('feeForBamskki: ', feeForBamskki)
            console.log('remainingAmount: ', remainingAmount)
            if (remainingAmount <= 0) {
                SimpleToast.show("You don't have enough balance", SimpleToast.SHORT);
                setFeeLoading(false);
                return;
            }

            try {
                const estimatedFee = await bitcoinSendFee(remainingAmount, to, recommendedFee[fee] < 9 ? 10 : Number(recommendedFee[fee]));
                let jsonObject = null;
                if (estimatedFee?.startsWith('{')) { // as estimatedFee is a string so this condition is helpful
                    jsonObject = JSON.parse(estimatedFee);
                    console.log("jsonObject: ", jsonObject, jsonObject.fee);
                    setEstimatedFee(Number(jsonObject.fee))
                    jsonObject?.ourfee && setNetworkFee(Number(jsonObject?.ourfee))
                    setBamskiiFee(Number(feeForBamskki))
                    setSelectedFee(recommendedFee[fee] < 9 ? 10 : Number(recommendedFee[fee]));
                    setSelectedFeeName(feeNames[fee as Fee])
                } else {
                    SimpleToast.show(estimatedFee, SimpleToast.SHORT);
                    return;
                }
            } catch (error) {
                console.error('Error Send to liquid:', error);
                SimpleToast.show(error?.message ? error?.message : 'Failed to estimate liquid fee. Please try again.', SimpleToast.SHORT);
            } finally {
                setModalVisible(false)
                setFeeLoading(false);
            }
        }
    };

    const handleToggle = (val: any) => {
        console.log("🚀 ~ handleToggle ~ value:", val)
        if (val) {
            handleSendSats();
            // if(type == 'lightening' || type == 'username')
            //     dispatchNavigate('Transaction', {matchedRate, type, value, converted, isSats, to});
            // else 
            //     dispatchNavigate('TransactionBroadCast', {matchedRate, type, value, converted, isSats, to});        
        }
    }

    const handleFeeSelect = (fee: string) => {
        console.log('fee: ', fee)
        handleFeeEstimate(fee)
        setModalVisible(false)
    };

    const handleStrikeFeeSelect = (fee: any) => {
        console.log('fee: ', fee)
        setSelectedStrikeFee(fee);
        setModalVisible(false)
    };

    const handleSendSats = async () => {
        setIsSendLoading(true);
        console.log('value: ', value, converted)
        const amount =  receiveType ? isSats ? value : converted : isSats ? converted : value;
        if(type == "SELL" || type == "BUY"){
            try {
                console.log('paymentQuoteData: ', paymentQuoteData)
                const response = await executeFiatExchangeQuote(paymentQuoteData?.id);
                console.log('response executeFiatExchangeQuote: ', response)
                if(response?.status === 202){
                    dispatchNavigate('Transaction', { matchedRate, currency, type, value, converted, receiveType, isSats, to, item: paymentQuoteData });
                } else {
                    SimpleToast.show(response?.data?.message ? response?.data?.message + " Please Try again" : 'Failed to execute payment. Please try again.', SimpleToast.SHORT)
                    handleFiatPayment()
                }
            } catch (error) {
                console.error('Error execute payment Strike:', error);
            } finally {
                setIsSendLoading(false);
            }
        } else if (to == '') {
            SimpleToast.show('Please enter an address or username', SimpleToast.SHORT);
            setIsSendLoading(false);
            return;
        } else if (startsWithLn(to)) { //lightening invoice
            if(receiveType){
                try {
                    const response = await sendLightningPayment(to, note, amount);
                    console.log('response sendLightningPayment: ', response)
                    if (response?.startsWith('{')) {
                        const jsonLNResponse = JSON.parse(response);
                        dispatchNavigate('Transaction', { matchedRate, currency, type, value, converted, isSats, to, item: jsonLNResponse });
                    } else {
                        SimpleToast.show(response, SimpleToast.SHORT)
                    }

                } catch (error) {
                    console.error('Error handleSendSats:', error);
                    SimpleToast.show('Failed to Send Lightening. Please try again.', SimpleToast.SHORT);
                } finally {
                    setIsSendLoading(false);
                }
            } else {
                try {
                    const payload = {
                        lnInvoice: to,
                        sourceCurrency: 'BTC',
                        amount: {
                            amount: Number(amount),
                            currency: currency || "USD",
                            feePolicy: "INCLUSIVE"
                        },
                        description: note
                    }
                    const response = await getPaymentQouteByLighteningURL(payload, paymentQuoteData?.paymentQuoteId);
                    if(response?.amount){
                        console.log('responserresponse: ', response)
                        dispatchNavigate('Transaction', { matchedRate, currency, type, value, converted, receiveType, isSats, to, item: response });
                    } else {
                        SimpleToast.show('Failed to Send Lightening. Please try again.', SimpleToast.SHORT)
                    }
                } catch (error) {
                    console.error('Error Send Lightening Strike:', error);
                } finally {
                    setIsSendLoading(false);
                }
            }
        } else if (to.startsWith('bc')) { //bitcoin onchain
            if (amount == '') {
                SimpleToast.show('Please enter an amount', SimpleToast.SHORT);
                setIsSendLoading(false);
                return;
            }
            if(!isCheck && isWithdrawal && vaultTab){
                SimpleToast.show("Please verify the destination address", SimpleToast.SHORT)
                setIsSendLoading(false);
                return;
            }
            if(receiveType){
                if (selectedFee == null) {
                    SimpleToast.show('Please select fee rate', SimpleToast.SHORT);
                    setIsSendLoading(false);
                    return;
                }
                const feeForBamskki = (0.1 / 100) * Number(amount);
                // const remainingAmount = Number(amount) - feeForBamskki;
                const remainingAmount = Number(amount);
                console.log('feeForBamskki: ', feeForBamskki)
                console.log('remainingAmount: ', remainingAmount)
                if (remainingAmount <= 0) {
                    SimpleToast.show("You don't have enough balance", SimpleToast.SHORT);
                    setIsSendLoading(false);
                    return;
                }

                console.log('selectedFee: ', selectedFee)
                try {
                    const sendResponse = await sendBitcoinPayment(remainingAmount, to, selectedFee, note);

                    let jsonSend = null
                    console.log('sendResponse: ', sendResponse)
                    if (sendResponse?.startsWith('{')) { // as estimatedFee is a string so this condition is helpful
                        jsonSend = JSON.parse(sendResponse);

                        console.log('jsonSend: ', jsonSend)
                        //send 0.1% fee to bamskii
                        // const response = await sendCoinsViaUsername("bamskki@coinos.io", feeForBamskki, '');
                        // console.log('response username: ', response, typeof response)
                        dispatchNavigate('TransactionBroadCast', { matchedRate, currency, type, value, converted, isSats, to, item: jsonSend });

                    } else {
                        SimpleToast.show(sendResponse, SimpleToast.SHORT);
                        return;
                    }
                } catch (error) {
                    console.error('Error Send to bitcoin:', error);
                    SimpleToast.show('Failed to Send to bitcoin. Please try again.', SimpleToast.SHORT);
                } finally {
                    setIsSendLoading(false);
                }
            } else {
                if (selectedStrikeFee == null) {
                    SimpleToast.show('Please select fee rate', SimpleToast.SHORT);
                    setIsSendLoading(false);
                    return;
                }
                try {
                    const payload = {
                        btcAddress: to,
                        sourceCurrency: 'BTC',
                        amount: {
                            amount: Number(amount),
                            currency: currency || "USD",
                            feePolicy: "INCLUSIVE"
                        },
                        description: note,
                        onchainTierId: 'tier_fast' + Math.floor(Math.random() * 100)
                    }
                    console.log('payload: ', payload)
                    const response = await getPaymentQouteByOnChain(payload, paymentQuoteData?.paymentQuoteId);
                    if(response?.amount){
                        console.log('responserresponse: ', response)
                        dispatchNavigate('TransactionBroadCast', { matchedRate, currency, type, value, converted, receiveType, isSats, to, item: response });
                    } else if(response?.data?.message) {
                        SimpleToast.show(response?.data?.message, SimpleToast.SHORT)
                    } else {
                        SimpleToast.show('Failed to Send Bitcoin. Please try again.', SimpleToast.SHORT)
                    }
                } catch (error) {
                    console.error('Error Send to bitcoin:', error);
                    SimpleToast.show('Failed to Send to bitcoin. Please try again.', SimpleToast.SHORT);
                } finally {
                    setIsSendLoading(false);
                }
            }

        } else if (to.includes("@")) { //username
            if (amount == '') {
                SimpleToast.show('Please enter an amount', SimpleToast.SHORT);
                setIsSendLoading(false);
                return;
            }
            try {
                if(receiveType){
                    const response = await sendCoinsViaUsername(to, Number(amount), note);
                    console.log('response username: ', response, typeof response, amount, to, note)
                    if (typeof response == 'object' && response?.hash) {
                        dispatchNavigate('Transaction', { matchedRate, currency, type, value, converted, isSats, to, item: response });
                    } else if (response?.startsWith('{')) {
                        const jsonResponse = JSON.parse(response);
                        console.log('jsonResponse: ', jsonResponse)
                        dispatchNavigate('Transaction', { matchedRate, currency, type, value, converted, isSats, to, item: jsonResponse });
                    } else {
                        SimpleToast.show(response, SimpleToast.SHORT);
                    }
                } else {
                    try {
                        const payload = {
                            lnAddressOrUrl: to,
                            sourceCurrency: 'BTC',
                            amount: {
                                amount: String(amount),
                                currency: currency || "USD"
                            },
                            ...(to.includes('blink') ? {} : { description: note })
                        }
                        console.log('payload: ', payload, paymentQuoteData)
                        const response = await getPaymentQouteByLightening(payload, paymentQuoteData?.paymentQuoteId);
                        console.warn('response getPaymentQouteByLightening: ', response?.data?.validationErrors)
                        if(response?.amount){
                            console.log('responserresponse: ', response, to)
                            dispatchNavigate('Transaction', { matchedRate, currency, type, value, converted, receiveType, isSats, to, item: response });
                        } else {
                            SimpleToast.show('Failed to Send Lightening. Please try again.', SimpleToast.SHORT)
                        }
                    } catch (error) {
                        console.error('Error Send Lightening Strike:', error);
                    } finally {
                        setIsSendLoading(false);
                    }
                }
            } catch (error) {
                console.error('Error handleSendSats:', error);
                SimpleToast.show('Failed Send to User. Please try again.', SimpleToast.SHORT);
            } finally {
                setIsSendLoading(false);
            }
        } else { //liquid address
            if (amount == '') {
                SimpleToast.show('Please enter an amount', SimpleToast.SHORT);
                setIsSendLoading(false);
                return;
            }
            if (selectedFee == null) {
                SimpleToast.show('Please select fee rate', SimpleToast.SHORT);
                setIsSendLoading(false);
                return;
            }
            const feeForBamskki = (0.1 / 100) * Number(amount);
            // const remainingAmount = Number(amount) - feeForBamskki;
            const remainingAmount = Number(amount);
            console.log('feeForBamskki: ', feeForBamskki)
            console.log('remainingAmount: ', remainingAmount)
            if (remainingAmount <= 0) {
                SimpleToast.show("You don't have enough balance", SimpleToast.SHORT);
                setIsSendLoading(false);
                return;
            }

            try {
                const sendResponse: any = await sendBitcoinPayment(remainingAmount, to, selectedFee, note);

                let jsonSend = null
                console.log('sendResponse: ', sendResponse)
                if (sendResponse?.startsWith('{') || (typeof sendResponse == 'object' && sendResponse?.txid)) { // as estimatedFee is a string so this condition is helpful
                    jsonSend = JSON.parse(sendResponse);

                    //send 0.1% fee to bamskii
                    // const response = await sendCoinsViaUsername("bamskki@coinos.io", feeForBamskki, '');
                    // console.log('response username: ', response)
                    dispatchNavigate('TransactionBroadCast', { matchedRate, currency, type, value, converted, isSats, to, item: jsonSend, receiveType });
                } else {
                    SimpleToast.show(sendResponse, SimpleToast.SHORT);
                    return;
                }
            } catch (error) {
                console.error('Error Send to liquid:', error);
                SimpleToast.show('Failed to Send to Liquid. Please try again.', SimpleToast.SHORT);
            } finally {
                setIsSendLoading(false);
            }
        }
    };

    const increaseClickHandler = () => {
        const feeKeys = Object.values(feeNames);
        const currentIndex = feeKeys.indexOf(selectedFeeName !== "Select Fee" ? selectedFeeName : '');
        const fromFeeKeys = Object.keys(recommendedFee);
        if (currentIndex === feeKeys.length - 1) {
            SimpleToast.show('You have reached the end of the fee list.', SimpleToast.SHORT);
            return;
        }
        const newIndex = (currentIndex + 1) % feeKeys.length;
        const newFeeKey = fromFeeKeys[newIndex];
        handleFeeEstimate(newFeeKey)
    };

    const decreaseClickHandler = () => {
        const feeKeys = Object.values(feeNames);
        const currentIndex = feeKeys.indexOf(selectedFeeName !== "Select Fee" ? selectedFeeName : '');
        const fromFeeKeys = Object.keys(recommendedFee);
        if (currentIndex === 0) {
            SimpleToast.show('You have reached the start of the fee list.', SimpleToast.SHORT);
            return;
        }
        const newIndex = (currentIndex - 1 + feeKeys.length) % feeKeys.length;
        const newFeeKey = fromFeeKeys[newIndex];
        handleFeeEstimate(newFeeKey)
    };

    const increaseStrikeClickHandler = () => {
        let selectedFee = {}
        if (!selectedStrikeFee) {
            selectedFee = strikeFees[0];
            setSelectedStrikeFee(selectedFee)
        } else {
            const currentIndex = strikeFees.findIndex(fee => fee.id === selectedStrikeFee.id);
            if (currentIndex < strikeFees.length - 1) {
                selectedFee = strikeFees[currentIndex + 1];
                setSelectedStrikeFee(selectedFee)
            } else {
                SimpleToast.show('You have reached the end of the fee list.', SimpleToast.SHORT);
            }
        }

    };

    const decreaseStrikeClickHandler = () => {
        let selectedFee = {}
        if (!selectedStrikeFee) {
            selectedFee = strikeFees[0];
            setSelectedStrikeFee(selectedFee)
        } else {
            const currentIndex = strikeFees.findIndex(fee => fee.id === selectedStrikeFee.id);
            if (currentIndex > 0) {
                selectedFee = strikeFees[currentIndex - 1];
                setSelectedStrikeFee(selectedFee)
            } else {
                SimpleToast.show('You have reached the start of the fee list.', SimpleToast.SHORT);
            }
        }

    };

    const editAmountClickHandler = () => {
        dispatchNavigate('SendScreen', {
            ...route.params,
            currency,
            matchedRate,
            walletID: wallet.getID(),
            value: isSats ? value : converted,
            converted: isSats ? converted : value,
            isSats: true,
            to,
            type,
            total,
            recommendedFee,
            isWithdrawal,
            wallet,
            editAmount: () => {
                //set max amount value to show in recipient
                setIsEditAmount(true)
            }
        });
    };

    const addressHandler = () => {
        dispatchNavigate('WalletAddresses', {
            walletID: wallet.getID(),
            isTouchable: true,
            value,
            converted,
            isSats,
            to,
            type,
            recommendedFee,
            isWithdrawal,
            wallet,
            currency,
        });
    }

    const handleWithdrawalFee = (fee: number) => {
        const temp = ((Number(fee || 0) / Number(value || 0)) || 0) * 100
        return temp;
    }

    console.log('strikeFees: ', value, to, type, recommendedFee)
    return (
        <ScreenLayout showToolbar isBackButton title={isWithdrawal ? "Review Withdrawal" : type === 'BUY' ? "Review Purchase" : "Review Payment"}>
            <View style={styles.topView}>
                {/* {isStartLoading ?
                    <ActivityIndicator style={{ marginTop: 10, marginBottom: 20 }} color={colors.white} />
                    :
                    <GradientCardWithShadow
                        colors_={[colors.gray.dark, colors.gray.dark]}
                        style={styles.linearGradient}
                        disabled
                        linearStyle={styles.height}
                        shadowStyleTop={styles.top}
                        shadowStyleBottom={styles.bottom}>
                        <View style={styles.view}>
                            <Text h2 bold style={styles.check}>
                                Lightning Account
                            </Text>
                            <Image
                                source={CoinOSSmall}
                                style={styles.blink}
                                resizeMode="contain"
                            />
                        </View>
                        <View style={styles.sats}><Text h2>{formatNumber(balance)} sats  ~  </Text><Text h3>${convertedRate.toFixed(2)}</Text></View>
                        <Text bold style={styles.text}>{formatNumber(Number(withdrawThreshold) + Number(reserveAmount))} sats</Text>
                        <View style={{ paddingHorizontal: 25, alignItems: 'center' }}>
                            <View style={styles.showLine} />
                            <View style={[styles.box, { left: `${calculatePercentage(Number(withdrawThreshold), Number(reserveAmount)) + 7}%` }]} />
                            <LinearGradient
                                start={{ x: 0, y: 1 }} end={{ x: 1, y: 1 }}
                                colors={[colors.white, colors.pink.dark]}
                                style={[styles.linearGradient2, { width: `${calculateBalancePercentage(Number(balance), Number(withdrawThreshold), Number(reserveAmount))}%` }]}>
                            </LinearGradient>

                        </View>
                    </GradientCardWithShadow>
                } */}

                <View style={styles.middle}>
                    {balance < withdrawThreshold && isWithdrawal &&
                        <Text style={{ color: colors.yellow2, marginLeft: 15, marginBottom: 25 }}>You haven't reached your withdrawal threshold yet.</Text>
                    }
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginRight: 15 }}>
                        <TextViewV2 keytext={type == 'SELL' ? "You will send: " : type == 'BUY' ? "You will receive: " : "Recipient will get: "} text={isSats ? `${value} sats ~ ${getStrikeCurrency(currency || 'USD')}${converted}` : `${getStrikeCurrency(currency || 'USD')}${value} ~ ${converted} sats`} textStyle={styles.price} />
                        {isWithdrawal &&
                            <TouchableOpacity activeOpacity={0.7} onPress={editAmountClickHandler} style={{
                                borderWidth: 3,
                                borderColor: colors.white,
                                borderRadius: 17,
                                paddingVertical: 8,
                                paddingHorizontal: 10,
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <Text style={{ fontSize: 14, color: isEditAmount ? colors.green : colors.white }}>Edit Amount</Text>
                            </TouchableOpacity>
                        }
                    </View>
                    <TextViewV2 keytext={type === 'BUY' ? "Spent from: " : "Sent from: "} text={receiveType ? "Coinos Lightning Account" : type == 'SELL' || type == 'BUY' ? "Strike Fiat Account" : "Strike Lightning Account"} />
                    {isWithdrawal && to.length > 0 ?
                        <View style={{
                            marginBottom:30,
                            marginStart:15,
                            marginEnd: 10,
                        }}>
                            <Text bold style={{fontSize: 18}}>{"To: "}</Text>
                            <TouchableOpacity activeOpacity={0.7} onPress={addressHandler} style={{
                                flexDirection: 'row', 
                                alignItems: 'center', 
                                marginTop: 10, 
                                paddingVertical: 8, 
                                paddingHorizontal: 25, 
                                borderWidth: 2, 
                                borderColor: vaultTab ? colors.blueText : colors.greenShadow, 
                                borderRadius: 15,
                                width: '90%'
                            }}>
                                <Text italic style={StyleSheet.flatten({
                                    flex: 1,
                                    fontSize: 16,
                                    marginTop: 3,
                                    color: vaultTab ? colors.blueText : colors.greenShadow
                                })}>{"Vault Address: "}{!to.includes('@') && to.length > 20 ? shortenAddress(to) : to}</Text>
                                <Image source={Edit} style={styles.editImage} resizeMode='contain' />
                            </TouchableOpacity>
                        </View>
                    : to.length > 0 &&
                        <TextViewV2 keytext="To: " text={!to.includes('@') && to.length > 20 ? shortenAddress(to) : to} />
                    }
                    {/* {isWithdrawal &&
                        <TouchableOpacity onPress={addressHandler}>
                            <Text style={{ marginLeft: 10, fontSize: 18, marginBottom: 20, textDecorationLine: 'underline' }}>Add Address</Text>
                        </TouchableOpacity>
                    } */}
                    {vaultTab && isWithdrawal &&
                        <>
                            <Text style={[{marginHorizontal: 12, fontSize: 14, width: isIOS ? '90%' : '80%', marginTop: -10}]}>⚠️ DO NOT transfer to any of these addresses without verifying their authenticity from your hardware device! </Text>
                            <TouchableOpacity activeOpacity={0.7} onPress={() => setIsCheck(!isCheck)} style={{flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 25, marginHorizontal: 12 , alignSelf: 'flex-start' }}>
                                <View style={styles.checkView}>
                                    {isCheck && <Image source={Check} style={styles.checkImage} resizeMode='contain' /> }
                                </View>
                                <Text style={{color: colors.white, marginLeft: 10, fontSize: 16}} italic>I verified this address</Text>
                            </TouchableOpacity>
                        </>
                    }

                    {to && value && (type === 'bitcoin' || type === 'liquid') && (recommendedFee || strikeFees) ?
                        <>
                            {receiveType ?
                                <View style={{ zIndex: 100, elevation: 100 }}>
                                    <View style={[styles.feesView, { zIndex: 100, elevation: 100 }]}>
                                        <TextViewV2 keytext="Network Fee:  " text={` ~   ${estimatedFee} sats`} />
                                        <View style={{ marginLeft: 10, marginTop: -10, width: 160, zIndex: 100, elevation: 100 }}>
                                            <TouchableOpacity
                                                onPress={() => setModalVisible(!isModalVisible)}
                                                disabled={feeLoading}
                                                activeOpacity={0.7}
                                                style={{ opacity: feeLoading ? 0.5 : 1 }}>
                                                <GradientCard disabled
                                                    colors_={['#FFFFFF', '#B6B6B6']}
                                                    style={{ height: 40, borderRadius: isModalVisible ? 10 : 10, width: 160 }} linearStyle={{ height: 40, borderRadius: 10 }}>
                                                    <View style={{ backgroundColor: colors.gray.dark, flex: 1, margin: 2, borderRadius: 9, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }}>
                                                        <Text bold style={{ fontSize: 14 }}>{selectedFeeName}</Text>
                                                        <Icon name={isModalVisible ? "chevron-up" : "chevron-down"} type="font-awesome" color="#FFFFFF" size={12} style={{ marginLeft: 6 }} />
                                                    </View>
                                                </GradientCard>
                                            </TouchableOpacity>
                                            {isModalVisible && (
                                                <View style={{ backgroundColor: colors.gray.dark, borderWidth: 1, borderTopWidth: 0, borderColor: '#333', borderBottomLeftRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden', position: 'absolute', top: 40, left: 0, right: 0, zIndex: 30, elevation: 10 }}>
                                                    {Object.entries(recommendedFee).map(([feeKey, feeValue], index) => (
                                                        feeKey !== 'minimumFee' && (
                                                            <TouchableOpacity
                                                                key={feeKey}
                                                                style={{ paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: index < Object.keys(recommendedFee).length - 2 ? 1 : 0, borderBottomColor: '#333', backgroundColor: selectedFeeName === feeKey ? colors.primary : 'transparent' }}
                                                                onPress={() => handleFeeSelect(feeKey as Fee)}>
                                                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                    <Text bold style={{ fontSize: 13 }}>{feeNames[feeKey as Fee]}</Text>
                                                                    <Text style={{ fontSize: 11, color: '#999' }}>{feeValue} sat/vB</Text>
                                                                </View>
                                                            </TouchableOpacity>
                                                        )
                                                    ))}
                                                </View>
                                            )}
                                        </View>
                                    </View>
                                </View>
                            :
                                <View style={{ zIndex: 100, elevation: 100 }}>
                                    <View style={[styles.feesView, { zIndex: 100, elevation: 100 }]}>
                                        <View style={{ marginTop: -10, width: 160, zIndex: 100, elevation: 100 }}>
                                            <TouchableOpacity
                                                onPress={() => setModalVisible(!isModalVisible)}
                                                disabled={feeLoading}
                                                activeOpacity={0.7}
                                                style={{ opacity: feeLoading ? 0.5 : 1 }}>
                                                <GradientCard disabled
                                                    colors_={['#FFFFFF', '#B6B6B6']}
                                                    style={{ height: 40, width: 160 }} linearStyle={{ height: 40, borderRadius: 10 }}>
                                                    <View style={{ backgroundColor: colors.gray.dark, flex: 1, margin: 2, borderRadius: 9, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }}>
                                                        <Text bold style={{ fontSize: 14 }}>{selectedStrikeFee ? selectedStrikeFee.label : selectedFeeName}</Text>
                                                        <Icon name={isModalVisible ? "chevron-up" : "chevron-down"} type="font-awesome" color="#FFFFFF" size={12} style={{ marginLeft: 6 }} />
                                                    </View>
                                                </GradientCard>
                                            </TouchableOpacity>
                                            {isModalVisible && (
                                                <View style={{ backgroundColor: colors.gray.dark, borderWidth: 1, borderTopWidth: 0, borderColor: '#333', borderBottomLeftRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden', position: 'absolute', top: 40, left: 0, right: 0, zIndex: 30, elevation: 10 }}>
                                                    {strikeFees && strikeFees.map((item: any, index: number) => {
                                                        const isDisabled = item?.label == 'Free' && item?.minimumAmount && item?.minimumAmount?.amount > (isSats ? value / SATS : converted / SATS);
                                                        return (
                                                            <TouchableOpacity
                                                                key={item.id || index}
                                                                disabled={isDisabled}
                                                                style={{ paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: index < strikeFees.length - 1 ? 1 : 0, borderBottomColor: '#333', backgroundColor: selectedStrikeFee?.id === item.id ? colors.primary : 'transparent', opacity: isDisabled ? 0.5 : 1 }}
                                                                onPress={() => handleStrikeFeeSelect(item)}>
                                                                <Text bold style={{ fontSize: 13 }}>{item.label}</Text>
                                                                {isDisabled && <Text style={{ fontSize: 9, color: '#999' }}>Min: {item.minimumAmount?.amount} BTC</Text>}
                                                            </TouchableOpacity>
                                                        );
                                                    })}
                                                </View>
                                            )}
                                        </View>
                                    </View>
                                    <View style={{ marginTop: 15, marginStart: 15, height: 30 }}>
                                        {selectedStrikeFee && <Text bold style={{ fontSize: 18 }}>Fee: <Text italic style={{ fontSize: 16, fontWeight: 'normal' }}>{`~ ${(Number(selectedStrikeFee?.estimatedFee?.amount || 0) * 100000000).toFixed(0)} sats (~$${(Number(selectedStrikeFee?.estimatedFee?.amount || 0) * (matchedRate || 0)).toFixed(2)}) (${value > 0 ? ((Number(selectedStrikeFee?.estimatedFee?.amount || 0) * 100000000 / Number(value)) * 100).toFixed(1) : '0'}%)`}</Text></Text>}
                                    </View>
                                </View>
                            }
                            {/* <TextViewV2 keytext="Coinos Fee + Service Fee:  " text={` ~   ${(networkFee || 0) + (bamskiiFee || 0)} sats`} /> */}
                            {receiveType && <TextViewV2 keytext="Coinos Fee:  " text={` ~   ${(networkFee || 0)} sats`} /> }
                            {receiveType && <TextViewV2 keytext="Total Fee:  " text={isWithdrawal ? ` ~   ${(networkFee || 0) + (estimatedFee || 0)} sats (~${handleWithdrawalFee((networkFee || 0) + (estimatedFee || 0)).toFixed(0)}%)` : ` ~   ${(networkFee || 0) + (estimatedFee || 0)} sats (~0.2%)`} />}
                            {!receiveType && !selectedStrikeFee && paymentQuoteData && <TextViewV2 keytext="Total Fee:  " text={` ~   ${(paymentQuoteData?.totalFee?.amount * SATS).toFixed(0)} sats`} />}
                        </>
                        :
                        <TextView keytext="Fees:  " text={` ~   ${receiveType ? estimatedFee : paymentQuoteData && to?.length > 0 ? usdToSats(paymentQuoteData?.totalFee?.amount || 0, (matchedRate || 0)) : paymentQuoteData && to.length == 0 ? usdToSats(paymentQuoteData?.fee?.amount || 0, (matchedRate || 0)) : 0} sats`} />
                    }
                </View>
                {!receiveType && !to.includes('blink') && to?.length > 0 &&
                    <View style={{ marginTop: 160 }} />
                }
                {!receiveType && !to.includes('blink') && to?.length > 0 &&
                    <GradientCard
                        style={styles.main}
                        linearStyle={styles.heigth}
                        colors_={note ? [colors.pink.extralight, colors.pink.default] : [colors.gray.thin, colors.gray.thin2]}>
                        <Input
                            onChange={setNote}
                            value={note}
                            textInputStyle={styles.heigth2}
                            label="Add note"
                        />
                    </GradientCard>
                }
            </View>
            {(type === 'bitcoin' || type === 'liquid') && <Text style={{ color: '#FFFFFF', fontSize: 15, textAlign: 'center', marginBottom: 10 }}><Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' }}>Caution:</Text> Bitcoin transactions are irreversible</Text>}
            <View style={styles.container}>
                {type === 'bitcoin' || type == "SELL" || type == "BUY" ?
                    <SwipeButton title={isWithdrawal ? 'Slide to Withdraw' : type === 'BUY' ? 'Slide to Purchase' : 'Slide to Send'} ref={swipeButtonRef} onToggle={handleToggle} isLoading={isSendLoading} />
                    :
                    <GradientButton style={styles.invoiceButton} textStyle={{ fontFamily: 'Lato-Medium', }}
                        title={'Send'}
                        disabled={isSendLoading || feeLoading}
                        onPress={handleSendSats}
                    />
                }
                {/* <SwipeButton ref={swipeButtonRef} onToggle={handleToggle} isLoading={isSendLoading} /> */}
                {/* <GradientButton style={styles.invoiceButton} textStyle={{ fontFamily: 'Lato-Medium', }} title="Send" onPress={sendClickHandler} /> */}
            </View>
        </ScreenLayout>
    )
}