import { Minus, Plus, Strike } from '@Cypher/assets/images'
import { Text } from '@Cypher/component-library'
import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Image, LayoutAnimation, TextInput, TouchableOpacity, View } from 'react-native'
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
import { getBankPaymentMethods, initiateDeposit, createPayout, initiatePayout, revokeStrikeToken } from '@Cypher/api/strikeAPIs'
import { bitcoinRecommendedFee } from '@Cypher/api/coinOSApis'
import { colors } from '@Cypher/style-guide'

interface Props {
    showLogo?: boolean;
    isShowButtons?: boolean;
    btcValue?: string;
    matchedRateStrike: number;
    currency: string;
}

function StrikeView({ showLogo = false, isShowButtons = false,
    btcValue = '$80,000 /BTC',
    matchedRateStrike,
    currency
}: Props) {
    // Use Strike API rate for Strike wallet, fall back to matchedRate prop if passed
    const matchedRate = matchedRateStrike;
    // Validate currency is a valid ISO 4217 code, fallback to USD
    const safeCurrency = (currency && /^[A-Z]{3}$/.test(currency)) ? currency : 'USD';
    const { strikeUser, clearStrikeAuth } = useAuthStore();
    const [dollarStrikeText, setDollarStrikeText] = useState(1000000);
    const navigation = useNavigation();
    const [showFiatPanel, setShowFiatPanel] = useState(false);
    const [fiatMode, setFiatMode] = useState<'DEPOSIT' | 'WITHDRAW'>('DEPOSIT');
    const [fiatAmount, setFiatAmount] = useState('');
    const [bankMethods, setBankMethods] = useState<any[]>([]);
    const [selectedBank, setSelectedBank] = useState<any>(null);
    const [fiatLoading, setFiatLoading] = useState(false);
    const [bankLoading, setBankLoading] = useState(false);

    /**
     * Price-direction indicator for the BTC exchange-rate text.
     *
     * Compares each new `matchedRate` to the previous reading:
     *   - new > prev  → green (price went up)
     *   - new < prev  → red (price went down)
     *   - equal / first reading → default (white)
     *
     * `prevRateRef` holds the last-seen rate WITHOUT triggering a re-render
     * (a useState would loop with the useEffect that sets it). The colored
     * state itself uses useState so the Text re-renders when direction
     * changes. The first non-zero reading establishes a baseline silently
     * (no green/red flash on cold mount).
     *
     * Cadence note: matchedRate updates whenever HomeScreen.handleUser()
     * runs — that's on Home focus, on auth changes, and after pull-to-
     * refresh. BlueWallet's underlying `updateExchangeRate` has a 30-min
     * cache + 10s debounce, but `getFiatRate` (called directly from
     * HomeScreen) bypasses that cache, so each focus = one fresh API hit.
     * Net: rate refreshes whenever the user returns to Home.
     */
    type RateDirection = 'flat' | 'up' | 'down';
    const [rateDirection, setRateDirection] = useState<RateDirection>('flat');
    const prevRateRef = useRef<number | null>(null);
    useEffect(() => {
        const next = Number(matchedRate) || 0;
        if (next <= 0) return; // ignore zero / unset readings
        const prev = prevRateRef.current;
        if (prev === null) {
            prevRateRef.current = next;
            return; // first non-zero reading sets the baseline silently
        }
        if (next === prev) return;
        setRateDirection(next > prev ? 'up' : 'down');
        prevRateRef.current = next;
    }, [matchedRate]);

    const rateColor =
        rateDirection === 'up' ? colors.green
            : rateDirection === 'down' ? colors.redLight
                : '#FFFFFF';

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

    /**
     * Straight to the confirmation screen, skipping the amount keyboard.
     *
     * Mirrors what BuyBitcoin's handleSendNext passes, because that screen is
     * still reachable via Edit Amount on the confirmation screen and both paths
     * must land ReviewPayment in the same shape.
     *
     * `recommendedFee` is fetched rather than omitted: a BUY routed to cold
     * storage reads it. A failure here is non-fatal, the confirmation screen
     * simply has no pre-fetched fee.
     */
    const goToBuyConfirmation = async (
      fiatAmount: number,
      satsAmount: number,
      fiatType: 'BUY' | 'SELL',
      fiatTotal: number,
    ) => {
      let recommendedFee: any;
      try {
        recommendedFee = await bitcoinRecommendedFee();
      } catch (err) {
        console.warn('[StrikeView] recommended fee lookup failed, continuing:', err);
      }
      dispatchNavigate('ReviewPayment', {
        currency: safeCurrency,
        matchedRate,
        fiatAmount,
        fiatTotal,
        fiatType,
        value: String(satsAmount),
        converted: fiatAmount.toFixed(2),
        isSats: true,
        to: '',
        fees: 0,
        type: fiatType,
        recommendedFee,
      });
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
      // Affordable capsule: go to the Strike purchase screen with the chosen
      // size prefilled. This previously routed to the generic Send flow, so
      // picking a capsule the user COULD afford opened a bitcoin send instead
      // of a purchase, while picking one they could NOT afford (the branch
      // above) correctly opened the purchase screen. `fiatTotal` is passed so
      // the MAX button still has the balance to work from.
      // The size is already chosen here, so the keyboard screen has nothing left
      // to ask. Go straight to confirmation. Routing via BuyBitcoin made it
      // render first and flash on screen, so its ReviewPayment params are built
      // here instead: `to` is '' because BuyBitcoin's `sender` defaults to '' for
      // a BUY, and `value` is the capsule size, which is what its own prefill
      // round-trips back to (amt = sats * rate / 1e8, then sats = amt / rate * 1e8).
      goToBuyConfirmation(amt, dollarStrikeText, "BUY", Number(strikeUser?.[1]?.available));
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
        // `available` is BTC, `dollarStrikeText` is sats, so this compared
        // across units and was true for every realistic balance. That sent
        // SELL down the insufficient-funds branch every time, which hid the
        // same mis-route the BUY path had.
        if(Number(strikeUser?.[0]?.available) * SATS < dollarStrikeText){
            // SimpleToast.show('Amount is exceeded', SimpleToast.SHORT);
            dispatchNavigate('BuyBitcoin', { currency: safeCurrency, matchedRate, fiatAmount: 0, fiatTotal: Number(strikeUser?.[0]?.available), fiatType: "SELL" });    
            return
        }
        goToBuyConfirmation(amt, dollarStrikeText, "SELL", Number(strikeUser?.[0]?.available));
    }

    const handleStrikeLogout = async () => {
        // Read the token BEFORE clearing, and do not await the revoke: local
        // state must clear immediately so a slow or failed network call can
        // never leave the user looking logged in with no way out.
        // revokeStrikeToken never throws.
        const tokenToRevoke = useAuthStore.getState().strikeToken;
        void revokeStrikeToken(tokenToRevoke);
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
                        {/* Left sideContainer: UTXO capsule + ₿UY.
                            Swapped with the Fiat Balance side so the capsule
                            sits in the card's left corner — Bam's request
                            after the RN 0.76 / Yoga 2 migration pushed the
                            capsule against the right edge of the
                            LinearBorderView. The capsule + ₿UY pair stay
                            together so the user's mental model (adjust
                            amount → press ₿UY) is preserved; only their
                            corner of the card changes. */}
                        <View style={styles.sideContainer}>
                            {/* linearFirstColors flattened to solid black so the
                                outer gradient layer collapses into the inner
                                background — visually removes the angular shadow
                                border around the UTXO capsule per Bam. */}
                            <BlackBGView
                                linearFirstStyle={styles.fiatBalanceBox2}
                                linearSecondStyle={styles.fiatBalanceBox3}
                                linearFirstColors={[colors.black.default, colors.black.default]}
                            >
                                <CustomProgressBar value={dollarStrikeText} />
                                <Text h3 bold >{dollarStrikeText >= 100_000_000 ? `${(dollarStrikeText / 100_000_000)} BTC` : `${formatStrikeNumber(dollarStrikeText)} sats`}</Text>
                                <Text h4 semibold>{getStrikeCurrency(safeCurrency) + (dollarStrikeText * (Number(matchedRate) || 0) * btc(1)).toFixed(2)}</Text>
                            </BlackBGView>
                            {/* BUY sits 5pt lower than SELL by default —
                                the capsule's marginTop:45 (vs fiatBalanceBox's
                                marginTop:40) introduced that gap. -20 here =
                                -15 (the universal upward shift Bam asked for)
                                + -5 (alignment correction with SELL). */}
                            <GradientView
                                style={[styles.sellBuyButton, { marginTop: -20 }]}
                                linearGradientStyle={styles.sellBuyGradient}
                                topShadowStyle={styles.topShadow}
                                bottomShadowStyle={styles.bottomShadow}
                                linearGradientStyleMain={styles.linearGradientStyleMain}
                                onPress={buyClickHandler}
                            >
                                <Text h3 bold center>₿UY</Text>
                            </GradientView>
                        </View>

                        {/* Right sideContainer: Fiat Balance + SELL. */}
                        <View style={styles.sideContainer}>
                            <View style={styles.fiatBalanceBox}>
                                {/* Slightly smaller than h2 (20pt) — 17pt
                                    matches the trimmed visual weight Bam
                                    asked for after the 10pt up nudge. */}
                                <Text h2 bold style={{ fontSize: 17 }}>Fiat Balance</Text>
                                <Text h2 bold style={{ fontSize: 17 }}>{`${getStrikeCurrency(safeCurrency)}${Number(strikeUser?.[1]?.available || 0).toFixed(2)}`}</Text>
                            </View>
                            {/* fiatBalanceBox.marginTop went 40 → 30 (Fiat
                                Balance up 10pt), which dragged SELL up 10pt
                                with it. -15 + 10 = -5 keeps SELL aligned
                                with BUY at its previous y-position. */}
                            <GradientView
                                style={[styles.sellBuyButton, { marginTop: -5 }]}
                                linearGradientStyle={styles.sellBuyGradient}
                                topShadowStyle={styles.topShadow}
                                bottomShadowStyle={styles.bottomShadow}
                                linearGradientStyleMain={styles.linearGradientStyleMain}
                                onPress={sellClickHandler}
                            >
                                <Text h3 bold center>SELL</Text>
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
            {/* Deposit/Withdraw Fiat Button */}
            {isShowButtons && (
                <TouchableOpacity
                    onPress={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        if (!showFiatPanel) {
                            // Fetch bank methods when opening
                            setBankLoading(true);
                            getBankPaymentMethods()
                                .then(res => {
                                    const methods = Array.isArray(res) ? res : res?.items || [];
                                    const readyMethods = methods.filter((m: any) => m?.state === 'READY');
                                    setBankMethods(readyMethods);
                                    if (readyMethods.length > 0 && !selectedBank) {
                                        setSelectedBank(readyMethods[0]);
                                    }
                                })
                                .catch(err => console.error('Error loading banks:', err))
                                .finally(() => setBankLoading(false));
                        }
                        setShowFiatPanel(!showFiatPanel);
                    }}
                    style={{
                        marginTop: 16,
                        paddingVertical: 10,
                        paddingHorizontal: 20,
                        borderRadius: 12,
                        borderWidth: 1.5,
                        borderColor: showFiatPanel ? '#FF65D4' : '#555',
                        backgroundColor: showFiatPanel ? 'rgba(255,101,212,0.08)' : 'transparent',
                        alignSelf: 'center',
                    }}
                >
                    <Text bold style={{ fontSize: 14, color: showFiatPanel ? '#FF65D4' : '#CCC', textAlign: 'center' }}>
                        {showFiatPanel ? 'Close' : 'Deposit / Withdraw Fiat'}
                    </Text>
                </TouchableOpacity>
            )}

            {/* Fiat Deposit/Withdraw Panel */}
            {showFiatPanel && (
                <View style={{
                    marginTop: 12,
                    backgroundColor: '#1a1a1a',
                    borderRadius: 16,
                    padding: 16,
                    marginHorizontal: 4,
                }}>
                    {/* Mode Toggle */}
                    <View style={{ flexDirection: 'row', marginBottom: 14, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#333' }}>
                        <TouchableOpacity
                            onPress={() => { setFiatMode('DEPOSIT'); setFiatAmount(''); }}
                            style={{
                                flex: 1,
                                paddingVertical: 10,
                                backgroundColor: fiatMode === 'DEPOSIT' ? '#1B6B3A' : 'transparent',
                                alignItems: 'center',
                            }}
                        >
                            <Text bold style={{ color: fiatMode === 'DEPOSIT' ? '#FFF' : '#888', fontSize: 14 }}>Deposit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => { setFiatMode('WITHDRAW'); setFiatAmount(''); }}
                            style={{
                                flex: 1,
                                paddingVertical: 10,
                                backgroundColor: fiatMode === 'WITHDRAW' ? '#8B3A3A' : 'transparent',
                                alignItems: 'center',
                            }}
                        >
                            <Text bold style={{ color: fiatMode === 'WITHDRAW' ? '#FFF' : '#888', fontSize: 14 }}>Withdraw</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Bank Account Selector */}
                    {bankLoading ? (
                        <ActivityIndicator size="small" color="#FF65D4" style={{ marginVertical: 10 }} />
                    ) : bankMethods.length === 0 ? (
                        <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                            <Text style={{ color: '#888', fontSize: 13, textAlign: 'center' }}>
                                No bank accounts linked.{'\n'}Connect a bank account in the Strike app first.
                            </Text>
                        </View>
                    ) : (
                        <>
                            <Text style={{ color: '#AAA', fontSize: 12, marginBottom: 6 }}>
                                {fiatMode === 'DEPOSIT' ? 'Deposit from:' : 'Withdraw to:'}
                            </Text>
                            {bankMethods.map((bank: any) => (
                                <TouchableOpacity
                                    key={bank.id}
                                    onPress={() => setSelectedBank(bank)}
                                    style={{
                                        flexDirection: 'row',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        paddingVertical: 10,
                                        paddingHorizontal: 12,
                                        borderRadius: 10,
                                        borderWidth: 1.5,
                                        borderColor: selectedBank?.id === bank.id ? '#FF65D4' : '#333',
                                        backgroundColor: selectedBank?.id === bank.id ? 'rgba(255,101,212,0.06)' : 'transparent',
                                        marginBottom: 6,
                                    }}
                                >
                                    <View>
                                        <Text bold style={{ fontSize: 14 }}>{bank.bankName || 'Bank'}</Text>
                                        <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                                            ****{bank.accountNumber?.slice(-4) || '????'} {bank.transferType ? `(${bank.transferType})` : ''}
                                        </Text>
                                    </View>
                                    {selectedBank?.id === bank.id && (
                                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF65D4' }} />
                                    )}
                                </TouchableOpacity>
                            ))}

                            {/* Amount Input */}
                            <View style={{ marginTop: 12 }}>
                                <Text style={{ color: '#AAA', fontSize: 12, marginBottom: 6 }}>Amount ({safeCurrency})</Text>
                                <View style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    borderWidth: 1.5,
                                    borderColor: '#444',
                                    borderRadius: 10,
                                    paddingHorizontal: 12,
                                    height: 44,
                                    backgroundColor: '#111',
                                }}>
                                    <Text bold style={{ fontSize: 18, color: '#888', marginRight: 4 }}>
                                        {getStrikeCurrency(safeCurrency)}
                                    </Text>
                                    <TextInput
                                        value={fiatAmount}
                                        onChangeText={setFiatAmount}
                                        placeholder="0.00"
                                        placeholderTextColor="#555"
                                        keyboardType="decimal-pad"
                                        style={{
                                            flex: 1,
                                            color: '#FFF',
                                            fontSize: 18,
                                            fontFamily: 'Lato-Bold',
                                            padding: 0,
                                        }}
                                    />
                                </View>
                                {fiatMode === 'WITHDRAW' && (
                                    <Text style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                                        Available: {getStrikeCurrency(safeCurrency)}{Number(strikeUser?.[1]?.available || 0).toFixed(2)}
                                    </Text>
                                )}
                            </View>

                            {/* Confirm Button */}
                            <TouchableOpacity
                                disabled={fiatLoading || !fiatAmount || Number(fiatAmount) <= 0 || !selectedBank}
                                onPress={() => {
                                    const amt = Number(fiatAmount);
                                    if (!amt || amt <= 0) {
                                        SimpleToast.show('Enter a valid amount', SimpleToast.SHORT);
                                        return;
                                    }
                                    if (fiatMode === 'WITHDRAW' && amt > Number(strikeUser?.[1]?.available || 0)) {
                                        SimpleToast.show('Amount exceeds available balance', SimpleToast.SHORT);
                                        return;
                                    }
                                    Alert.alert(
                                        `Confirm ${fiatMode === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'}`,
                                        `${fiatMode === 'DEPOSIT' ? 'Deposit' : 'Withdraw'} ${getStrikeCurrency(safeCurrency)}${amt.toFixed(2)} ${fiatMode === 'DEPOSIT' ? 'from' : 'to'} ${selectedBank?.bankName || 'bank'} (****${selectedBank?.accountNumber?.slice(-4) || '????'})?`,
                                        [
                                            { text: 'Cancel', style: 'cancel' },
                                            {
                                                text: 'Confirm',
                                                onPress: async () => {
                                                    setFiatLoading(true);
                                                    try {
                                                        if (fiatMode === 'DEPOSIT') {
                                                            const result = await initiateDeposit(amt.toFixed(2), selectedBank.id);
                                                            console.log('Deposit result:', result);
                                                            if (result?.id) {
                                                                SimpleToast.show('Deposit initiated! Settlement may take 1-5 business days.', SimpleToast.LONG);
                                                                setFiatAmount('');
                                                                setShowFiatPanel(false);
                                                            } else {
                                                                SimpleToast.show(result?.message || result?.data?.message || 'Deposit failed. Check Strike app for details.', SimpleToast.LONG);
                                                            }
                                                        } else {
                                                            // Withdraw: create payout then initiate
                                                            const payout = await createPayout(amt.toFixed(2), selectedBank.id);
                                                            console.log('Payout created:', payout);
                                                            if (payout?.id && payout?.state === 'NEW') {
                                                                const initiated = await initiatePayout(payout.id);
                                                                console.log('Payout initiated:', initiated);
                                                                if (initiated?.state === 'INITIATED' || initiated?.state === 'COMPLETED') {
                                                                    SimpleToast.show('Withdrawal initiated! Funds will arrive in 1-5 business days.', SimpleToast.LONG);
                                                                    setFiatAmount('');
                                                                    setShowFiatPanel(false);
                                                                } else {
                                                                    SimpleToast.show(initiated?.message || 'Withdrawal initiation failed.', SimpleToast.LONG);
                                                                }
                                                            } else {
                                                                SimpleToast.show(payout?.message || payout?.data?.message || 'Payout creation failed. Check Strike app.', SimpleToast.LONG);
                                                            }
                                                        }
                                                    } catch (err: any) {
                                                        console.error('Fiat operation error:', err);
                                                        SimpleToast.show('Error: ' + (err?.message || 'Unknown error'), SimpleToast.LONG);
                                                    } finally {
                                                        setFiatLoading(false);
                                                    }
                                                },
                                            },
                                        ],
                                    );
                                }}
                                style={{
                                    marginTop: 16,
                                    paddingVertical: 12,
                                    borderRadius: 12,
                                    backgroundColor: (!fiatAmount || Number(fiatAmount) <= 0 || !selectedBank || fiatLoading)
                                        ? '#333'
                                        : fiatMode === 'DEPOSIT' ? '#1B6B3A' : '#8B3A3A',
                                    alignItems: 'center',
                                }}
                            >
                                {fiatLoading ? (
                                    <ActivityIndicator size="small" color="#FFF" />
                                ) : (
                                    <Text bold style={{ color: '#FFF', fontSize: 15 }}>
                                        {fiatMode === 'DEPOSIT' ? 'Deposit' : 'Withdraw'} {fiatAmount ? `${getStrikeCurrency(safeCurrency)}${Number(fiatAmount).toFixed(2)}` : ''}
                                    </Text>
                                )}
                            </TouchableOpacity>
                        </>
                    )}
                </View>
            )}
            <BlackBGView
                linearFirstStyle={styles.bitcoinPriceContainer}
                linearSecondStyle={styles.bitcoinPriceContainerInner}
                linearFirstColors={[colors.black.default, colors.black.default]}
            >
                <Text bold style={[styles.bitcoinPriceText, { color: rateColor }]}>{(Number(matchedRate) || 0).toLocaleString('en-US', { style: 'currency', currency: safeCurrency }) + ' /BTC'}</Text>
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

