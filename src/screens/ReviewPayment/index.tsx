import React, { useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import SimpleToast from "react-native-simple-toast";
import { Icon } from "react-native-elements";
import ReactNativeModal from "react-native-modal";
import QRCode from 'react-native-qrcode-svg';
import styles from "./styles";
import { Input, LoadingSpinner, ScreenLayout, Text } from "@Cypher/component-library";
import { Check, CoinOS, CoinOSSmall, Cold1, Edit, Electricity, Hot, StrikeFull } from "@Cypher/assets/images";
import { GradientButton, GradientCard, GradientCardWithShadow, GradientText, ImageText, SwipeButton } from "@Cypher/components";
import CustomProgressBar from "@Cypher/components/CustomProgressBar";
import { colors } from "@Cypher/style-guide";
import { dispatchNavigate, isIOS } from "@Cypher/helpers";
import LinearGradient from "react-native-linear-gradient";
import TextView from "./TextView";
import TextViewV2 from "../Invoice/TextView"
import useAuthStore from "@Cypher/stores/authStore";
import { bitcoinRecommendedFee, bitcoinSendFee, getCurrencyRates, getMe, sendBitcoinPayment, sendCoinsViaUsername, sendLightningPayment } from "@Cypher/api/coinOSApis";
import { btc, formatNumber, getStrikeCurrency, matchKeyAndValue, SATS } from "@Cypher/helpers/coinosHelper";
import { FeeSelection } from "./FeeSelection/FeeSelection";
import bolt11 from "bolt11";
import { startsWithLn } from "../Send";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import { FEATURE_ARK_ENABLED } from "@Cypher/services/ark";
import { isCoinosAllowed } from "@Cypher/services/featureFlags";
import {
    swap as runLightningSwap,
    InvoiceCreationFailedError,
    LightningSwapError,
    PaymentFailedError,
} from "@Cypher/services/lightningSwap";

/**
 * Whether a BOLT11 invoice carries a non-zero amount of its own.
 * When true, Strike's payment-quote API rejects an explicit `amount.amount`
 * in the payload ("cannot specify the amount for the non-zero amount
 * invoice"), so we have to omit that field. Amount-less invoices still
 * require the explicit amount.
 */
function invoiceHasAmount(invoice: string): boolean {
    try {
        const decoded = bolt11.decode(invoice);
        if (decoded?.satoshis && decoded.satoshis > 0) return true;
        if (decoded?.millisatoshis && Number(decoded.millisatoshis) > 0) return true;
        return false;
    } catch (_) {
        return false;
    }
}
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

/**
 * Build the "Trading fees" line for the Strike BUY/SELL review.
 *
 * Strike's `paymentQuoteData.totalFee.amount` units depend on the
 * leg of the trade:
 *   - BUY  (fiat → BTC): totalFee is in source fiat (USD/EUR)
 *   - SELL (BTC → fiat): totalFee is in target fiat (USD/EUR)
 * Either way, treating it as BTC (the old `× SATS` math on line 1174
 * before this fix) was wrong — for a $0.50 fee at $80k/BTC it would
 * have shown 50 million "sats" instead of ~625.
 *
 * `paymentQuoteData.conversionRate.amount` is the rate Strike used for
 * the trade itself, in fiat-per-BTC. Always preferred over the local
 * `matchedRate` state because it's the rate the user is actually
 * trading at; the local rate is only a fallback for when the quote
 * hasn't surfaced one (e.g. an older API shape).
 *
 * Output is the right-hand side of the row only — the keytext
 * "Trading fees:  " sits separately on the TextViewV2.
 */
function buildTradingFeeText(
  paymentQuoteData: any,
  value: any,
  converted: any,
  isSats: boolean,
  currency: string,
  matchedRateState: number,
  matchedRateRouteParam: number | undefined,
): string {
  // Strike's currency-exchange-quotes (BUY/SELL) returns the fee under
  // `fee.{amount,currency}`. Their payment-quotes API uses `totalFee.*`
  // instead. We try both — `totalFee` first (the original code looked
  // there), then `fee` — so the same helper works regardless of which
  // quote API populated `paymentQuoteData`.
  const feeNode =
    paymentQuoteData?.totalFee?.amount !== undefined
      ? paymentQuoteData.totalFee
      : paymentQuoteData?.fee;
  const feeAmount = Number(feeNode?.amount) || 0;
  const feeCurrency = String(feeNode?.currency ?? '').toUpperCase();
  // Use `matchedRate` directly — it's consistently fiat-per-BTC across
  // the app. Strike's `conversionRate.amount` for currency-exchange
  // quotes is BTC-per-fiat (the inverse), and trying to use it without
  // checking source/target produced astronomical sat numbers when the
  // EUR rate of ~0.0000125 was treated as fiat/BTC.
  const rate =
    Number(matchedRateState) ||
    Number(matchedRateRouteParam) ||
    0;

  let feeSats = 0;
  let feeFiat = 0;
  if (feeCurrency === 'BTC') {
    feeSats = feeAmount * SATS;
    feeFiat = feeAmount * rate;
  } else {
    // Default branch — fee is in source/target fiat (USD, EUR, …).
    feeFiat = feeAmount;
    feeSats = rate > 0 ? (feeAmount / rate) * SATS : 0;
  }

  // Percentage relative to the purchase amount in sats. value/converted
  // are keyboard strings (sats or fiat depending on isSats), so resolve
  // the sat side here.
  const purchaseSats = Number(isSats ? value : converted) || 0;
  const feePct = purchaseSats > 0 ? (feeSats / purchaseSats) * 100 : 0;

  const sym = getStrikeCurrency(currency || 'USD');
  const pctStr =
    feePct === 0
      ? '0%'
      : feePct < 0.01
        ? '<0.01%'
        : `${feePct.toFixed(feePct < 1 ? 2 : 1)}%`;
  return ` ~   ${feeSats.toFixed(0)} sats (~${sym}${feeFiat.toFixed(2)}) (${pctStr})`;
}

export default function ReviewPayment({ navigation, route }: Props) {
    const { value, converted, isSats, isMaxUSDSelected = false, to, type, recommendedFee: recommendedFeeParam, currency, isWithdrawal = false, wallet = null, description, receiveType, vaultTab, total } = route?.params;
    // Fee rates arrive as a route param from HomeScreen, but that fetch is
    // conditional and network-dependent, so the param can be undefined when
    // the user navigates here quickly after app start (or mempool.space was
    // unreachable). Rendering the fee dropdown off an undefined object was
    // a hard crash in release builds. Self-heal: seed from the param, fetch
    // fresh rates if missing.
    const [recommendedFee, setRecommendedFee] = useState<any>(recommendedFeeParam);
    useEffect(() => {
        if (recommendedFee?.fastestFee != null) return;
        let cancelled = false;
        (async () => {
            try {
                const fees = await bitcoinRecommendedFee();
                if (!cancelled && fees?.fastestFee != null) setRecommendedFee(fees);
            } catch {
                // Dropdown stays empty; handleFeeEstimate's guard toasts on tap.
            }
        })();
        return () => { cancelled = true; };
    }, []);
    const { withdrawThreshold, reserveAmount, strikeUser, isAuth, isArkAuth, walletID: hotVaultWalletID, coldStorageWalletID, user, strikeMe } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    // Post-purchase destination, BUY-only. Picker rendered below the
    // review fields lets the user choose what happens to the freshly-
    // bought BTC the moment Strike clears the trade. "strike" keeps it
    // in the Strike fiat→BTC account (existing behavior); the others
    // auto-route to the matching swap or on-chain withdrawal flow.
    type PurchaseDest = 'strike' | 'coinos' | 'ark' | 'hot' | 'cold';
    const [purchaseDest, setPurchaseDest] = useState<PurchaseDest>('strike');
    const canDestCoinos = !!isAuth && isCoinosAllowed();
    const canDestArk = !!isArkAuth && FEATURE_ARK_ENABLED;
    const canDestHot = !!hotVaultWalletID;
    const canDestCold = !!coldStorageWalletID;

    // Inline withdraw preview that appears the moment a vault tile
    // (hot or cold) is selected on the BUY review. Shows the fresh
    // vault receive address + Strike's on-chain fee tiers (3–4
    // options) with fiat/pct preview, mirroring the standalone
    // Strike→vault withdrawal review the user is already used to.
    // Selected tier is carried into routePurchasedBtc so the
    // post-purchase withdrawal dispatch knows which fee to use.
    const [vaultDepositAddress, setVaultDepositAddress] = useState<string>('');
    const [vaultDepositTiers, setVaultDepositTiers] = useState<any[]>([]);
    const [selectedVaultDepositTier, setSelectedVaultDepositTier] = useState<any>(null);
    const [vaultDepositTiersLoading, setVaultDepositTiersLoading] = useState<boolean>(false);
    const [vaultDepositTierModalVisible, setVaultDepositTierModalVisible] = useState<boolean>(false);

    // When `WalletAddresses` returns a manually-picked address, swap it
    // into the inline picker. We also clear the stale param so a
    // subsequent re-render doesn't re-fire this effect with the same
    // value. Match against the active vault tab so the user can't
    // accidentally drop a Hot Vault address into a Cold-vault flow.
    useEffect(() => {
        const picked = route?.params?.selectedDepositAddress as string | undefined;
        const pickedVault = route?.params?.selectedDepositVaultType as 'hot' | 'cold' | undefined;
        if (!picked) return;
        if (
            (pickedVault === 'cold' && purchaseDest === 'cold') ||
            (pickedVault === 'hot' && purchaseDest === 'hot')
        ) {
            setVaultDepositAddress(picked);
            // Manual address pick on the cold-vault path = a different
            // address than what was previously verified, so reset the
            // hardware-verification checkbox.
            if (pickedVault === 'cold') {
                setIsCheck(false);
            }
        }
        if (route?.params) {
            (route.params as any).selectedDepositAddress = undefined;
            (route.params as any).selectedDepositVaultType = undefined;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [route?.params?.selectedDepositAddress]);

    // Reset the hardware-verification checkbox whenever the user
    // switches deposit destination — verification is per-address, not
    // a one-time confession across the whole session.
    useEffect(() => {
        if (type === 'BUY') setIsCheck(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [purchaseDest]);

    useEffect(() => {
        // Reset everything when the picker is anything but a vault.
        if (type !== 'BUY' || (purchaseDest !== 'hot' && purchaseDest !== 'cold')) {
            setVaultDepositAddress('');
            setVaultDepositTiers([]);
            setSelectedVaultDepositTier(null);
            setVaultDepositTiersLoading(false);
            return;
        }

        // Skip the auto-resolve when the user already manually picked
        // an address via the WalletAddresses list — preserves their
        // choice across re-renders. They can clear it by switching
        // tiles (resets the effect via the cleanup above).
        if (vaultDepositAddress) return;

        const targetWallet =
            purchaseDest === 'cold'
                ? wallets.find((w: any) => w.getID() === coldStorageWalletID)
                : wallets.find((w: any) => w.getID() === hotVaultWalletID);
        if (!targetWallet) return;

        let cancelled = false;
        (async () => {
            // (1) Resolve a fresh receive address. Same fallback chain
            // HomeScreen uses for vaultAddress / coldStorageAddress.
            let address: string | undefined;
            try {
                address = await Promise.race<any>([
                    targetWallet.getAddressAsync?.(),
                    new Promise(resolve => setTimeout(() => resolve(undefined), 1500)),
                ]);
            } catch (_) {}
            if (!address && targetWallet._getExternalAddressByIndex) {
                try {
                    address = targetWallet._getExternalAddressByIndex(
                        targetWallet.getNextFreeAddressIndex(),
                    );
                } catch (_) {}
            }
            if (cancelled || !address) return;
            setVaultDepositAddress(address);

            // (2) Fetch Strike's on-chain fee tiers for the same
            // (address, sat-amount) pair the eventual withdrawal will
            // use. Skipped when the user hasn't entered an amount yet.
            const purchasedSats = Number(isSats ? value : converted) || 0;
            if (purchasedSats <= 0) return;
            setVaultDepositTiersLoading(true);
            try {
                const payload = {
                    btcAddress: address,
                    sourceCurrency: 'BTC',
                    amount: {
                        amount: purchasedSats / SATS,
                        currency: 'BTC',
                        feePolicy: 'EXCLUSIVE',
                    },
                    description: '',
                };
                const fees = await getOnChainTiers(payload);
                if (cancelled) return;
                if (fees?.data?.code === 'AMOUNT_TOO_LOW') {
                    SimpleToast.show(fees?.data?.message, SimpleToast.SHORT);
                    return;
                }
                const labeled = (Array.isArray(fees) ? fees : []).map((tier: any) => {
                    switch (tier.id) {
                        case 'tier_fast': tier.label = 'Fast'; break;
                        case 'tier_standard': tier.label = 'Standard'; break;
                        case 'tier_free': tier.label = 'Free'; break;
                        default: tier.label = 'Unknown';
                    }
                    return tier;
                });
                setVaultDepositTiers(labeled);
                // Auto-select the first available (cheapest) tier so the
                // user sees fee details immediately without an extra tap.
                if (labeled.length > 0) {
                    setSelectedVaultDepositTier(labeled[0]);
                }
            } catch (e) {
                if (__DEV__) console.log('on-chain tier fetch failed:', e);
            } finally {
                if (!cancelled) setVaultDepositTiersLoading(false);
            }
        })();

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [purchaseDest, type]);
    const [note, setNote] = useState(description || '');
    const [balance, setBalance] = useState(0);
    const [convertedRate, setConvertedRate] = useState(0);
    const [matchedRate, setMatchedRate] = useState(0);
    const [isStartLoading, setIsStartLoading] = useState(false)
    const [showAddressQR, setShowAddressQR] = useState(false)
    const [selectedFee, setSelectedFee] = useState<number | null>(null);
    const [selectedFeeName, setSelectedFeeName] = useState<string>("Select Fee");
    const [estimatedFee, setEstimatedFee] = useState<number>(0);
    const [networkFee, setNetworkFee] = useState<number>(0);
    const [bamskiiFee, setBamskiiFee] = useState<number>(0);
    const [feeLoading, setFeeLoading] = useState<boolean>(false);
    const [isSendLoading, setIsSendLoading] = useState<boolean>(false);

    // --- BUY progress steps -------------------------------------------------
    // The slide-to-purchase flow runs two (or three) sequential operations
    // behind one spinner: Strike fiat→BTC execute, a settle wait, then the
    // swap / on-chain withdrawal to the picked destination. That's easily
    // 15–30s of anonymous loading. These steps narrate each stage under the
    // slider ("X sats purchased from Strike", "Swapping to Bark Vault…",
    // "taking longer than usual", failure lines) so the wait reads as
    // progress instead of a hang. Cleared at the start of each new slide.
    type BuyStepState = 'active' | 'slow' | 'done' | 'failed';
    type BuyStep = { text: string; state: BuyStepState };
    const [buyProgress, setBuyProgress] = useState<BuyStep[]>([]);
    const swapSlowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Mark the current active step done and append a new active one. */
    const buyStepStart = (text: string) =>
        setBuyProgress(prev => [
            ...prev.map(s =>
                s.state === 'active' || s.state === 'slow'
                    ? { ...s, state: 'done' as const }
                    : s),
            { text, state: 'active' },
        ]);
    /** Resolve the current active step (done/failed), optionally re-texting it. */
    const buyStepFinish = (state: BuyStepState, text?: string) =>
        setBuyProgress(prev => {
            const next = [...prev];
            const i = next.findIndex(s => s.state === 'active' || s.state === 'slow');
            if (i >= 0) next[i] = { text: text ?? next[i].text, state };
            else if (text) next.push({ text, state });
            return next;
        });
    /** Downgrade the active step to the amber "taking longer" treatment. */
    const buyStepSlow = (text: string) =>
        setBuyProgress(prev => prev.map(s =>
            s.state === 'active' ? { text, state: 'slow' as const } : s));
    const clearBuyProgress = () => {
        if (swapSlowTimerRef.current) clearTimeout(swapSlowTimerRef.current);
        swapSlowTimerRef.current = null;
        setBuyProgress([]);
    };
    useEffect(() => () => {
        if (swapSlowTimerRef.current) clearTimeout(swapSlowTimerRef.current);
    }, []);
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
                // Strike rejects payloads that include `amount` for an
                // invoice that already has a non-zero amount baked in
                // ("cannot specify the amount for the non-zero amount
                // invoice"). Omit `amount` in that case; only send it
                // for amount-less invoices where Strike requires it.
                const hasOwnAmount = invoiceHasAmount(to);
                payload = hasOwnAmount
                    ? {
                          lnInvoice: to,
                          sourceCurrency: 'BTC',
                          description: note,
                      }
                    : {
                          lnInvoice: to,
                          sourceCurrency: 'BTC',
                          amount: {
                              amount: Number(amount),
                              currency: currency || "USD",
                              feePolicy: "INCLUSIVE"
                          },
                          description: note
                      };
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
            // Removed bogus `setCurrency("USD")`: there is no currency state setter on this
            // screen (currency comes from route.params with 'USD' fallbacks), so the call threw
            // `ReferenceError: Property 'setCurrency' doesn't exist`, which aborted this try block
            // before setBalance() ran — leaving the screen's balance unset and the loader hung.
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
        // recommendedFee self-heals from a mount-time fetch, but if that
        // failed (offline, mempool.space down) it can still be nullish here.
        // Bail with a toast instead of indexing into undefined.
        if (recommendedFee?.[fee] == null) {
            SimpleToast.show('Network fees unavailable. Please try again.', SimpleToast.SHORT);
            setFeeLoading(false);
            return;
        }
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

    /**
     * Post-purchase auto-router. Called from the BUY success branch in
     * `handleSendSats` when the user picked something other than
     * "Strike" on the destination tile grid below.
     *
     *   coinos / ark → SwapAmount with Strike as the source. Carries
     *     the purchased sat amount as `sourceBalance` so the keyboard
     *     lands at the right MAX value.
     *   hot / cold   → ReviewPayment as an on-chain withdrawal. Address
     *     is resolved fresh via the wallet's `getAddressAsync()` (with
     *     a 1.5s timeout) and a local `_getExternalAddressByIndex`
     *     fallback — same pattern HomeScreen uses for vaultAddress.
     *
     * Skips the Transaction success animation since the user is being
     * thrown straight into the next flow's confirmation; the
     * destination screen handles its own progress + result UI.
     */
    const routePurchasedBtc = async (dest: Exclude<PurchaseDest, 'strike'>) => {
        // Authoritative purchased-sats source: Strike's quote response
        // (`paymentQuoteData.target.amount`, BTC string). The keyboard's
        // local sat estimate (value/converted) doesn't account for
        // Strike's fee or rounding, so it can be 30–60 sats higher than
        // what Strike actually credited. Asking the swap engine to
        // forward more than was credited gives a 422 BALANCE_TOO_LOW
        // from Strike's payment-quote endpoint. Floor to integer sats
        // (Strike returns up to 8 BTC decimals; we don't want fractional).
        // Falls back to value/converted only if the quote's target is
        // missing for some reason.
        const targetBtc = Number(paymentQuoteData?.target?.amount) || 0;
        const settledSats = Math.floor(targetBtc * SATS);
        const fallbackSats = Math.round(
            isSats ? Number(value) || 0 : Number(converted) || 0,
        );
        // Reserve a small buffer for Strike's Lightning send fee. For
        // 2k–5k sat sends Strike charges ~6–10 sats; 10 sats is a safe
        // flat reserve. Without it, balance == amount and Strike adds
        // its fee on top → 422 BALANCE_TOO_LOW. The 10 sats stays in
        // Strike's BTC sub-account, the swap moves the rest.
        const STRIKE_LN_FEE_BUFFER_SATS = 10;
        const usableSats = (settledSats > 0 ? settledSats : fallbackSats) - STRIKE_LN_FEE_BUFFER_SATS;
        const purchasedSats = Math.max(0, usableSats);
        if (purchasedSats <= 0) {
            // Defensive fallback: if we somehow can't resolve a
            // positive sat amount, just take the user to the success
            // animation rather than dispatching a broken next screen.
            dispatchNavigate('Transaction', { matchedRate, currency, type, value, converted, receiveType, isSats, to, item: paymentQuoteData });
            return;
        }

        if (dest === 'coinos' || dest === 'ark') {
            // Inline swap: Strike → destination provider via the
            // lightningSwap engine. Skips the SwapAmount keyboard since
            // the user already committed to this exact sat amount when
            // they swiped to purchase. On success we hand off to the
            // existing Transaction screen so the success animation
            // matches every other Lightning-send flow. On failure we
            // surface the error and leave the user on this review so
            // they can re-pick a destination or retry.
            const toAddress = dest === 'coinos'
                ? (user ? `${user}@coinos.io` : 'coinos')
                : 'Ark';
            try {
                if (__DEV__) console.log(`[BUY → ${dest}] routePurchasedBtc fired, settledSats=${settledSats}, swapping=${purchasedSats} (fallback=${fallbackSats})`);

                // Strike's `executeFiatExchangeQuote` returns 202
                // Accepted — the trade is queued, not necessarily
                // settled. Calling Lightning send immediately yields
                // 422 BALANCE_TOO_LOW because the BTC isn't yet
                // reflected in the account balance. 6s gives Strike
                // time to land small EUR→BTC trades. Larger trades
                // ought to poll the quote-status endpoint instead;
                // doing that as follow-on work.
                if (__DEV__) console.log(`[BUY → ${dest}] waiting 6s for Strike trade to settle`);
                buyStepStart('Waiting for Strike to settle the trade…');
                await new Promise(resolve => setTimeout(resolve, 6000));

                if (__DEV__) console.log(`[BUY → ${dest}] starting swap`);
                const destLabel = dest === 'coinos' ? 'CoinOS' : 'Bark Vault';
                buyStepStart(`Swapping ${purchasedSats.toLocaleString()} sats to ${destLabel}…`);
                // Amber "taking longer" treatment if the swap hasn't
                // resolved after 15s (invoice creation + LN routing can
                // stall without failing outright).
                swapSlowTimerRef.current = setTimeout(() => {
                    buyStepSlow(`Swapping to ${destLabel} is taking longer than usual…`);
                }, 15_000);
                const result = await runLightningSwap('strike', dest, purchasedSats, {
                    memo: `Buy → ${dest}`,
                });
                if (swapSlowTimerRef.current) clearTimeout(swapSlowTimerRef.current);
                swapSlowTimerRef.current = null;
                buyStepFinish('done', `${purchasedSats.toLocaleString()} sats swapped to ${destLabel}`);
                const fiatPerBtc = Number(matchedRate) || 0;
                const convertedFiat = (purchasedSats * fiatPerBtc * btc(1)).toFixed(2);
                // type: 'BUY' keeps the success screen reading
                // "Purchase Complete" (the trade succeeded). The new
                // `swappedTo` param adds a subtitle telling the user
                // the funds also landed in CoinOS / Ark in the same
                // shot. The destination's display label, not its id.
                dispatchNavigate('Transaction', {
                    matchedRate,
                    currency,
                    type: 'BUY',
                    value: purchasedSats,
                    converted: convertedFiat,
                    isSats: true,
                    to: toAddress,
                    item: result,
                    swappedTo: dest === 'coinos' ? 'CoinOS' : 'Bark Vault',
                });
            } catch (error) {
                if (swapSlowTimerRef.current) clearTimeout(swapSlowTimerRef.current);
                swapSlowTimerRef.current = null;
                buyStepFinish('failed',
                    `Failed to swap to ${dest === 'coinos' ? 'CoinOS' : 'Bark Vault'}. Your sats are safe in Strike.`);
                console.error(`[BUY → ${dest}] swap failed:`, error);
                let message = 'Swap failed. Your purchase succeeded — try again from Home → Swap.';
                if (error instanceof InvoiceCreationFailedError) {
                    message = `${dest === 'coinos' ? 'CoinOS' : 'Ark'} couldn't create an invoice — ${(error.cause as Error)?.message ?? error.message}`;
                } else if (error instanceof PaymentFailedError) {
                    const causeMsg = (error.cause as Error)?.message ?? error.message;
                    // Strike's BALANCE_TOO_LOW response means the trade
                    // hasn't fully settled yet. Tell the user instead of
                    // surfacing the raw 422 trace.
                    if (/BALANCE_TOO_LOW|Insufficient funds/i.test(causeMsg)) {
                        message = 'Your purchase succeeded but Strike\'s balance hasn\'t settled yet. Try the swap from Home → Swap in a few seconds.';
                    } else {
                        message = `Strike payment failed — ${causeMsg}`;
                    }
                } else if (error instanceof LightningSwapError) {
                    message = error.message;
                } else if (error instanceof Error) {
                    message = error.message;
                }
                SimpleToast.show(message, SimpleToast.LONG);
                // Fall back to the Transaction success screen so the
                // user at least sees the BUY landed; the CoinOS/Ark
                // balance will refresh on Home pull-to-refresh.
                dispatchNavigate('Transaction', {
                    matchedRate, currency, type, value, converted, receiveType, isSats, to, item: paymentQuoteData,
                });
            }
            return;
        }

        // dest is 'hot' | 'cold' — inline on-chain withdrawal from
        // Strike. The destination address and selected fee tier were
        // resolved up-front on this same screen (vaultDepositAddress /
        // selectedVaultDepositTier), so the user shouldn't have to
        // confirm a second ReviewPayment. After the BUY's 6s settle, we
        // create a fresh on-chain payment quote and execute it in one
        // shot, then drop the user on the broadcast success screen.
        // If pre-resolve failed (no address or no tier), fall back to
        // the legacy two-step flow rather than dropping the user.
        const address = vaultDepositAddress;
        const tier = selectedVaultDepositTier;
        const fiatPerBtc = Number(matchedRate) || 0;
        const convertedFiat = (purchasedSats * fiatPerBtc * btc(1)).toFixed(2);

        if (!address || !tier) {
            const targetWallet =
                dest === 'cold'
                    ? wallets.find((w: any) => w.getID() === coldStorageWalletID)
                    : wallets.find((w: any) => w.getID() === hotVaultWalletID);
            if (!targetWallet) {
                dispatchNavigate('Transaction', { matchedRate, currency, type, value, converted, receiveType, isSats, to, item: paymentQuoteData });
                return;
            }
            let resolved: string | undefined;
            try {
                resolved = await Promise.race<any>([
                    targetWallet.getAddressAsync?.(),
                    new Promise(resolve => setTimeout(() => resolve(undefined), 1500)),
                ]);
            } catch (_) {}
            if (!resolved && targetWallet._getExternalAddressByIndex) {
                try {
                    resolved = targetWallet._getExternalAddressByIndex(targetWallet.getNextFreeAddressIndex());
                } catch (_) {}
            }
            if (!resolved) {
                dispatchNavigate('Transaction', { matchedRate, currency, type, value, converted, receiveType, isSats, to, item: paymentQuoteData });
                return;
            }
            dispatchNavigate('ReviewPayment', {
                value: purchasedSats,
                converted: convertedFiat,
                isSats: true,
                to: resolved,
                fees: 0,
                total: btc(purchasedSats),
                matchedRate,
                currency,
                type: 'bitcoin',
                feeForBamskki: 0,
                recommendedFee: undefined,
                vaultTab: dest === 'cold',
                receiveType: false,
                wallet: targetWallet,
                isWithdrawal: true,
            });
            return;
        }

        try {
            if (__DEV__) console.log(`[BUY → ${dest}] inline withdrawal: address=${address} tier=${tier?.id} sats=${purchasedSats}`);
            // Mirror the swap path: 6s settle window so Strike's BUY
            // lands in the BTC sub-balance before we reference it.
            buyStepStart('Waiting for Strike to settle the trade…');
            await new Promise(resolve => setTimeout(resolve, 6000));
            buyStepStart(`Sending ${purchasedSats.toLocaleString()} sats on-chain to ${dest === 'cold' ? 'Cold Vault' : 'Hot Vault'}…`);

            // Fresh on-chain quote for the just-purchased sats. INCLUSIVE
            // fee policy means Strike subtracts the tier fee from the
            // sourced amount; we ask for (purchased - tierFee) so the
            // user receives exactly that on-chain.
            const tierFee = Number(tier?.estimatedFee?.amount || 0);
            const quotePayload = {
                btcAddress: address,
                sourceCurrency: 'BTC',
                amount: {
                    amount: btc(purchasedSats) - tierFee,
                    currency: 'BTC',
                    feePolicy: 'INCLUSIVE',
                },
                description: '',
                onchainTierId: tier.id,
            };
            const quote = await getPaymentQoute('onchain', quotePayload);
            if (!quote?.paymentQuoteId) {
                throw new Error(quote?.data?.message || 'Failed to create on-chain quote');
            }
            const result = await getPaymentQouteByOnChain(quotePayload, quote.paymentQuoteId);
            if (result?.data?.message && !result?.id) {
                throw new Error(result?.data?.message);
            }
            buyStepFinish('done',
                `${purchasedSats.toLocaleString()} sats sent to ${dest === 'cold' ? 'Cold Vault' : 'Hot Vault'}`);
            // Match the coinos/ark swap success UX: Transaction screen
            // with type='BUY' renders "Purchase Complete", and the
            // swappedTo subtitle adds the "→ Swapped to <vault>" note
            // so the user sees the same single-shot completion banner
            // regardless of destination rail.
            dispatchNavigate('Transaction', {
                matchedRate,
                currency,
                type: 'BUY',
                value: purchasedSats,
                converted: convertedFiat,
                isSats: true,
                to: address,
                item: result,
                swappedTo: dest === 'cold' ? 'Cold Vault' : 'Hot Vault',
            });
        } catch (e) {
            buyStepFinish('failed', 'Purchase succeeded but the withdrawal failed. Your sats are safe in Strike.');
            if (__DEV__) console.error(`[BUY → ${dest}] inline withdrawal failed:`, e);
            const message = e instanceof Error ? e.message : 'Withdrawal failed';
            SimpleToast.show(`Purchase succeeded but withdrawal failed (${message}). Find the BTC in Strike → use Home → Send to retry.`, SimpleToast.LONG);
            dispatchNavigate('Transaction', { matchedRate, currency, type, value, converted, receiveType, isSats, to, item: paymentQuoteData });
        }
    };

    const handleSendSats = async () => {
        setIsSendLoading(true);
        console.log('value: ', value, converted)
        const amount =  receiveType ? isSats ? value : converted : isSats ? converted : value;
        if(type == "SELL" || type == "BUY"){
            // Cold-vault destination requires the user to confirm the
            // address was verified on the hardware device before the
            // purchase + on-chain payout fires. Mirrors the same gate
            // the standalone vault-withdraw flow uses (see line ~887).
            if (type === 'BUY' && purchaseDest === 'cold' && !isCheck) {
                SimpleToast.show("Please verify the destination address", SimpleToast.SHORT);
                setIsSendLoading(false);
                return;
            }
            // Narrate the purchase leg. Intended sats from the keyboard;
            // the settled figure (Strike's quote target) replaces it in
            // the done-line once the 202 lands.
            const intendedSats = Math.round(isSats ? Number(value) || 0 : Number(converted) || 0);
            clearBuyProgress();
            if (type === 'BUY') {
                buyStepStart(`Purchasing ${intendedSats.toLocaleString()} sats from Strike…`);
            }
            try {
                console.log('paymentQuoteData: ', paymentQuoteData)
                const response = await executeFiatExchangeQuote(paymentQuoteData?.id);
                console.log('response executeFiatExchangeQuote: ', response)
                if(response?.status === 202){
                    if (__DEV__) console.log(`[BUY] 202 OK, type=${type}, purchaseDest=${purchaseDest}`);
                    if (type === 'BUY') {
                        const boughtBtc = Number(paymentQuoteData?.target?.amount) || 0;
                        const boughtSats = Math.floor(boughtBtc * SATS);
                        buyStepFinish('done',
                            `${(boughtSats > 0 ? boughtSats : intendedSats).toLocaleString()} sats purchased from Strike`);
                    }
                    // BUY routes by destination. SELL keeps the legacy
                    // single-screen flow (sale completes → Transaction
                    // success animation). The picker UI is BUY-only.
                    if (type === 'BUY' && purchaseDest !== 'strike') {
                        await routePurchasedBtc(purchaseDest);
                    } else {
                        dispatchNavigate('Transaction', { matchedRate, currency, type, value, converted, receiveType, isSats, to, item: paymentQuoteData });
                    }
                } else {
                    if (type === 'BUY') buyStepFinish('failed', 'Purchase failed. Please try again.');
                    SimpleToast.show(response?.data?.message ? response?.data?.message + " Please Try again" : 'Failed to execute payment. Please try again.', SimpleToast.SHORT)
                    handleFiatPayment()
                }
            } catch (error) {
                if (type === 'BUY') buyStepFinish('failed', 'Purchase failed. Check your connection and try again.');
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
                    // Mirror the omit-amount-when-invoice-has-amount rule
                    // from handlePaymentQuote — Strike returns the same
                    // "cannot specify the amount for the non-zero amount
                    // invoice" error if we double-specify here too.
                    const hasOwnAmount = invoiceHasAmount(to);
                    const payload = hasOwnAmount
                        ? {
                              lnInvoice: to,
                              sourceCurrency: 'BTC',
                              description: note,
                          }
                        : {
                              lnInvoice: to,
                              sourceCurrency: 'BTC',
                              amount: {
                                  amount: Number(amount),
                                  currency: currency || "USD",
                                  feePolicy: "INCLUSIVE"
                              },
                              description: note
                          };
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
                        dispatchNavigate('TransactionBroadCast', { matchedRate, currency, type, value, converted, receiveType, isSats, to, item: response, strikePending: true });
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
        const fromFeeKeys = Object.keys(recommendedFee ?? {});
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
        const fromFeeKeys = Object.keys(recommendedFee ?? {});
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
        // Fee is always in sats. `value` may be sats OR fiat depending on
        // `isSats` (set by the dispatcher screen): WithdrawList passes
        // value=sats/isSats=true, but the Strike post-purchase route and
        // some BUY paths pass value=USD/isSats=false with converted=sats.
        // Always reduce to sats so the percentage is meaningful, otherwise
        // dividing sats by USD produces nonsense (e.g. 1701 sats / $5 → 34020%).
        const amountSats = isSats ? Number(value || 0) : Number(converted || 0);
        if (!amountSats) return 0;
        return (Number(fee || 0) / amountSats) * 100;
    }

    console.log('strikeFees: ', value, to, type, recommendedFee)
    return (
        <ScreenLayout showToolbar isBackButton title={isWithdrawal ? "Review Withdrawal" : type === 'BUY' ? "Review Purchase Order" : type === 'SELL' ? "Review Sell Order" : "Review Payment"}>
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
                    {/* `marginTop: 10` pushes amount + spent-from + trading-fees
                        rows down 10pt as a group. The DEPOSIT TO block
                        below subtracts the same 10pt off its own marginTop
                        so its position stays put relative to the screen. */}
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginRight: 15, marginTop: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                            <TextViewV2 keytext={type == 'SELL' ? "You will sell: " : type == 'BUY' ? "You will receive: " : "Recipient will get: "} text={isSats ? `${value} sats ~ ${getStrikeCurrency(currency || 'USD')}${converted}` : `${getStrikeCurrency(currency || 'USD')}${value} ~ ${converted} sats`} textStyle={styles.price} containerStyle={{ marginBottom: 10 }} />
                            {type === 'BUY' && (
                                // UTXO-tier capsule next to the amount —
                                // visualizes the purchased sat-bucket
                                // (white/orange/green/blue) so the user
                                // sees what tier their purchase lands in
                                // before they slide to confirm. Same
                                // CustomProgressBar used in StrikeView.
                                <View style={{ marginLeft: 8, marginTop: 2 }}>
                                    <CustomProgressBar value={Number(isSats ? value : converted) || 0} />
                                </View>
                            )}
                        </View>
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
                    <TextViewV2 keytext={type === 'BUY' ? "Spent from: " : "Sent from: "} text={receiveType ? "Coinos Lightning Account" : type == 'SELL' || type == 'BUY' ? "Strike Fiat Account" : "Strike Lightning Account"} containerStyle={{ marginBottom: 10 }} />
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
                                    fontSize: 12,
                                    marginTop: 3,
                                    fontFamily: 'monospace',
                                    color: vaultTab ? colors.blueText : colors.greenShadow
                                })}>{"Vault Address: "}{to}</Text>
                                <TouchableOpacity onPress={() => setShowAddressQR(true)} style={{ marginRight: 8 }}>
                                    <Icon name="qrcode" type="font-awesome" color={vaultTab ? colors.blueText : colors.greenShadow} size={20} />
                                </TouchableOpacity>
                                <Image source={Edit} style={styles.editImage} resizeMode='contain' />
                            </TouchableOpacity>
                        </View>
                    : to.length > 0 &&
                        <View style={{ marginHorizontal: 12, marginBottom: 10 }}>
                            <Text bold style={{fontSize: 18}}>{"To: "}</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                                <Text style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', color: '#CCC' }}>{to}</Text>
                                {!to.includes('@') && to.length > 20 && (
                                    <TouchableOpacity onPress={() => setShowAddressQR(true)} style={{ marginLeft: 8 }}>
                                        <Icon name="qrcode" type="font-awesome" color="#CCC" size={22} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
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
                                                    {Object.entries(recommendedFee ?? {}).map(([feeKey, feeValue], index) => (
                                                        feeKey !== 'minimumFee' && (
                                                            <TouchableOpacity
                                                                key={feeKey}
                                                                style={{ paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: index < Object.keys(recommendedFee ?? {}).length - 2 ? 1 : 0, borderBottomColor: '#333', backgroundColor: selectedFeeName === feeKey ? colors.primary : 'transparent' }}
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
                                        {selectedStrikeFee && (() => {
                                // See handleWithdrawalFee above for why we reduce
                                // to sats. `value` can be USD when the dispatcher
                                // passes isSats=false (Strike fiat→BTC review etc.),
                                // and dividing sats-fee by USD-amount yields the
                                // 34020%-style nonsense Bam reported.
                                const feeSats = Number(selectedStrikeFee?.estimatedFee?.amount || 0) * 100000000;
                                const amountSats = isSats ? Number(value || 0) : Number(converted || 0);
                                const pct = amountSats > 0 ? ((feeSats / amountSats) * 100).toFixed(1) : '0';
                                const usdAmt = (Number(selectedStrikeFee?.estimatedFee?.amount || 0) * (matchedRate || 0)).toFixed(2);
                                return (
                                    <Text bold style={{ fontSize: 18 }}>Fee: <Text italic style={{ fontSize: 16, fontWeight: 'normal' }}>{`~ ${feeSats.toFixed(0)} sats (~${getStrikeCurrency(currency || 'USD')}${usdAmt}) (${pct}%)`}</Text></Text>
                                );
                            })()}
                                    </View>
                                </View>
                            }
                            {/* <TextViewV2 keytext="Coinos Fee + Service Fee:  " text={` ~   ${(networkFee || 0) + (bamskiiFee || 0)} sats`} /> */}
                            {receiveType && <TextViewV2 keytext="Coinos Fee:  " text={` ~   ${(networkFee || 0)} sats`} /> }
                            {receiveType && <TextViewV2 keytext="Total Fee:  " text={isWithdrawal ? ` ~   ${(networkFee || 0) + (estimatedFee || 0)} sats (~${handleWithdrawalFee((networkFee || 0) + (estimatedFee || 0)).toFixed(0)}%)` : ` ~   ${(networkFee || 0) + (estimatedFee || 0)} sats (~0.2%)`} />}
                            {!receiveType && !selectedStrikeFee && paymentQuoteData && (
                                <TextViewV2
                                    keytext="Trading fees:  "
                                    text={buildTradingFeeText(
                                        paymentQuoteData,
                                        value,
                                        converted,
                                        isSats,
                                        currency,
                                        matchedRate,
                                        route?.params?.matchedRate,
                                    )}
                                    containerStyle={{ marginBottom: 10 }}
                                />
                            )}
                        </>
                        :
                        // BUY / SELL flows always land here (outer
                        // ternary only enters the bitcoin/liquid block).
                        // Force "Trading fees:" with full sats / fiat /
                        // percentage breakdown — the helper handles
                        // null paymentQuoteData gracefully (renders 0s)
                        // so the label flips immediately even before
                        // the quote resolves.
                        (type === 'BUY' || type === 'SELL') ?
                            <TextViewV2
                                keytext="Trading fees:  "
                                text={buildTradingFeeText(
                                    paymentQuoteData,
                                    value,
                                    converted,
                                    isSats,
                                    currency,
                                    matchedRate,
                                    route?.params?.matchedRate,
                                )}
                            />
                        :
                        <TextView keytext="Fees:  " text={` ~   ${receiveType ? estimatedFee : paymentQuoteData && to?.length > 0 ? usdToSats(paymentQuoteData?.totalFee?.amount || 0, (matchedRate || 0)) : paymentQuoteData && to.length == 0 ? usdToSats(paymentQuoteData?.fee?.amount || 0, (matchedRate || 0)) : 0} sats`} />
                    }
                    {/* Post-purchase destination picker (BUY-only). Sits
                        directly below the trading-fees rows so the user
                        chooses what to do with the freshly-bought BTC as
                        part of reviewing the same trade. Default is
                        Strike (custodial); other tiles auto-route to a
                        swap (CoinOS/Ark) or an on-chain withdrawal
                        (Hot/Cold) once the trade clears. */}
                    {type === 'BUY' && (canDestCoinos || canDestArk || canDestHot || canDestCold) && (
                        <View style={destPicker.container}>
                            <Text bold style={destPicker.label}>DEPOSIT TO</Text>
                            {/* Lightning rails on row 1 (Strike default,
                                CoinOS, Ark) and on-chain vaults on row 2
                                (Hot, Cold). Two separate Views with no
                                flexWrap so the rails always group
                                together regardless of how many tiles are
                                visible. */}
                            <View style={destPicker.row}>
                                <DestPickerTile
                                    label="Strike"
                                    isLogo
                                    iconSource={StrikeFull}
                                    outlineColor={colors.pink.shadowTopNew}
                                    selected={purchaseDest === 'strike'}
                                    onPress={() => setPurchaseDest('strike')}
                                />
                                {canDestCoinos && (
                                    <DestPickerTile
                                        label="CoinOS"
                                        isLogo
                                        iconSource={CoinOS}
                                        outlineColor={colors.pink.shadowTopNew}
                                        selected={purchaseDest === 'coinos'}
                                        onPress={() => setPurchaseDest('coinos')}
                                    />
                                )}
                                {canDestArk && (
                                    <DestPickerTile
                                        label="Bark Vault"
                                        arkBolt
                                        // Gray ring when unselected, bright
                                        // yellow when selected — matches the
                                        // gray→color transition every other
                                        // tile uses (Bam: not "dim yellow to
                                        // yellow"). Drops the
                                        // unselectedOutlineColor override.
                                        outlineColor={colors.ark.light}
                                        selected={purchaseDest === 'ark'}
                                        onPress={() => setPurchaseDest('ark')}
                                    />
                                )}
                                {/* Invisible spacers fill the unused
                                    slots so the lone visible tile (or
                                    pair of tiles) stays at ~33% width
                                    instead of stretching to fill the
                                    row. Total slots reserved = 3
                                    (Strike + CoinOS + Ark). */}
                                {1 + (canDestCoinos ? 1 : 0) + (canDestArk ? 1 : 0) < 3 && (
                                    <View style={{ flex: 1 }} pointerEvents="none" />
                                )}
                                {1 + (canDestCoinos ? 1 : 0) + (canDestArk ? 1 : 0) < 2 && (
                                    <View style={{ flex: 1 }} pointerEvents="none" />
                                )}
                            </View>
                            {(canDestHot || canDestCold) && (
                                <View style={destPicker.row}>
                                    {canDestHot && (
                                        <DestPickerTile
                                            label="Hot Vault"
                                            iconSource={Hot}
                                            iconStyle={{ width: 22, height: 30 }}
                                            outlineColor={colors.green}
                                            selected={purchaseDest === 'hot'}
                                            onPress={() => setPurchaseDest('hot')}
                                        />
                                    )}
                                    {canDestCold && (
                                        <DestPickerTile
                                            label="Cold Vault"
                                            iconSource={Cold1}
                                            iconStyle={{ width: 30, height: 22 }}
                                            outlineColor={colors.blueText}
                                            selected={purchaseDest === 'cold'}
                                            onPress={() => setPurchaseDest('cold')}
                                        />
                                    )}
                                    {/* Invisible spacer keeps a lone tile
                                        (only Hot or only Cold connected)
                                        constrained to ~half the row so
                                        flex:1 doesn't stretch it across
                                        the full width. */}
                                    {(canDestHot ? 1 : 0) + (canDestCold ? 1 : 0) === 1 && (
                                        <View style={{ flex: 1 }} pointerEvents="none" />
                                    )}
                                </View>
                            )}

                            {/* Inline withdraw preview — appears the
                                moment a vault tile is selected. Shows
                                the resolved receive address + Strike's
                                3–4 on-chain fee tiers (with sats /
                                fiat / pct preview). The user picks a
                                tier here; routePurchasedBtc carries it
                                into the post-purchase withdrawal
                                review. */}
                            {(purchaseDest === 'hot' || purchaseDest === 'cold') && (
                                <View style={{ marginTop: 14 }}>
                                    <Text bold style={destPicker.label}>WITHDRAW ADDRESS</Text>
                                    {/* Tap to open the wallet's full
                                        address list — same picker the
                                        regular Strike→vault withdraw
                                        flow uses. WalletAddresses sees
                                        `selectForBuyDeposit: true` and
                                        navigates back here with
                                        `selectedDepositAddress`, which
                                        the effect above writes into
                                        vaultDepositAddress. */}
                                    <TouchableOpacity
                                        activeOpacity={0.65}
                                        onPress={() => {
                                            const targetWalletId =
                                                purchaseDest === 'cold'
                                                    ? coldStorageWalletID
                                                    : hotVaultWalletID;
                                            if (!targetWalletId) return;
                                            dispatchNavigate('WalletAddresses', {
                                                walletID: targetWalletId,
                                                isTouchable: true,
                                                selectForBuyDeposit: true,
                                                vaultTab: purchaseDest === 'cold',
                                            });
                                        }}
                                        style={{
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            paddingHorizontal: 8,
                                            paddingVertical: 10,
                                            borderRadius: 10,
                                            borderWidth: 1,
                                            borderColor: '#444',
                                            backgroundColor: colors.black.bg,
                                            marginBottom: 12,
                                        }}
                                    >
                                        <Text
                                            style={{
                                                color: '#ddd',
                                                fontSize: 12,
                                                flex: 1,
                                                marginRight: 8,
                                            }}
                                            numberOfLines={1}
                                            ellipsizeMode="middle"
                                        >
                                            {vaultDepositAddress || 'Resolving address…'}
                                        </Text>
                                        <Text style={{ color: '#888', fontSize: 11 }}>change ›</Text>
                                    </TouchableOpacity>

                                    <Text bold style={destPicker.label}>NETWORK FEE</Text>
                                    {vaultDepositTiersLoading && (
                                        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
                                            <ActivityIndicator size="small" color={colors.gray.light} />
                                            <Text style={{ color: '#888', marginLeft: 8, fontSize: 12 }}>Fetching fee options…</Text>
                                        </View>
                                    )}
                                    {!vaultDepositTiersLoading && vaultDepositTiers.length === 0 && vaultDepositAddress.length > 0 && (
                                        <Text style={{ color: '#888', fontSize: 12, paddingHorizontal: 4 }}>
                                            No fee options yet. Make sure your purchase amount is above Strike's minimum.
                                        </Text>
                                    )}
                                    {!vaultDepositTiersLoading && vaultDepositTiers.length > 0 && (
                                        <View style={{ flexDirection: 'row', gap: 8 as any, marginBottom: 4 }}>
                                            {vaultDepositTiers.map((tier: any) => {
                                                const tierBtc = Number(tier?.estimatedFee?.amount || 0);
                                                const tierSats = (tierBtc * SATS).toFixed(0);
                                                const rate = Number(matchedRate) || Number(route?.params?.matchedRate) || 0;
                                                const tierFiat = (tierBtc * rate).toFixed(2);
                                                const purchasedSats = Number(isSats ? value : converted) || 0;
                                                const tierPct = purchasedSats > 0
                                                    ? ((tierBtc * SATS) / purchasedSats) * 100
                                                    : 0;
                                                const tierPctStr = tierPct === 0
                                                    ? '0%'
                                                    : tierPct < 0.01 ? '<0.01%' : `${tierPct.toFixed(tierPct < 1 ? 2 : 1)}%`;
                                                const isSelected = selectedVaultDepositTier?.id === tier.id;
                                                return (
                                                    <TouchableOpacity
                                                        key={tier.id}
                                                        onPress={() => setSelectedVaultDepositTier(tier)}
                                                        activeOpacity={0.75}
                                                        style={{
                                                            flex: 1,
                                                            paddingVertical: 8,
                                                            paddingHorizontal: 6,
                                                            borderRadius: 12,
                                                            borderWidth: 2,
                                                            borderColor: isSelected
                                                                ? (purchaseDest === 'cold' ? colors.blueText : colors.green)
                                                                : colors.gray.disable,
                                                            backgroundColor: colors.black.bg,
                                                            alignItems: 'center',
                                                        }}
                                                    >
                                                        <Text bold style={{ fontSize: 13, color: '#fff' }}>{tier.label}</Text>
                                                        <Text style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>{tierSats} sats</Text>
                                                        <Text style={{ fontSize: 10, color: '#bbb' }}>~{getStrikeCurrency(currency || 'USD')}{tierFiat}</Text>
                                                        <Text style={{ fontSize: 10, color: '#bbb' }}>{tierPctStr}</Text>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </View>
                                    )}

                                    {/* Cold-storage hardware-verification
                                        gate. Mirrors the warning + checkbox
                                        used by the standalone vault-withdraw
                                        review (see line ~1280 area) — the
                                        BUY → Cold flow goes on-chain to a
                                        hardware-derived address, so the user
                                        must confirm they've verified it on
                                        the device before swiping. The
                                        existing `isCheck` state is reused;
                                        handleSendSats blocks the swipe when
                                        this flag is false in the cold path. */}
                                    {purchaseDest === 'cold' && (
                                        <View style={{ marginTop: 14 }}>
                                            <Text style={{ fontSize: 13, color: '#FFFFFF', marginBottom: 6, paddingHorizontal: 4 }}>
                                                ⚠️ DO NOT transfer to this address without verifying its authenticity on your hardware device!
                                            </Text>
                                            <TouchableOpacity
                                                activeOpacity={0.7}
                                                onPress={() => setIsCheck(!isCheck)}
                                                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 4, alignSelf: 'flex-start' }}
                                            >
                                                <View style={styles.checkView}>
                                                    {isCheck && <Image source={Check} style={styles.checkImage} resizeMode="contain" />}
                                                </View>
                                                <Text italic style={{ color: colors.white, marginLeft: 10, fontSize: 14 }}>
                                                    I verified this address
                                                </Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}
                                </View>
                            )}
                        </View>
                    )}
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
            {/* BUY progress narration — fills the multi-step loading window
                (purchase → settle → swap/withdraw) with live status lines.
                Persists after a failure (cleared on the next slide) so the
                user can read what happened. */}
            {buyProgress.length > 0 && (
                <View style={{ marginHorizontal: 24, marginBottom: 12, padding: 12, borderRadius: 10, backgroundColor: '#1a1a1a' }}>
                    {buyProgress.map((s, i) => (
                        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 3 }}>
                            {(s.state === 'active' || s.state === 'slow') ? (
                                <ActivityIndicator size="small" color={s.state === 'slow' ? '#FFD54F' : colors.green} />
                            ) : (
                                <Text bold style={{ color: s.state === 'done' ? colors.green : colors.redLight, fontSize: 14, width: 20, textAlign: 'center' }}>
                                    {s.state === 'done' ? '✓' : '✗'}
                                </Text>
                            )}
                            <Text style={{ marginLeft: 8, flexShrink: 1, fontSize: 13, lineHeight: 18, color: s.state === 'failed' ? colors.redLight : s.state === 'slow' ? '#FFD54F' : s.state === 'done' ? '#CCC' : '#FFF' }}>
                                {s.text}
                            </Text>
                        </View>
                    ))}
                </View>
            )}
            <View style={styles.container}>
                {type === 'bitcoin' || type == "SELL" || type == "BUY" ?
                    <SwipeButton title={isWithdrawal ? 'Slide to Withdraw' : type === 'BUY' ? 'Slide to Purchase' : type === 'SELL' ? 'Slide to Sell' : 'Slide to Send'} ref={swipeButtonRef} onToggle={handleToggle} isLoading={isSendLoading} />
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
            {/* Address QR Modal — for hardware wallet verification */}
            <ReactNativeModal
                isVisible={showAddressQR}
                onBackdropPress={() => setShowAddressQR(false)}
                onBackButtonPress={() => setShowAddressQR(false)}
                style={{ alignItems: 'center', justifyContent: 'center' }}
            >
                <View style={{ backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24, alignItems: 'center', width: '85%' }}>
                    <Text bold style={{ fontSize: 16, marginBottom: 4 }}>Verify Address</Text>
                    <Text style={{ fontSize: 12, color: '#888', marginBottom: 16, textAlign: 'center' }}>
                        Scan with your hardware wallet to confirm
                    </Text>
                    <View style={{ backgroundColor: 'white', padding: 12, borderRadius: 12 }}>
                        <QRCode value={to} size={200} color="black" backgroundColor="white" />
                    </View>
                    <Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#CCC', marginTop: 16, textAlign: 'center', lineHeight: 18 }}>
                        {to}
                    </Text>
                    <TouchableOpacity
                        onPress={() => setShowAddressQR(false)}
                        style={{ marginTop: 20, paddingVertical: 10, paddingHorizontal: 32, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)' }}
                    >
                        <Text style={{ fontSize: 14, color: '#FFF' }}>Close</Text>
                    </TouchableOpacity>
                </View>
            </ReactNativeModal>
        </ScreenLayout>
    )
}

/**
 * Compact tile for the BUY-flow destination picker. Pulls together the
 * three render variants the picker uses: a wordmark logo (Strike,
 * CoinOS), the Ark lightning-bolt + text combo, and a vault icon + text.
 * Outline gets the per-rail colour when selected, gray otherwise — same
 * convention as the WithdrawList / TopupList / SwapSheet selection
 * styling.
 */
function DestPickerTile({
    label,
    isLogo,
    iconSource,
    iconStyle,
    arkBolt,
    outlineColor,
    unselectedOutlineColor,
    selected,
    onPress,
}: {
    label: string;
    isLogo?: boolean;
    iconSource?: any;
    iconStyle?: any;
    arkBolt?: boolean;
    outlineColor: string;
    /** Optional outline when not selected — defaults to neutral gray. Used by
     * the Ark tile to keep its yellow identity even in the unselected state,
     * so it can't be confused with the pink Lightning custodial tiles. */
    unselectedOutlineColor?: string;
    selected: boolean;
    onPress: () => void;
}) {
    return (
        <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.75}
            style={[
                destPicker.tile,
                { borderColor: selected ? outlineColor : (unselectedOutlineColor ?? colors.gray.disable) },
            ]}
        >
            {arkBolt ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Image
                        source={Electricity}
                        style={{ width: 12, height: 16, marginRight: 4, tintColor: '#FFFFFF' }}
                        resizeMode="contain"
                    />
                    <Text bold style={{ fontSize: 13, color: '#FFFFFF' }}>{label}</Text>
                </View>
            ) : isLogo ? (
                <Image
                    source={iconSource}
                    style={{ width: 60, height: 22 }}
                    resizeMode="contain"
                />
            ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {iconSource && (
                        <Image
                            source={iconSource}
                            style={[{ marginRight: 4 }, iconStyle]}
                            resizeMode="contain"
                        />
                    )}
                    <Text bold style={{ fontSize: 13, color: '#FFFFFF' }}>{label}</Text>
                </View>
            )}
        </TouchableOpacity>
    );
}

const destPicker = StyleSheet.create({
    container: {
        marginHorizontal: 20,
        // -4 was the previous lift (10pt up from original 6). This
        // additional -10 cancels the +10 marginTop the amount row above
        // got just below `styles.middle`, so the DEPOSIT TO block stays
        // anchored where it was while only amount/spent-from/trading
        // fees move down 10pt.
        marginTop: -14,
        marginBottom: 10,
    },
    label: {
        color: '#888',
        fontSize: 11,
        letterSpacing: 0.6,
        marginBottom: 8,
        marginLeft: 2,
    },
    row: {
        flexDirection: 'row',
        // No wrap — tiles in the same logical group (Lightning rails or
        // vaults) must always sit on the same line. Each tile uses
        // `flex: 1` so 2 / 3 tiles split the row evenly without
        // overflowing on narrow screens.
        gap: 8 as any,
    },
    tile: {
        flex: 1,
        height: 44,
        paddingHorizontal: 8,
        borderRadius: 14,
        borderWidth: 2,
        backgroundColor: colors.black.bg,
        alignItems: 'center',
        justifyContent: 'center',
        // `gap: 8` on the parent row handles inter-tile spacing —
        // dropping the per-tile marginRight prevents the right-most
        // tile from being pushed off the row edge.
        marginBottom: 8,
    },
});