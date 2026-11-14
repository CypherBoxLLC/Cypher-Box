import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Alert, Image, Keyboard, LayoutAnimation, ScrollView, StyleSheet, Switch, TextInput, TouchableOpacity, View } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { Icon } from 'react-native-elements';
import SimpleToast from "react-native-simple-toast";

import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientView, SavingVault, VaultCapsules } from "@Cypher/components";
import { colors, rtl } from "@Cypher/style-guide";
import { dispatchNavigate, formatSats, formatUsd, groupThousands } from "@Cypher/helpers";
import { selectCapsules, withoutFrozen } from "@Cypher/helpers/capsuleSelection";
import { CapsuleSpendError, capsulesBeyondNeed, describeBuiltSpend, normalizeDestination, planCapsuleSpend, SpendMode, typedAmountSats } from "@Cypher/helpers/capsuleSpend";
import { offersChangeSweep, reviewLabels, vaultSendKind } from "@Cypher/helpers/vaultSendKind";
import { isCoinosAllowed, isStrikeAllowed } from "@Cypher/services/featureFlags";
import Clipboard from '@react-native-clipboard/clipboard'
import loc, { formatBalance, formatBalanceWithoutSuffix } from "../../../loc";
import safetyErrorText from "../../helpers/safetyErrorText";
import { BitcoinUnit, Chain } from "../../../models/bitcoinUnits";
import NetworkTransactionFees, { NetworkTransactionFee } from '../../../models/networkTransactionFees';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../../blue_modules/hapticFeedback';
import { HDSegwitBech32Wallet, MultisigHDWallet, WatchOnlyWallet } from "../../../class";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import { AbstractHDElectrumWallet } from "../../../class/wallets/abstract-hd-electrum-wallet";
import BigNumber from "bignumber.js";
import useAuthStore from "@Cypher/stores/authStore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { btc, SATS } from "@Cypher/helpers/coinosHelper";
import { scanQrHelper } from "../../../helpers/scan-qr";
import DeeplinkSchemaMatch from "../../../class/deeplink-schema-match";
import { Check, Edit, StrikeFull, CoinOS, Hot, Cold1, Second } from "@Cypher/assets/images";
import { getStrikeDepositAddress, createInvoice as createInvoiceStrike } from "@Cypher/api/strikeAPIs";
import { createInvoice as createInvoiceCoinos } from "@Cypher/api/coinOSApis";

const prompt = require('../../../helpers/prompt');
const btcAddressRx = /^[a-zA-Z0-9]{26,35}$/;
// stands in for the destination in the fee quote until there is one; its
// output is the size of a typical P2WPKH or P2SH one
const FEE_QUOTE_ADDRESS = '36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV';
// a long selection lists this many capsules until "Show all" is tapped, so the
// amount, fee and Next stay near the top
const COLLAPSED_CAPSULES = 6;

const spendErrorText = (error?: CapsuleSpendError) => {
    switch (error) {
        case 'no_capsules':
            return loc.cypherbox.vault.cold_storage.no_capsules_message;
        case 'fee_rate':
            return loc.send.details_fee_field_is_not_valid;
        case 'amount':
            return loc.send.details_amount_field_is_not_valid;
        case 'destination':
            return loc.send.details_address_field_is_not_valid;
        default:
            return loc.send.details_total_exceeds_balance;
    }
};

interface Props {
    route: any;
    navigation: any;
}

export const shortenAddress = (address: string) => {
    // Show full address for security
    return address;
};


export default function ColdStorage({ route, navigation }: Props) {
    // autoSelected: the app pre-selected every capsule (Home scan) rather than the user ticking them
    const {wallet, vaultTab, utxo, ids, maxUSD, inUSD, total, currency, isMaxEdit, matchedRate, capsulesData = null, to = null, toStrike = null, toArk = null, vaultSend, title, type, isBatch, capsuleTotal, autoSelected = false} = route?.params;
    const [address, setAddress] = useState();
    const [networkFees, setNetworkFees] = useState(5000);
    const [serviceFees, setServiceFees] = useState('~ 400 sats');
    const [totalFees, setTotalFees] = useState('~ 5400 sats (~0.2%)');
    const [note, setNote] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [destinationAddress, setDestinationAddress] = useState('');
    const [useLightningBridge, setUseLightningBridge] = useState(false);
    const [bridgeProvider, setBridgeProvider] = useState<'STRIKE' | 'COINOS' | null>(null);
    const [bridgeDepositAddress, setBridgeDepositAddress] = useState<string | null>(null);
    const [lightningInvoice, setLightningInvoice] = useState('');
    const [showFeeInfo, setShowFeeInfo] = useState(false);
    const [showChangeInfo, setShowChangeInfo] = useState(false);
    const [showChangeMenu, setShowChangeMenu] = useState(false);
    const [showAllCapsules, setShowAllCapsules] = useState(false);
    const [showFirePopup, setShowFirePopup] = useState(false);
    // style = { styles.pasteAddress }
    const [visibleSelection, setVisibleSelection] = useState(false);
    const [selectedFees, setSelectedFees] = useState(1);
    // const [feeSats, setFeeSats] = useState(5000);
    const [networkFee, setNetworkFee] = useState<number | null>(null);
    const [customFee, setCustomFee] = useState(null);
    const [isCustomFee, setIsCustomFee] = useState(false);
    const [networkTransactionFees, setNetworkTransactionFees] = useState(new NetworkTransactionFee(3, 2, 1));
    const [networkTransactionFeesIsLoading, setNetworkTransactionFeesIsLoading] = useState(false);
    const [addresses, setAddresses] = useState([]);
    const [feeUnit, setFeeUnit] = useState();
    const [amountUnit, setAmountUnit] = useState(BitcoinUnit.BTC);
    const [isTransactionReplaceable, setIsTransactionReplaceable] = useState(false);
    const [transactionMemo, setTransactionMemo] = useState('');
    const [payjoinUrl, setPayjoinUrl] = useState(null);
    const [dumb, setDumb] = useState(false);
    const [isCheck, setIsCheck] = useState(false);

    const [changeAddress, setChangeAddress] = useState();
    const [changeDestination, setChangeDestination] = useState<'SELF' | 'STRIKE' | 'COINOS' | 'HOT_VAULT'>('SELF');
    const [changeDepositAddress, setChangeDepositAddress] = useState<string | null>(null);
    const [changeFetchLoading, setChangeFetchLoading] = useState(false);
    const { wallets, setSelectedWalletID, sleep, txMetadata, saveToDisk, isElectrumDisabled } = useContext(BlueStorageContext);
    const { walletID, coldStorageWalletID, isStrikeAuth: isStrikeConnected, isAuth: isCoinosConnected, isArkAuth } = useAuthStore();
    // Region gates (services/featureFlags): a connected rail that is not
    // offered in this region is treated as unavailable on this surface.
    const isAuth = isCoinosConnected && isCoinosAllowed();
    const isStrikeAuth = isStrikeConnected && isStrikeAllowed();
    const { navigate } = useNavigation();


    const [feeUSD, setFeeUSD] = useState(1);
    const [feesEditable, setFeesEditable] = useState(false);
    const [satsEditable, setSatsEditable] = useState(false);
    // The capsules the user picked, and the ONLY coins this screen may spend.
    //
    // Selecting capsules is mandatory in Cypher Box: you cannot send from a
    // vault without choosing coins first. Every entry point into this screen
    // passes both `utxo` and `ids`, and Capsules gates each of its four send
    // paths on `ids.length > 0`. So `selectedUtxo` is always the full picture
    // of what the user chose.
    //
    // Previously the unfiltered `utxo` was handed to createTransaction, so
    // coinselect (which sorts descending and takes the largest) spent whatever
    // coin it liked, and the change figure on the confirm screen, derived from
    // the selection, could be wrong by orders of magnitude.
    //
    // There is deliberately NO whole-wallet fallback here. If the selection is
    // ever empty that is a bug in the caller, and quietly spending the rest of
    // the vault is the worst available response to it.
    //
    // Frozen capsules are spent only when the user ticked them: a pre-selection
    // the app made (autoSelected) leaves them out, like BlueWallet's send screen.
    const selectedUtxo = useMemo(() => {
        const picked = selectCapsules<any>(utxo, ids);
        return autoSelected ? withoutFrozen(picked, (u: any) => !!wallet?.getUTXOMetadata?.(u.txid, u.vout)?.frozen) : picked;
    }, [utxo, ids, autoSelected, wallet]);
    const balance = selectedUtxo.reduce((prev, curr) => prev + curr.value, 0);
    const allBalance = formatBalanceWithoutSuffix(balance, BitcoinUnit.BTC, true);
    const balanceWallet = !wallet?.hideBalance && formatBalance(Number(wallet?.getBalance()), wallet?.getPreferredBalanceUnit(), true);
    const balanceWithoutSuffix = !wallet?.hideBalance && formatBalanceWithoutSuffix(Number(wallet?.getBalance()), wallet?.getPreferredBalanceUnit(), true);
    const primaryColor = vaultTab ? colors.coldGreen : colors.green
    // Default selection: prefer the rail the user actually has an address
    // for. We pick the FIRST authed-and-addressed account in priority
    // Strike → CoinOS → Ark, so existing Strike/CoinOS users see no
    // behavior change. CoinOS is skipped entirely when the feature flag
    // disables it (e.g. iOS in EU on production builds), so the default
    // doesn't land on a hidden card.
    const coinosOk = isCoinosAllowed();
    const initialSelectedItem = (() => {
      if (isStrikeAuth && toStrike) return 1;
      if (isAuth && to && coinosOk) return 2;
      if (isArkAuth && toArk) return 3;
      // Fall back to whichever rail is authed even if address isn't
      // ready yet — the existing useEffect will hook the address up
      // when it arrives.
      if (isStrikeAuth) return 1;
      if (isAuth && coinosOk) return 2;
      if (isArkAuth) return 3;
      return 2;
    })();
    const [selectedItem, setSelectedItem] = useState(initialSelectedItem);
    const [data, setData] = useState([
      {
        id: 1,
        name: "Strike",
        type: 0,
        icon: StrikeFull,
        // We disable the card when the user isn't authed for the rail OR
        // when the address fetch hasn't returned yet. The latter prevents
        // the user from selecting Strike, hitting Next, and then sending
        // to `undefined`. Same gate now on Ark below.
        enabled: isStrikeAuth && !!toStrike,
        navigation: {
          screen: "SendScreen",
          params: {
            matchedRate,
            currency: 'USD',
            receiveType: false
          },
        },
      },
      {
        id: 2,
        name: "CoinOS",
        type: 0,
        icon: CoinOS,
        // Region/platform gate: same isCoinosAllowed() helper used by
        // the home screen popups so the construct-tx card list stays in
        // sync. Production iOS in EU never sees this card; dev / non-EU
        // / Android always do.
        enabled: isAuth && !!to && isCoinosAllowed(),
        navigation: {
          screen: "SendScreen",
          params: {
            matchedRate,
            currency: 'USD',
            receiveType: true
          },
        },
      },
      // Ark destination — funds the Ark vault by sending the picked
      // hot/cold-vault UTXOs to its on-chain "boarding" address. The
      // ASP boards the funds in the next round; the Ark balance updates
      // after sync. Same construct-tx flow as Strike/CoinOS, just a
      // different destination address.
      {
        id: 3,
        name: "Bark Vault",
        type: 0,
        icon: Second,
        enabled: isArkAuth && !!toArk,
        navigation: {
          screen: "SendScreen",
          params: {
            matchedRate,
            currency: 'USD',
            receiveType: false,
          },
        },
      },
    ]);

    const formatFee = fee => formatBalance(fee, feeUnit, true);

    // What this send spends, through the same helper the build below uses, so
    // the amount, change and fee on this screen are the transaction's. Max
    // (Consolidate, the moves, the Max button) sends everything selected; a
    // typed amount spends every capsule the user ticked, or lets coinselect
    // pick from a pre-selection the app made.
    const spendMode: SpendMode = isMaxEdit ? 'max' : autoSelected ? 'pool' : 'exact';
    const typedSats = useMemo(() => (isMaxEdit ? null : typedAmountSats(total, inUSD, matchedRate)), [isMaxEdit, total, inUSD, matchedRate]);
    // createTransaction sizes inputs by the wallet's first receive address;
    // a capsule's own address is the same type if that can't be read yet
    const firstAddress = useMemo(() => {
        try {
            return wallet?._getExternalAddressByIndex?.(0) || selectedUtxo[0]?.address;
        } catch (_) {
            return selectedUtxo[0]?.address;
        }
    }, [wallet, selectedUtxo]);
    const quoteDestination = destinationAddress && wallet?.isAddressValid?.(destinationAddress) ? destinationAddress : FEE_QUOTE_ADDRESS;
    const planAt = useCallback(
        (rate: number, destination: string = quoteDestination) =>
            planCapsuleSpend({ mode: spendMode, utxos: selectedUtxo, destination, amountSats: typedSats, feeRate: rate, firstAddress }),
        [spendMode, selectedUtxo, typedSats, firstAddress, quoteDestination],
    );
    const nf = networkTransactionFees;
    const feeAtRate = useMemo(
        () => ({
            fastestFee: planAt(Number(nf.fastestFee)).plan?.feeSats ?? null,
            mediumFee: planAt(Number(nf.mediumFee)).plan?.feeSats ?? null,
            slowFee: planAt(Number(nf.slowFee)).plan?.feeSats ?? null,
        }),
        [planAt, nf],
    );

    const feeRate = useMemo(() => {
        if (customFee) return customFee;
        // the fastest rate the selection can pay
        if (feeAtRate.fastestFee !== null) return String(nf.fastestFee);
        if (feeAtRate.mediumFee !== null) return String(nf.mediumFee);
        return String(nf.slowFee);
    }, [customFee, feeAtRate, nf]);

    // recomputed whenever the rate changes, including when the network's
    // rates replace the placeholder ones
    const spend = useMemo(() => planAt(Number(feeRate)), [planAt, feeRate]);
    const plan = spend.plan;
    const amountSats = plan ? plan.amountSats : spendMode === 'max' ? 0 : typedSats ?? 0;
    const usd = (amountSats / SATS) * Number(matchedRate || 0);
    const feeSats = plan ? plan.feeSats : null;
    const changeSats = plan ? plan.changeSats : 0;
    // what the review lists: the capsules this spends, out of those selected
    const spentIds = useMemo(() => new Set(plan ? plan.inputs.map(i => `${i.txid}:${i.vout}`) : []), [plan]);
    const shownCapsules = plan && capsulesData ? capsulesData.filter((c: any) => spentIds.has(c.id)) : capsulesData;
    const capsulesNotNeeded = plan && capsulesData ? capsulesData.length - shownCapsules.length : 0;
    // a typed amount spends every ticked capsule: say so when fewer would cover it
    const beyondNeed = useMemo(
        () =>
            spendMode === 'exact'
                ? capsulesBeyondNeed(plan, { mode: spendMode, utxos: selectedUtxo, destination: quoteDestination, amountSats: typedSats, feeRate: Number(feeRate), firstAddress })
                : null,
        [spendMode, plan, selectedUtxo, quoteDestination, typedSats, feeRate, firstAddress],
    );
    const listedCapsules = shownCapsules && !showAllCapsules && shownCapsules.length > COLLAPSED_CAPSULES + 2 ? shownCapsules.slice(0, COLLAPSED_CAPSULES) : shownCapsules;
    // by flow and in the app's language (the `title` param is an English flag)
    const sendKind = vaultSendKind({ isBatch, vaultSend, vaultTab, to, toStrike, toArk, autoSelected });
    const labels = reviewLabels(sendKind);

    useEffect(() => {
      if(isBatch){
        setTransactionMemo('Batching Transaction')
      }
    }, [isBatch])

    useEffect(() => {
      if (selectedItem == 1 && toStrike) {
        setDestinationAddress(toStrike);
      } else if (selectedItem == 2 && to) {
        setDestinationAddress(to);
      } else if (selectedItem == 3 && toArk) {
        // Ark on-chain boarding address — the construct-tx send flow
        // (same one used for Strike/CoinOS top-ups) treats it as a
        // standard Bitcoin address; the ASP-side boarding is invisible
        // to the broadcaster.
        setDestinationAddress(toArk);
      } else if (to) {
        setDestinationAddress(to);
      } else if (toArk) {
        setDestinationAddress(toArk);
      }
    }, [to, toStrike, toArk, selectedItem])

    useEffect(() => {
        if (!wallet) return;
        setSelectedWalletID(wallet.getID());
    
        // reset other values
        setChangeAddress(null);
        setIsTransactionReplaceable(wallet.type === HDSegwitBech32Wallet.type);
    
        // update wallet UTXO
        wallet
          .fetchUtxo()
          .then(() => {
            // we need to re-calculate fees
            setDumb(v => !v);
          })
          .catch(e => console.log('fetchUtxo error', e));
    }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps
    
    useEffect(() => {
        // check if we have a suitable wallet
        const suitable = wallets.filter(w => w && w.chain === Chain.ONCHAIN);
        console.log('vaultTabvaultTabvaultTab: ', vaultTab)
        const newWallet = vaultTab ? ((coldStorageWalletID && wallets.find(w => w && w.getID() === coldStorageWalletID)) || suitable[0]) : ((walletID && wallets.find(w => w && w.getID() === walletID)) || suitable[0]);
        setFeeUnit(newWallet.getPreferredBalanceUnit());
        setAmountUnit(newWallet.preferredBalanceUnit); // default for whole screen

        // we are ready!
        setIsLoading(false);

        // load cached fees
        AsyncStorage.getItem(NetworkTransactionFee.StorageKey)
        .then(res => {
            const fees = JSON.parse(res);
            if (!fees?.fastestFee) return;
            setNetworkTransactionFees(fees);
        })
        .catch(e => console.log('loading cached recommendedFees error', e));

        // load fresh fees from servers

        setNetworkTransactionFeesIsLoading(true);
        NetworkTransactionFees.recommendedFees()
        .then(async fees => {
            if (!fees?.fastestFee) return;
            setNetworkTransactionFees(fees);
            await AsyncStorage.setItem(NetworkTransactionFee.StorageKey, JSON.stringify(fees));
        })
        .catch(e => console.log('loading recommendedFees error', e))
        .finally(() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setNetworkTransactionFeesIsLoading(false);
        });
  }, [vaultTab, coldStorageWalletID, walletID, type]); // eslint-disable-line react-hooks/exhaustive-deps

    const createTransaction = async () => {
        Keyboard.dismiss();
        setIsLoading(true);
        const requestedSatPerByte = feeRate;
        if (!selectedUtxo || selectedUtxo.length === 0) {
          setIsLoading(false);
          Alert.alert(
            loc.cypherbox.vault.cold_storage.no_capsules_title,
            loc.cypherbox.vault.cold_storage.no_capsules_message,
          );
          return;
        }
        // checked in sats, against the amount the review shows (for Max, what
        // is left after the fee)
        const transaction = { address: destinationAddress, amountSats };
        let error;
        if (!requestedSatPerByte || parseFloat(requestedSatPerByte) < 1 || spend.error === 'fee_rate') {
          error = loc.send.details_fee_field_is_not_valid;
        } else if (spend.error === 'insufficient') {
          // the selection can't pay this amount and its fee (for Max: not even the fee)
          error = loc.send.details_total_exceeds_balance;
        } else if (!transaction.amountSats || transaction.amountSats < 0) {
          error = loc.send.details_amount_field_is_not_valid;
        } else if (transaction.amountSats <= 500) {
          error = loc.send.details_amount_field_is_less_than_minimum_amount_sat;
        } else if (!transaction.address) {
          error = loc.send.details_address_field_is_not_valid;
        } else if (balance - transaction.amountSats < 0) {
          // first sanity check is that sending amount is not bigger than available balance
          error = loc.send.details_total_exceeds_balance;
        } else {
          const address = transaction.address.trim().toLowerCase();
          if (address.startsWith('lnb') || address.startsWith('lightning:lnb')) {
            error = loc.send.provided_address_is_invoice;
          }
        }

        if (!error && !wallet.isAddressValid(transaction.address)) {
          error = loc.send.details_address_field_is_not_valid;
        }

        if (error) {
          console.log('validation error');
          setIsLoading(false);
          Alert.alert(loc.errors.error, error);
          triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
          return;
        }

        if (changeDestination !== 'SELF' && !changeDepositAddress) {
          setIsLoading(false);
          SimpleToast.show(loc.cypherbox.vault.cold_storage.waiting_change_address, SimpleToast.SHORT);
          return;
        }

        try {
          await createPsbtTransaction();
        } catch (Err) {
          setIsLoading(false);
          // the signature checks before broadcast throw in English
          Alert.alert(loc.errors.error, safetyErrorText(Err));
          triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        }
    };

    const getChangeAddressAsync = async () => {
        if (changeAddress) return changeAddress; // cache
    
        let change;
        if (WatchOnlyWallet.type === wallet.type && !wallet.isHd()) {
          // plain watchonly - just get the address
          change = wallet.getAddress();
        } else if (WatchOnlyWallet.type === wallet.type && wallet.isHd() && wallet.useWithHardwareWalletEnabled()) {
          // watch-only HD with hardware wallet - initialize and get change address from internal wallet
          try {
            if (!wallet._hdWalletInstance) {
              wallet.init(); // Initialize the internal HD wallet instance
            }
            change = await Promise.race([sleep(2000), wallet.getChangeAddressAsync()]);
          } catch (e) {
            console.log('Error getting change address:', e);
          }
          
          if (!change && wallet._hdWalletInstance) {
            change = wallet._hdWalletInstance.getAddress();
          }
        } else {
          // otherwise, lets call widely-used getChangeAddressAsync()
          try {
            change = await Promise.race([sleep(2000), wallet.getChangeAddressAsync()]);
          } catch (_) {}
    
          if (!change) {
            // either sleep expired or getChangeAddressAsync threw an exception
            if (wallet instanceof AbstractHDElectrumWallet) {
              change = wallet._getInternalAddressByIndex(wallet.getNextFreeChangeAddressIndex());
            } else {
              // legacy wallets
              change = wallet.getAddress();
            }
          }
        }
    
        if (change) setChangeAddress(change); // cache

        return change;
      };

    const handleChangeDestination = async (destination: 'SELF' | 'STRIKE' | 'COINOS' | 'HOT_VAULT') => {
        if (destination === changeDestination) return;
        setChangeDestination(destination);
        setChangeDepositAddress(null);

        if (destination === 'SELF') return;

        setChangeFetchLoading(true);
        try {
            if (destination === 'STRIKE') {
                const response = await createInvoiceStrike({ onchain: {}, targetCurrency: "BTC" }); // Cypher Box: receive as Bitcoin, no auto-convert to fiat
                if (response?.onchain?.address) {
                    setChangeDepositAddress(response.onchain.address);
                } else {
                    SimpleToast.show(loc.cypherbox.vault.cold_storage.strike_deposit_failed, SimpleToast.SHORT);
                    setChangeDestination('SELF');
                }
            } else if (destination === 'COINOS') {
                const response = await createInvoiceCoinos({ type: 'bitcoin' });
                if (response?.hash) {
                    setChangeDepositAddress(response.hash);
                } else {
                    SimpleToast.show(loc.cypherbox.vault.cold_storage.coinos_deposit_failed, SimpleToast.SHORT);
                    setChangeDestination('SELF');
                }
            } else if (destination === 'HOT_VAULT') {
                const hotVaultWallet = wallets.find(w => w.getID() === walletID);
                if (hotVaultWallet) {
                    let addr;
                    if (hotVaultWallet instanceof AbstractHDElectrumWallet) {
                        addr = hotVaultWallet._getExternalAddressByIndex(hotVaultWallet.getNextFreeAddressIndex());
                    } else {
                        addr = hotVaultWallet.getAddress();
                    }
                    if (addr) {
                        setChangeDepositAddress(addr);
                    } else {
                        SimpleToast.show(loc.cypherbox.vault.cold_storage.hot_vault_address_failed, SimpleToast.SHORT);
                        setChangeDestination('SELF');
                    }
                } else {
                    SimpleToast.show(loc.cypherbox.vault.cold_storage.hot_vault_not_found, SimpleToast.SHORT);
                    setChangeDestination('SELF');
                }
            }
        } catch (err) {
            console.error('Error fetching change deposit address:', err);
            SimpleToast.show(String(loc.formatString(loc.cypherbox.vault.cold_storage.deposit_address_failed, { error: err.message })), SimpleToast.SHORT);
            setChangeDestination('SELF');
        } finally {
            setChangeFetchLoading(false);
        }
    };

    const createPsbtTransaction = async () => {
        const change = changeDestination !== 'SELF' && changeDepositAddress
            ? changeDepositAddress
            : await getChangeAddressAsync();
        const requestedSatPerByte = Number(feeRate);
        // Spend the capsules the user selected, and only those. See the note on
        // `selectedUtxo` above for why there is no whole-wallet fallback.
        const lutxo = selectedUtxo;
        if (!lutxo || lutxo.length === 0) {
            setIsLoading(false);
            Alert.alert(
                loc.cypherbox.vault.cold_storage.no_capsules_title,
                loc.cypherbox.vault.cold_storage.no_capsules_message,
            );
            return;
        }
        console.log({ requestedSatPerByte, lutxo: lutxo.length });

        // the plan the review shows, for the real destination: a Max send asks
        // for no amount (coinselect/split), so every selected capsule goes in
        const { plan: spendPlan, error: planError } = planAt(requestedSatPerByte, destinationAddress);
        if (!spendPlan) {
            setIsLoading(false);
            Alert.alert(loc.errors.error, spendErrorText(planError));
            return;
        }
        const targets = spendPlan.targets;

        console.log('targets: ', targets)
        console.log('requestedSatPerByte: ', requestedSatPerByte)
        console.log('change: ' ,change)

        // coinThresholdClickHandler.log('lutxo: ', lutxo)
        const { tx, outputs, psbt, fee, inputs } = wallet.createTransaction(
          lutxo,
          targets,
          requestedSatPerByte,
          change,
          isTransactionReplaceable ? HDSegwitBech32Wallet.defaultRBFSequence : HDSegwitBech32Wallet.finalRBFSequence,
        );
        // the amount, change and fee every later screen shows: the built transaction's
        const sent = describeBuiltSpend({ inputs, outputs, fee }, destinationAddress);
        const sentUSD = ((sent.amountSats / SATS) * Number(matchedRate || 0)).toFixed(2);
        const spentCapsules = capsulesData ? capsulesData.filter((c: any) => sent.spentIds.includes(c.id)) : capsulesData;

        // if (tx && routeParams.launchedBy && psbt) {
        //   console.warn('navigating back to ', routeParams.launchedBy);
        //   navigation.navigate(routeParams.launchedBy, { psbt });
        // }
    
        if (wallet.type === WatchOnlyWallet.type) {
          // watch-only wallets with enabled HW wallet support have different flow. we have to show PSBT to user as QR code
          // so he can scan it and sign it. then we have to scan it back from user (via camera and QR code), and ask
          // user whether he wants to broadcast it
          navigation.navigate('HardwareWalletTransaction', {
            memo: transactionMemo,
            fromWallet: wallet,
            psbt,
            sats: sent.amountSats,
            inUSD: sentUSD,
            sentFrom: address,
            destinationAddress: destinationAddress,
            networkFees: sent.feeSats,
            changeSats: sent.changeSats,
            // which flow this is, for the signing screen's labels (kept with the pending signature)
            kind: sendKind,
            // the CoinOS deposit address on a top-up (the other vault's address on a move)
            to,
            serviceFees: serviceFees,
            totalFees: totalFees,
            isCustomFee: isCustomFee,
            walletID: wallet.getID(),
            changeRouting: changeDestination !== 'SELF' ? {
                destination: changeDestination,
                depositAddress: changeDepositAddress,
            } : null,
          });
          setIsLoading(false);
          return;
        }
    
        if (wallet.type === MultisigHDWallet.type) {
          setIsLoading(false);
          return;
        }
    
        txMetadata[tx.getId()] = {
          txhex: tx.toHex(),
          memo: transactionMemo,
        };
        await saveToDisk();
    
        let recipients = outputs.filter(({ address }) => address !== change);
    
        console.log('recipients: ', recipients)
        if (recipients.length === 0) {
          // special case. maybe the only destination in this transaction is our own change address..?
          // (ez can be the case for single-address wallet when doing self-payment for consolidation)
          recipients = outputs;
        }

        let data = {
            sats: sent.amountSats,
            coinsSelected: sent.spentIds.length,
            inUSD: sentUSD,
            sentFrom: address,
            destinationAddress: destinationAddress,
            // in sats, whichever way the rate was chosen
            networkFees: sent.feeSats,
            changeSats: sent.changeSats,
            serviceFees: serviceFees,
            isCustomFee: isCustomFee,
            totalFees: totalFees,
            note: transactionMemo,
            createTransaction: createTransaction,
            memo: transactionMemo,
            targets: [{ address, value: sent.amountSats }],
            walletID: wallet.getID(),
            vaultTab: vaultTab,
            satoshiPerByte: requestedSatPerByte,
            payjoinUrl,
            tx: tx.toHex(),
            recipients,
            psbt,
            // the capsules this spends, for the confirm screen's list
            capsulesData: spentCapsules,
            to,
            toStrike,
            // with autoSelected, for the confirm screen's labels (vaultSendKind)
            toArk,
            autoSelected,
            vaultSend,
            capsuleTotal,
            isBatch,
            fee: new BigNumber(fee).dividedBy(100000000).toNumber(),
            matchedRate: matchedRate,
        }
        console.log('data: ', data)
        dispatchNavigate('ConfirmTransction', {
            data: data,
            useLightningBridge: useLightningBridge && lightningInvoice && bridgeProvider,
            bridgeProvider: bridgeProvider,
            lightningInvoice: lightningInvoice,
            changeRouting: changeDestination !== 'SELF' ? {
                destination: changeDestination,
                depositAddress: changeDepositAddress,
            } : null,
        });
        setIsLoading(false);
    };
    

    const nextClickHandler = async () => {
        // Lightning bridge mode: skip on-chain destination validation
        if (useLightningBridge && lightningInvoice && bridgeProvider) {
            // Use bridge's deposit address as on-chain destination
            if (bridgeProvider === 'STRIKE') {
                // Use bridge deposit address that was already fetched
                console.log('bridgeDepositAddress:', bridgeDepositAddress);
                console.log('strikeToken:', useAuthStore.getState().strikeToken ? 'exists' : 'missing');
                if (bridgeDepositAddress) {
                    setDestinationAddress(bridgeDepositAddress);
                    SimpleToast.show(loc.cypherbox.vault.cold_storage.bridge_via_strike, SimpleToast.SHORT);
                    createTransaction();
                } else {
                    // Try fetching now as fallback
                    SimpleToast.show(loc.cypherbox.vault.cold_storage.fetching_strike_address, SimpleToast.SHORT);
                    try {
                        const data = await getStrikeDepositAddress();
                        if (data?.bitcoinAddress) {
                            setBridgeDepositAddress(data.bitcoinAddress);
                            setDestinationAddress(data.bitcoinAddress);
                            SimpleToast.show(loc.cypherbox.vault.cold_storage.bridge_via_strike, SimpleToast.SHORT);
                            createTransaction();
                        }
                    } catch (err) {
                        console.error('Fetch error:', err);
                        SimpleToast.show(String(loc.formatString(loc.cypherbox.vault.cold_storage.strike_address_failed, { error: err.message })), SimpleToast.LONG);
                    }
                }
                return;
            } else if (bridgeProvider === 'COINOS') {
                // For Coinos, use existing coinos deposit address
                SimpleToast.show(loc.cypherbox.vault.cold_storage.bridge_via_coinos, SimpleToast.SHORT);
                // TODO: Get Coinos deposit address if needed
                createTransaction();
                return;
            }
        }

        if(!destinationAddress || destinationAddress.length == 0){
            SimpleToast.show(loc.cypherbox.vault.cold_storage.enter_destination, SimpleToast.SHORT)
            return
        }
        if(!isCheck && title){
            SimpleToast.show(loc.cypherbox.vault.cold_storage.verify_destination, SimpleToast.SHORT)
            return;
        }
        if (btcAddressRx.test(destinationAddress) || destinationAddress.startsWith('bc1') || destinationAddress.startsWith('BC1')) {
            createTransaction()
        } else {
            SimpleToast.show(loc.cypherbox.vault.cold_storage.destination_invalid, SimpleToast.SHORT)
        }
    }

    const editAmountClickHandler = () => {
        // EditAmount comes back with exactly these, so the Bark destination and how the capsules were chosen ride along
        navigation.push('EditAmount', {isEdit: true, currency, vaultTab, wallet, utxo, ids, maxUSD, inUSD, total, matchedRate, capsulesData, to, toStrike, toArk, vaultSend, setSatsEdit: setSats_, title, capsuleTotal, isBatch, autoSelected });
    }

    const editFeesClickHandler = () => {
        setVisibleSelection(true);
    }

    const setSats_ = (sats: any, usd: any) => {
        // setUSD(usd);
        // const value = Number(sats) / 10000;
        // setSats(value + 'K sats ~$' + usd);
        setSatsEditable(true);
    }

    const setNetFee_ = (sats: any, usd: any) => {
        setFeeUSD(usd);
        setNetworkFees(sats);
        setFeesEditable(true);
    }

    const selectFeesClickHandler = (item: any) => {
        console.log("🚀 ~ selectFeesClickHandler ~ index:", item);
        setVisibleSelection(false);
        setSelectedFees(item);
        setFeesEditable(true);
        if (index === 3) {
            dispatchNavigate('FeeRate', {
                networkFees: networkFees,
                feeUSD: feeUSD,
                setNetFee_: setNetFee_
            });
        }
    }

    const getCurrentFee = () => {
        const selectedFee = options.find(item => item.active);
        if(selectedFee && !isCustomFee){
            return {fee: selectedFee.fee, label:  selectedFee?.label}
        } else {
            return loc.cypherbox.vault.cold_storage.customize;
        }
    }

    const getNetworkFees = () => {
        const selectedFee = options.find(item => item.active);
        console.log('selectedFee: ', selectedFee)
        if(selectedFee && !isCustomFee){
            if(selectedFee.fee){
                setNetworkFee(selectedFee.fee)
            } else if(selectedFee.rate){
                setNetworkFee(Number(selectedFee.rate) * Number(matchedRate) * btc(1))
            }
            return selectedFee?.label
        } else {
            return loc.cypherbox.vault.cold_storage.customize;
        }
    }

    const obtainWalletAddress = async () => {
        let newAddress;
        try {
            if (!isElectrumDisabled) newAddress = await Promise.race([wallet.getAddressAsync(), sleep(1000)]);
        } catch (_) {}
        if (newAddress === undefined) {
            // either sleep expired or getAddressAsync threw an exception
            console.warn('either sleep expired or getAddressAsync threw an exception');
            newAddress = wallet._getExternalAddressByIndex(wallet.getNextFreeAddressIndex());
        } else {
            saveToDisk(); // caching whatever getAddressAsync() generated internally
        }
        console.log('newAddress: ', newAddress)
        setAddress(newAddress);

        // Subscribe new address to GroundControl for push notifications
        try {
            const GroundControl = require('../../../blue_modules/groundControl');
            await GroundControl.majorTomToGroundControl([newAddress], [], []);
            console.log('[GroundControl] Subscribed new address:', newAddress);
        } catch (notifyErr) {
            console.warn('[GroundControl] Failed to subscribe address:', notifyErr);
        }
    }

    useFocusEffect(
        useCallback(() => {
            if (wallet) {
                obtainWalletAddress();
            }
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [wallet]),
    );


    const coinThresholdClickHandler = () => { }

    const handleLightningPaste = async () => {
        try { const txt = await Clipboard.getString(); if (txt) setLightningInvoice(txt.trim()); } catch(e) {}
    };
    const pasteClickHandler = async () => {
        const text = await Clipboard.getString();
        console.log("🚀 ~ pasteClickHandler ~ text:", text)
        // a bech32 address in capitals is kept in lower case (normalizeDestination)
        setDestinationAddress(normalizeDestination(text));
    }

    const processAddressData = data => {
        // setIsLoading(true);
        console.log('data: ', data)
        if (!data.replace) {
          // user probably scanned PSBT and got an object instead of string..?
        //   setIsLoading(false);
          return Alert.alert(loc.errors.error, loc.send.details_address_field_is_not_valid);
        }
    
        const dataWithoutSchema = data.replace('bitcoin:', '').replace('BITCOIN:', '');
        if (wallet.isAddressValid(dataWithoutSchema)) {
            console.log('dataWithoutSchema: ', dataWithoutSchema)
            // a QR code often carries a bech32 address in capitals: kept in lower case
            setDestinationAddress(normalizeDestination(dataWithoutSchema))
            //   setIsLoading(false);
            return;
        }
    
        let address = '';
        let options;
        try {
          if (!data.toLowerCase().startsWith('bitcoin:')) data = `bitcoin:${data}`;
          const decoded = DeeplinkSchemaMatch.bip21decode(data);
          address = decoded.address;
          options = decoded.options;
        } catch (error) {
          data = data.replace(/(amount)=([^&]+)/g, '').replace(/(amount)=([^&]+)&/g, '');
          const decoded = DeeplinkSchemaMatch.bip21decode(data);
          decoded.options.amount = 0;
          address = decoded.address;
          options = decoded.options;
        }
    
        console.log('options', options);
        if (btcAddressRx.test(address) || address.startsWith('bc1') || address.startsWith('BC1')) {
            setDestinationAddress(normalizeDestination(address));
            console.log('addresss: ', address)
            setTransactionMemo(options.label || options.message);
            setAmountUnit(BitcoinUnit.BTC);
            setPayjoinUrl(options.pj || '');
            // RN Bug: contentOffset gets reset to 0 when state changes. Remove code once this bug is resolved.
        } else {
            SimpleToast.show(loc.cypherbox.vault.cold_storage.bitcoin_address_invalid, SimpleToast.SHORT)
        }
        // setIsLoading(false);
    };
    

    const options = [
        {
            label: loc.send.fee_fast,
            time: loc.send.fee_10m,
            fee: feeAtRate.fastestFee,
            rate: nf.fastestFee,
            active: Number(feeRate) === nf.fastestFee,
        },
        {
            label: loc.send.fee_medium,
            time: loc.send.fee_3h,
            fee: feeAtRate.mediumFee,
            rate: nf.mediumFee,
            active: Number(feeRate) === nf.mediumFee,
            disabled: nf.mediumFee === nf.fastestFee,
        },
        {
            label: loc.send.fee_slow,
            time: loc.send.fee_1d,
            fee: feeAtRate.slowFee,
            rate: nf.slowFee,
            active: Number(feeRate) === nf.slowFee,
            disabled: nf.slowFee === nf.mediumFee || nf.slowFee === nf.fastestFee,
        },
    ];

    const addressHandler = () => {
      console.log('to: ', to)
      dispatchNavigate('WalletAddresses', {
        walletID: wallet.getID(),
        isTouchable: true,
        wallet, 
        vaultTab, 
        utxo, 
        ids, 
        maxUSD, 
        // handed back when the new address is picked, so a Max consolidation stays Max
        inUSD,
        isMaxEdit,
        total, 
        matchedRate, 
        capsulesData, 
        to, 
        toStrike,
        vaultSend, 
        title, 
        type, 
        isBatch,
        currency,
        capsuleTotal
      });
    }

    console.log('to: ', to, toStrike, selectedItem, vaultSend)
    return (
        <ScreenLayout showToolbar>
            <ScrollView style={styles.container} showsVerticalScrollIndicator={useLightningBridge || showFeeInfo} contentContainerStyle={{ paddingBottom: 100 }}>
            <View>
                <Text style={styles.title} center>{labels.title}</Text>
                {/* <SavingVault
                    container={styles.savingVault}
                    innerContainer={styles.savingVault}
                    shadowTopBottom={styles.savingVault}
                    shadowBottomBottom={styles.savingVault}
                    bitcoinText={styles.bitcoinText}
                    imageStyle={styles.bitcoinImage}
                    titleStyle={styles.titleVault}
                    title="Hot Savings"
                    bitcoinValue={balanceWallet}
                    inDollars={`$${(Number(balanceWithoutSuffix) * Number(matchedRate)).toFixed(2)}`}    
                    // onPress={savingVaultClickHandler}
                /> */}
                <View style={styles.recipientView}>
                    {/* <TouchableOpacity onPress={coinThresholdClickHandler}> */}
                    <View>
                        <Text bold style={styles.coinselected}>{loc.cypherbox.vault.cold_storage.capsules_selected}</Text>
                        {capsulesData && capsulesData.length > 0 ? (
                          <View style={{ marginTop: 10, marginBottom: 10 }}>
                            {/* the capsules this transaction spends */}
                            {listedCapsules.map((item: any, i: number) => (
                              <View key={item.id || i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                                <View style={styles.tabs}>
                                  <VaultCapsules item={item.value} />
                                </View>
                                <Text style={[{ fontSize: 11, color: vaultTab ? '#87CEEB' : '#4CAF50', marginLeft: 8 }, rtl.ltrText]}>
                                  {formatSats(item.value || 0)}
                                </Text>
                              </View>
                            ))}
                            {listedCapsules.length < shownCapsules.length && (
                              <TouchableOpacity onPress={() => setShowAllCapsules(true)} accessibilityRole="button" style={styles.showAllCapsules}>
                                <Text style={styles.showAllCapsulesText}>{loc.formatString(loc.cypherbox.vault.cold_storage.show_all_capsules, { count: shownCapsules.length })}</Text>
                              </TouchableOpacity>
                            )}
                            {capsulesNotNeeded > 0 && (
                              <Text style={styles.capsulesNotNeeded}>{loc.formatString(loc.cypherbox.vault.cold_storage.capsules_not_needed, { count: capsulesNotNeeded })}</Text>
                            )}
                            {!!beyondNeed && (
                              <Text style={styles.capsulesNotNeeded}>{loc.formatString(loc.cypherbox.vault.cold_storage.capsules_beyond_need, { count: shownCapsules.length, needed: beyondNeed.needed, fee: groupThousands(beyondNeed.extraFeeSats) })}</Text>
                            )}
                            {sendKind === 'top_up' && capsuleTotal > 0 && (
                              <Text bold style={[styles.coinselected, { fontSize: 12, marginTop: 4 }]}>{loc.formatString(loc.cypherbox.vault.cold_storage.total, { amount: formatBalance(capsuleTotal, BitcoinUnit.BTC, true) })}</Text>
                            )}
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 10, marginBottom: 10 }}>
                            {Array(ids.length).fill(0).map((_, i) => (
                              <View key={i} style={styles.tabs}>
                                <VaultCapsules item={0} />
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    {/* </TouchableOpacity> */}
                    {isBatch ?
                      <View style={{
                        marginTop: 20,
                        marginBottom: 5,
                        // marginBottom:30,
                        // marginStart:15,
                        // marginEnd: 10,
                      }}>
                        <Text bold style={{fontSize: 18}}>{loc.cypherbox.vault.cold_storage.batched_capsule_size}</Text>
                        <View style={{flexDirection: 'row', alignItems: 'center'}}>
                          <TouchableOpacity activeOpacity={0.7} onPress={editAmountClickHandler} style={{
                            flexDirection: 'row', 
                            alignItems: 'center', 
                            alignSelf: 'flex-start',
                            marginTop: 10, 
                            paddingVertical: 8, 
                            paddingHorizontal: 25, 
                            // width: '96%'
                          }}>
                            <Text style={StyleSheet.flatten({
                              // flex: 1,
                              // width: '95%',
                              fontSize: 16,
                              marginTop: 3,
                              marginRight: 15,
                              color: colors.white
                            })}>{formatSats(amountSats)}</Text>
                            <Image source={Edit} style={styles.editImage} resizeMode='contain' />
                          </TouchableOpacity>
                          <Text style={{
                              fontSize: 16,
                              marginTop: 10,
                              marginLeft: 15,
                          }}>
                            {'~' + formatUsd(usd)}
                          </Text>
                        </View>
                        <View style={{flexDirection: 'row', marginTop: 8}}>
                          <View style={styles.tabs}>
                            <VaultCapsules item={amountSats} />
                          </View>
                        </View>
                      </View>
                    :
                      <View style={styles.priceView}>
                          <View>
                              <Text style={styles.recipientTitle}>{labels.amount}</Text>
                              <Text bold style={[styles.value, vaultTab && {color: colors.coldGreen}, rtl.ltrText]}>{formatSats(amountSats) + ' ~' + formatUsd(usd)}</Text>
                              <View style={{flexDirection: 'row', marginTop: 8}}>
                                  <View style={styles.tabs}>
                                      <VaultCapsules item={amountSats} />
                                  </View>
                              </View>
                          </View>
                          <TouchableOpacity style={[styles.editAmount, { borderColor: satsEditable ? primaryColor : '#B6B6B6' }]} onPress={editAmountClickHandler}>
                              <Text>{loc.cypherbox.vault.cold_storage.edit_amount}</Text>
                          </TouchableOpacity>
                      </View>                    
                    }
                    {capsuleTotal > 0 &&
                        (() => {
                            // changeSats is the planned change output: none for Max, and none when
                            // what is left is too small for one. A Consolidate edited to a smaller
                            // capsule has one too, so this shows for every flow.
                            const hotVaultWallet = walletID ? wallets.find(w => w.getID() === walletID) : null;
                            const isSourceHotVault = wallet?.getID() === walletID;
                            const showHotVault = !!hotVaultWallet && !isSourceHotVault;
                            if (changeSats > 0) {
                                return (
                                    <View style={[styles.priceView, {marginTop: 10, flexDirection: 'column'}]}>
                                        <View style={{flexDirection: 'row'}}>
                                            <View style={{flex: 1}}>
                                                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                                                    <Text style={styles.recipientTitle}>{loc.cypherbox.vault.cold_storage.change_capsule}</Text>
                                                    <TouchableOpacity
                                                        onPress={() => setShowChangeInfo(!showChangeInfo)}
                                                        style={{marginLeft: 6, marginTop: -2}}
                                                    >
                                                        <Icon name="info-circle" type="font-awesome" color={showChangeInfo ? (vaultTab ? colors.coldGreen : colors.green) : '#888'} size={14} />
                                                    </TouchableOpacity>
                                                </View>
                                                {showChangeInfo && (
                                                    <View style={{ marginTop: 6, marginBottom: 4, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: vaultTab ? colors.coldGreen : colors.green, backgroundColor: '#1a1a1a' }}>
                                                        <Text style={{ fontSize: 11, color: '#aaa', lineHeight: 16 }}>{loc.cypherbox.vault.cold_storage.change_capsule_info}</Text>
                                                    </View>
                                                )}
                                                <Text bold style={[styles.value, vaultTab && {color: colors.coldGreen}, rtl.ltrText]}>{formatSats(changeSats) + ' ~' + formatUsd(changeSats / SATS * Number(matchedRate))}</Text>
                                                <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 8}}>
                                                    <View style={styles.tabs}>
                                                        <VaultCapsules item={changeSats} />
                                                    </View>
                                                </View>
                                            </View>
                                        </View>
                                        {offersChangeSweep(sendKind) && (isStrikeAuth || isAuth || showHotVault) && (
                                            <View style={{marginTop: 10}}>
                                                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                                                    <Text style={{fontSize: 13, color: '#AAAAAA', marginRight: 8}}>{loc.cypherbox.vault.cold_storage.sweep_change_to}</Text>
                                                    <TouchableOpacity
                                                        onPress={() => setShowChangeMenu(!showChangeMenu)}
                                                        disabled={changeFetchLoading}
                                                        style={{
                                                            flexDirection: 'row',
                                                            alignItems: 'center',
                                                            paddingHorizontal: 12,
                                                            paddingVertical: 5,
                                                            borderRadius: 8,
                                                            borderWidth: 1.5,
                                                            borderColor: changeDestination === 'SELF'
                                                                ? (vaultTab ? colors.coldGreen : colors.green)
                                                                : changeDestination === 'HOT_VAULT' ? colors.green
                                                                : '#FF65D4',
                                                            backgroundColor: 'rgba(255,255,255,0.05)',
                                                        }}
                                                    >
                                                        <Text style={{fontSize: 12, color: '#fff'}}>
                                                            {changeDestination === 'SELF' ? (vaultTab ? loc.cypherbox.vault.cold_storage.cold_vault : loc.cypherbox.vault.cold_storage.hot_vault)
                                                            : changeDestination === 'HOT_VAULT' ? loc.cypherbox.vault.cold_storage.hot_vault
                                                            : changeDestination === 'STRIKE' ? 'Strike'
                                                            : 'CoinOS'}
                                                        </Text>
                                                        <Icon name={showChangeMenu ? 'caret-up' : 'caret-down'} type="font-awesome" color="#999" size={12} containerStyle={{marginLeft: 6}} />
                                                    </TouchableOpacity>
                                                    {changeFetchLoading && (
                                                        <Text style={{fontSize: 11, color: '#888', marginLeft: 8}}>...</Text>
                                                    )}
                                                </View>
                                                {showChangeMenu && (
                                                    <View style={{marginTop: 6, backgroundColor: '#1a1a1a', borderRadius: 8, borderWidth: 1, borderColor: '#333', overflow: 'hidden'}}>
                                                        <TouchableOpacity
                                                            onPress={() => { handleChangeDestination('SELF'); setShowChangeMenu(false); }}
                                                            style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#333'}}
                                                        >
                                                            <Image source={vaultTab ? Cold1 : Hot} style={{width: 14, height: 14, marginRight: 8}} resizeMode="contain" />
                                                            <Text style={{fontSize: 13, color: changeDestination === 'SELF' ? '#fff' : '#999'}}>{vaultTab ? loc.cypherbox.vault.cold_storage.cold_vault : loc.cypherbox.vault.cold_storage.hot_vault}</Text>
                                                            {changeDestination === 'SELF' && <Icon name="check" type="font-awesome" color={vaultTab ? colors.coldGreen : colors.green} size={12} containerStyle={{marginLeft: 'auto'}} />}
                                                        </TouchableOpacity>
                                                        {showHotVault && (
                                                            <TouchableOpacity
                                                                onPress={() => { handleChangeDestination('HOT_VAULT'); setShowChangeMenu(false); }}
                                                                style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#333'}}
                                                            >
                                                                <Image source={Hot} style={{width: 14, height: 14, marginRight: 8}} resizeMode="contain" />
                                                                <Text style={{fontSize: 13, color: changeDestination === 'HOT_VAULT' ? '#fff' : '#999'}}>{loc.cypherbox.vault.cold_storage.hot_vault}</Text>
                                                                {changeDestination === 'HOT_VAULT' && <Icon name="check" type="font-awesome" color={colors.green} size={12} containerStyle={{marginLeft: 'auto'}} />}
                                                            </TouchableOpacity>
                                                        )}
                                                        {isStrikeAuth && (
                                                            <TouchableOpacity
                                                                onPress={() => { handleChangeDestination('STRIKE'); setShowChangeMenu(false); }}
                                                                style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#333'}}
                                                            >
                                                                <Image source={StrikeFull} style={{width: 45, height: 16, marginRight: 8}} resizeMode="contain" />
                                                                {changeDestination === 'STRIKE' && <Icon name="check" type="font-awesome" color="#FF65D4" size={12} containerStyle={{marginLeft: 'auto'}} />}
                                                            </TouchableOpacity>
                                                        )}
                                                        {isAuth && coinosOk && (
                                                            <TouchableOpacity
                                                                onPress={() => { handleChangeDestination('COINOS'); setShowChangeMenu(false); }}
                                                                style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10}}
                                                            >
                                                                <Image source={CoinOS} style={{width: 50, height: 16, marginRight: 8}} resizeMode="contain" />
                                                                {changeDestination === 'COINOS' && <Icon name="check" type="font-awesome" color="#FF65D4" size={12} containerStyle={{marginLeft: 'auto'}} />}
                                                            </TouchableOpacity>
                                                        )}
                                                    </View>
                                                )}
                                            </View>
                                        )}
                                    </View>
                                );
                            }
                            return null;
                        })()
                    }
                    {/* Send-from address removed — now shown per-capsule below */}
                    {/* a top-up or a move to a known address; a send (the Home scan's included) takes any address */}
                    {(to || toStrike || toArk) && !autoSelected ?
                        <View style={[styles.priceView, { marginTop: 0 }]}>
                          <View>
                              {!isBatch &&
                                <>
                                  {!vaultSend &&
                                    <ScrollView
                                      horizontal
                                      showsHorizontalScrollIndicator={false}
                                      // Cards used to wrap a plain row View. With three providers
                                      // (Strike + CoinOS + Ark Vault) on a 393pt iPhone the math
                                      // already overflows (3 × widths*0.3 + 2 × 20pt gap ≈ 394pt),
                                      // cropping the Second card on the right. Future providers
                                      // (e.g. another Lightning rail) would compound. Horizontal
                                      // ScrollView gracefully degrades regardless of N cards.
                                      contentContainerStyle={[
                                        styles.cardListContainer,
                                        type === 'TOPUP' && { justifyContent: 'center' },
                                        { marginTop: 0, marginBottom: 5, gap: 12, paddingHorizontal: 4 },
                                      ]}
                                    >
                                      {data?.filter((item) => {
                                        // When a single destination was committed upstream
                                        // (e.g. the home Top-up flow, where the account is
                                        // chosen on the prior screen, so only one of
                                        // to/toStrike/toArk is passed), hide the non-chosen
                                        // provider cards rather than greying them. When 2+
                                        // destinations are passed (the capsule flow lets the
                                        // user pick the provider on this screen), keep all
                                        // cards visible. Presentation-only: does not change
                                        // selectedItem / destinationAddress routing.
                                        if ([to, toStrike, toArk].filter(Boolean).length > 1) return true;
                                        if (item.id === 1) return !!toStrike; // Strike
                                        if (item.id === 2) return !!to;       // CoinOS
                                        if (item.id === 3) return !!toArk;    // Ark Vault
                                        return true;
                                      }).map((item) => {
                                        const isSelected = selectedItem === item?.id;
                                        return (
                                          <GradientView
                                            key={item.id}
                                            // Honour the enabled gate at the TouchableOpacity layer
                                            // (was previously only checked inside onPress, leaving
                                            // disabled cards visually identical to enabled ones —
                                            // user taps, nothing happens, looks broken). Now disabled
                                            // cards get GradientView's grey-on-grey treatment so the
                                            // affordance matches reality.
                                            disabled={!item.enabled}
                                            onPress={() => {
                                              if (item.enabled) setSelectedItem(item.id);
                                            }}
                                            style={[
                                              styles.cardGradientStyle,
                                              !item.enabled && { opacity: 0.35 },
                                              // Yellow Ark-accent outline on the selected card so
                                              // the selection is unmistakable. The previous design
                                              // relied on the inner/outer shadow swapping color
                                              // when selected, which is subtle to the point of
                                              // invisibility on this dark background.
                                              isSelected && { borderWidth: 2, borderColor: '#FFD54F', borderRadius: 20 },
                                            ]}
                                            linearGradientStyle={styles.cardOuterShadow}
                                            topShadowStyle={[
                                              styles.cardTopShadow,
                                              !isSelected && { shadowColor: colors.gray.disable },
                                            ]}
                                            bottomShadowStyle={[
                                              styles.cardInnerShadow,
                                              !isSelected && { shadowColor: colors.gray.disable },
                                            ]}
                                            linearGradientStyleMain={styles.cardGradientMainStyle}
                                            gradiantColors={[colors.black.bg, colors.black.bg]}
                                          >
                                            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                                              {item.id === 3 ? (
                                                // second.png ships as a multi-color (not a flat alpha
                                                // mask), so `tintColor: '#FFFFFF'` does NOT visibly
                                                // tint it — confirmed empirically and noted in
                                                // src/components/Card/index.tsx:257. MaskedView is the
                                                // working pattern: use the PNG as an alpha mask and
                                                // fill it with a solid white. Other providers (Strike,
                                                // CoinOS) ship as white-on-transparent PNGs already
                                                // and render fine with plain <Image>.
                                                <MaskedView
                                                  style={styles.logoImage}
                                                  maskElement={
                                                    <Image
                                                      source={item?.icon}
                                                      style={styles.logoImage}
                                                      resizeMode="contain"
                                                    />
                                                  }
                                                >
                                                  <View style={[styles.logoImage, { backgroundColor: '#FFFFFF' }]} />
                                                </MaskedView>
                                              ) : (
                                                <Image
                                                  source={item?.icon}
                                                  style={styles.logoImage}
                                                  resizeMode="contain"
                                                />
                                              )}
                                            </View>
                                          </GradientView>
                                        );
                                      })}
                                    </ScrollView>
                                  }
                                </>
                              }
                              {!vaultSend &&
                                <Text style={{fontSize: 12, color: '#AAAAAA'}}>
                                  {selectedItem == 1
                                    ? loc.cypherbox.vault.cold_storage.strike_deposit_label
                                    : selectedItem == 3
                                      ? loc.cypherbox.vault.cold_storage.bark_boarding_label
                                      : loc.cypherbox.vault.cold_storage.coinos_deposit_label}
                                </Text>
                              }
                              {type !== 'TOPUP' && (
                                isBatch ?
                                  <View style={{
                                    // marginBottom:30,
                                    // marginStart:15,
                                    // marginEnd: 10,
                                  }}>
                                    <Text bold style={{fontSize: 18}}>{loc.cypherbox.vault.cold_storage.to}</Text>
                                    <TouchableOpacity activeOpacity={0.7} onPress={addressHandler} style={{
                                      flexDirection: 'row',
                                      alignItems: 'center',
                                      marginTop: 10,
                                      paddingVertical: 8,
                                      paddingHorizontal: 25,
                                      width: '96%'
                                    }}>
                                      <Text italic style={StyleSheet.flatten({
                                        // flex: 1,
                                        width: '95%',
                                        fontSize: 16,
                                        marginTop: 3,
                                        color: vaultTab ? colors.coldGreen : colors.greenShadow
                                      })}>{loc.formatString(loc.cypherbox.vault.cold_storage.vault_address, { address: shortenAddress(to) })}</Text>
                                      <Image source={Edit} style={styles.editImage} resizeMode='contain' />
                                    </TouchableOpacity>
                                  </View>
                                  :
                                  (() => {
                                    // Resolve the actual address shown next to the destination
                                    // label so the user can verify + copy what's going to be
                                    // signed. CoinOS used to be hardcoded when multiple LN
                                    // wallets existed; now it follows selectedItem.
                                    const fullAddr = vaultSend
                                      ? to
                                      : selectedItem == 1
                                        ? (toStrike || '')
                                        : selectedItem == 3
                                          ? (toArk || '')
                                          : (to || '');
                                    return (
                                      <TouchableOpacity
                                        activeOpacity={0.6}
                                        onPress={() => {
                                          if (!fullAddr) return;
                                          Clipboard.setString(fullAddr);
                                          SimpleToast.show(loc.cypherbox.vault.cold_storage.address_copied, SimpleToast.SHORT);
                                        }}
                                        // Stack the address over the copy link instead of
                                        // sharing a row. A P2TR (bc1p, 62-char) boarding
                                        // address competing with the copy link for row width
                                        // wrapped to 3 lines with "copy" stranded mid-address.
                                        // Full-width address wraps to ~2 lines; copy sits below.
                                        style={{ marginTop: 4 }}
                                      >
                                        <Text style={{ fontSize: 11, color: vaultSend ? (vaultTab ? colors.green : colors.coldGreen) : '#888' }}>
                                          {vaultSend ? loc.formatString(loc.cypherbox.vault.cold_storage.vault_address, { address: shortenAddress(to) }) : shortenAddress(fullAddr)}
                                        </Text>
                                        {!!fullAddr &&
                                          <Text style={{ fontSize: 10, color: '#888', marginTop: 3, alignSelf: 'flex-end', textDecorationLine: 'underline' }}>{loc.cypherbox.vault.cold_storage.copy}</Text>
                                        }
                                      </TouchableOpacity>
                                    );
                                  })()
                              )}
                          </View>
                        </View>
                    :
                      (!useLightningBridge && (
                          <View style={styles.pasteview}>
                              <TouchableOpacity style={[styles.button, { borderColor: destinationAddress?.length > 0 ? primaryColor : '#B6B6B6' }]} onPress={pasteClickHandler}>
                                  {destinationAddress ?
                                      // the whole address, wrapped: the pill grows to fit it (styles.button)
                                      <Text bold style={[styles.destinationAddress, rtl.ltrText]}>{destinationAddress}</Text>
                                      :
                                      <Text bold>{loc.cypherbox.vault.cold_storage.paste_destination}</Text>
                                  }
                              </TouchableOpacity>
                              <TouchableOpacity onPress={async () => {
                                  // await scanButtonTapped();
                                  Keyboard.dismiss();
                                  // @ts-ignore: Fix later
                                  scanQrHelper(navigate, "ColdStorage", { wallet, utxo, ids, usd, total, matchedRate, ...route?.params }).then(processAddressData);
                              }}>
                                  <Image source={require("../../../img/scan-new.png")} style={styles.qrcode} resizeMode="contain" />
                              </TouchableOpacity>
                          </View>
                      ))
                    }
                    {title &&
                      <>
                        <Text style={[{marginTop: 20, fontSize: 14}]}>{loc.cypherbox.vault.cold_storage.verify_warning}</Text>
                        <TouchableOpacity activeOpacity={0.7} onPress={() => setIsCheck(!isCheck)} style={{flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 1, alignSelf: 'flex-start' }}>
                          <View style={styles.checkView}>
                            {isCheck && <Image source={Check} style={styles.checkImage} resizeMode='contain' /> }
                          </View>
                          <Text style={{...styles.fees, color: colors.white, marginLeft: 10}} italic>{loc.cypherbox.vault.cold_storage.i_verified}</Text>
                        </TouchableOpacity>
                      </>
                    }
                    <View style={{marginTop: 15}}>
                        <View>
                            {/* Lightning Bridge Toggle — DISABLED FOR NOW, will edit later
                        <View style={{ marginTop: 4, paddingHorizontal: 20 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
                                <Text style={{ fontSize: 14, color: '#ccc' }}>Send to Lightning address ⚡</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <TouchableOpacity onPress={() => setShowFeeInfo(!showFeeInfo)} style={{ marginRight: 12 }}>
                                        <Icon name="info-circle" type="font-awesome" color={showFeeInfo ? '#FF65D4' : '#888'} size={18} />
                                    </TouchableOpacity>
                                    <Switch
                                        value={useLightningBridge}
                                        onValueChange={(v) => {
                                            if (v && !isStrikeAuth && !isAuth) {
                                                Alert.alert('Lightning Account Required', 'Please unlock a Lightning account (Strike or Coinos) to use this feature.');
                                                return;
                                            }
                                            setUseLightningBridge(v);
                                            if(!v) { setLightningInvoice(''); setBridgeProvider(null); }
                                            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                                        }}
                                        ios_backgroundColor="#333333"
                                        thumbColor="#ffffff"
                                        trackColor={{ false: '#666666', true: (isStrikeAuth || isAuth) ? '#FF65D4' : '#444' }}
                                    />
                                </View>
                            </View>
                            {showFeeInfo && (
                                <View style={{ marginTop: 4, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FF65D4', backgroundColor: '#1a1a1a' }}>
                                    <Text style={{ fontSize: 11, color: '#aaa', lineHeight: 16 }}>Sending Bitcoin capsules through the Lightning Network takes two steps: sending from an onchain transaction to a Lightning bridge which takes about ~10-30 min to confirm and for the provider to credit your account. Once that's done, it will ask you to manually approve routing the payment and it will instantaneously reach destination Lightning address.</Text>
                                </View>
                            )}
                            {useLightningBridge && (
                                <View>
                                    <Text style={{ fontSize: 12, color: '#888', marginBottom: 8, marginTop: 4 }}>Paste Lightning address or invoice:</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <TouchableOpacity style={{ flex:1, borderRadius:14, borderWidth:1, borderColor:'#FF65D4', backgroundColor:'#1a1a1a', paddingVertical:14, paddingHorizontal:14 }} onPress={handleLightningPaste}>
                                            <Text style={{color: lightningInvoice ? '#FF65D4' : '#888', fontSize:14 }} numberOfLines={1}>{lightningInvoice || 'Paste Lightning address or invoice'}</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={{marginLeft:8, padding:8}}><Image source={require("../../../img/scan-new.png")} style={{width:20,height:20}} /></TouchableOpacity>
                                    </View>
                                    {(isStrikeAuth || isAuth) && (
                                        <>
                                            <Text style={{ fontSize: 12, color: '#888', marginBottom: 8, marginTop: 16 }}>Choose bridge:</Text>
                                            <View style={{ flexDirection: 'row', gap: 10 }}>
                                                {isStrikeAuth && (
                                                    <TouchableOpacity
                                                        style={{ borderRadius: 12, borderWidth: 1, borderColor: bridgeProvider === 'STRIKE' ? '#FF65D4' : '#333', backgroundColor: '#000000', paddingVertical: 10, paddingHorizontal: 24, alignItems: 'center' }}
                                                        onPress={() => setBridgeProvider('STRIKE')}
                                                    >
                                                        <Text style={{ color: bridgeProvider === 'STRIKE' ? '#FF65D4' : '#fff', fontSize: 14, fontWeight: '600' }}>Strike</Text>
                                                    </TouchableOpacity>
                                                )}
                                                {isAuth && coinosOk && (
                                                    <TouchableOpacity
                                                        style={{ borderRadius: 12, borderWidth: 1, borderColor: bridgeProvider === 'COINOS' ? '#FF65D4' : '#444', backgroundColor: bridgeProvider === 'COINOS' ? '#FF65D433' : '#1a1a1a', paddingVertical: 10, paddingHorizontal: 24, alignItems: 'center' }}
                                                        onPress={() => setBridgeProvider('COINOS')}
                                                    >
                                                        <Text style={{ color: bridgeProvider === 'COINOS' ? '#FF65D4' : '#ccc', fontSize: 14, fontWeight: '600' }}>Coinos</Text>
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                            {bridgeProvider && (
                                                <>
                                                {bridgeProvider === 'STRIKE' && bridgeDepositAddress && (
                                                    <View style={{ marginTop: 16, padding: 12, backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 1, borderColor: '#FF65D4' }}>
                                                        <Text style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Bridge deposit address (verify on device):</Text>
                                                        <Text style={{ fontSize: 12, color: '#FF65D4', fontWeight: '600' }} numberOfLines={2}>{bridgeDepositAddress}</Text>
                                                    </View>
                                                )}
                                                <Text style={{ fontSize: 12, color: '#888', marginTop: 8 }}>Bridge fee: {bridgeProvider === 'STRIKE' ? '0 sats (free)' : '1-100 sats (routing fees)'}</Text>
                                                </>
                                            )}

                                        </>
                                    )}
                                    {!isStrikeAuth && !isAuth && (
                                        <Text style={{ color: '#888', fontSize: 13, fontStyle: 'italic', marginTop: 8 }}>Unlock Lightning Account first</Text>
                                    )}
                                </View>
                            )}
                        </View>
                        */}
                        <Text style={[styles.recipientTitle, { marginTop: 20 }]}>{loc.cypherbox.vault.cold_storage.network_fee}</Text>
                            
                            <Text bold style={[styles.fees, { marginTop: 8 }, rtl.ltrText]}>~ {feeSats !== null ? formatSats(feeSats) : feeRate + " sats/vByte"}{feeSats !== null ? ` (~${formatUsd(feeSats / SATS * Number(matchedRate))})${amountSats > 0 ? ` (${(feeSats / amountSats * 100).toFixed(1)}%)` : ''}` : ''}</Text>
                            {/* say why there is no amount or fee yet, e.g. capsules too small to pay their own fee */}
                            {!plan && !!spend.error && (
                                <Text style={styles.spendError}>{spendErrorText(spend.error)}</Text>
                            )}
                            {/* <Text bold style={styles.fees}>~ {isCustomFee ? customFee + " sats/vByte" :  getCurrentFee().fee + " sats"}</Text> */}
                        </View>
                        {visibleSelection &&
                            <>
                            <TouchableOpacity activeOpacity={1} onPress={() => setVisibleSelection(false)} style={{position: 'absolute', top: -1000, bottom: -1000, left: -1000, right: -1000, zIndex: 99}} />
                            <View style={[styles.feesDropDown, vaultTab && {borderColor: colors.coldGreen}, {zIndex: 100}]}>
                                {options.map((item, index) => {
                                    console.log('item: ', item)
                                    if(item?.fee){
                                        return(
                                            <TouchableOpacity disabled={item.disabled} style={[index % 2 === 0 ? styles.first : styles.second, item.disabled && {opacity: 0.8} ]} onPress={() => {
                                                setCustomFee(item?.rate.toString());
                                                setVisibleSelection(false);
                                                setFeesEditable(true);
                                                setIsCustomFee(false);
                                            }}>
                                                {/* <Text bold style={item.active ? StyleSheet.flatten([styles.border, { paddingHorizontal: 12.5 }]) : {}}>{item.label +' ('+ formatFee(item.fee) + ' ~ ' + item.rate + ' ' + loc.units.sat_vbyte+")"}</Text> */}
                                                <Text bold style={item.active ? StyleSheet.flatten([styles.border, { paddingHorizontal: 12.5 }]) : {}}>{item.label +' (' + item.rate + ' ' + loc.units.sat_vbyte+")"}</Text>
                                            </TouchableOpacity>
                                        )    
                                    } else {
                                        return(
                                            <TouchableOpacity disabled={item.disabled} style={[index % 2 === 0 ? styles.first : styles.second]} onPress={() => {
                                                setCustomFee(item?.rate.toString());
                                                setVisibleSelection(false);
                                                setFeesEditable(true);
                                                setIsCustomFee(false);
                                            }}>
                                                <Text bold style={item.active ? StyleSheet.flatten([styles.border, { paddingHorizontal: 12.5 }]) : {}}>{item.label +' ('+ item.rate + loc.units.sat_vbyte+")"}</Text>
                                            </TouchableOpacity>
                                        )    
                                    }
                                })}
                                <TouchableOpacity style={styles.fourth} onPress={async () => {
                                    dispatchNavigate('FeeRate', {
                                        setCustomFee: f => {
                                            setCustomFee(f);
                                            setIsCustomFee(true);
                                        },
                                        wallet, utxo, ids, usd, total, matchedRate
                                    })

                                    setVisibleSelection(false)
                                }}>
                                    <Text bold style={selectedFees === 3 ? StyleSheet.flatten([styles.border, { paddingHorizontal: 20 }]) : {}}>{loc.cypherbox.vault.cold_storage.customize}</Text>
                                </TouchableOpacity> 
                            </View>
                            </>
                        }
                        <TouchableOpacity style={[styles.editAmount, { flexDirection: 'row', borderColor: feesEditable ? primaryColor : '#B6B6B6', marginStart: 0, marginTop: 16, alignSelf: 'flex-start' }]}
                            onPress={editFeesClickHandler}>
                            <Text style={{ marginStart: 10, }}>{isCustomFee ? loc.cypherbox.vault.cold_storage.customize : getCurrentFee().label}</Text>
                            <View style={{ marginHorizontal: 10 }}>
                                <Icon name="chevron-up" type="font-awesome" color={colors.white} size={10} />
                                <Icon name="chevron-down" type="font-awesome" color={colors.white} size={10} />
                            </View>
                        </TouchableOpacity>
                    </View>
                    {/* <View style={styles.priceView}>
                        <View>
                            <Text style={styles.recipientTitle}>Service fee:</Text>
                            <Text style={styles.fees}>{serviceFees}</Text>
                        </View>
                    </View>
                    <View style={styles.priceView}>
                        <View>
                            <Text style={styles.recipientTitle}>Total fee:</Text>
                            <Text style={styles.fees}>{totalFees}</Text>
                        </View>
                    </View> */}
                    <TextInput
                        value={transactionMemo}
                        onChangeText={setTransactionMemo}
                        placeholder={loc.cypherbox.vault.cold_storage.add_note}
                        placeholderTextColor={colors.white}
                        style={[styles.noteInput, { borderColor: transactionMemo?.length > 0 ? primaryColor : '#B6B6B6', marginTop: 20 }]}
                    />
                </View>
                <TouchableOpacity onPress={nextClickHandler} style={[styles.nextBtn, vaultTab && {backgroundColor: colors.coldGreen}]}>
                    <Text h3>{loc.cypherbox.vault.cold_storage.next}</Text>
                </TouchableOpacity>
            </View>
            {showFirePopup && (
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
                        <View style={{ backgroundColor: '#0a0a0a', padding: 24, borderRadius: 20, borderWidth: 2, borderColor: '#FF65D4', width: '85%', alignItems: 'center' }}>
                            <Text style={{ fontSize: 18, color: '#FF65D4', fontWeight: 'bold', textAlign: 'center', marginBottom: 16 }}>{loc.cypherbox.vault.cold_storage.onchain_confirmed}</Text>
                            
                            {/* Destination */}
                            <View style={{ marginBottom: 16, paddingHorizontal: 16 }}>
                                <Text style={{ fontSize: 12, color: '#888', textAlign: 'center', marginBottom: 4 }}>{loc.cypherbox.vault.cold_storage.to_label}</Text>
                                <Text style={[{ fontSize: 13, color: '#ccc', textAlign: 'center', numberOfLines: 2 }, rtl.ltrText]}>{lightningInvoice}</Text>
                            </View>
                            
                            {/* Electrified Capsule */}
                            <View style={{ marginVertical: 20 }}>
                                <View style={{ 
                                    backgroundColor: '#FF65D4', 
                                    paddingVertical: 12, 
                                    paddingHorizontal: 32, 
                                    borderRadius: 30,
                                    borderWidth: 2,
                                    borderColor: '#fff',
                                    shadowColor: '#FF65D4',
                                    shadowOffset: {width: 0, height: 0},
                                    shadowOpacity: 0.8,
                                    shadowRadius: 20,
                                    elevation: 10
                                }}>
                                    <Text style={[{ fontSize: 24, color: '#fff', fontWeight: 'bold' }, rtl.ltrText]}>{Math.round((Number(usd || 0) / Number(matchedRate || 1)) * 100000000)} sats</Text>
                                </View>
                            </View>
                            
                            <Text style={{ fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 20 }}>{loc.cypherbox.vault.cold_storage.route_lightning_payment}</Text>
                            
                            <TouchableOpacity 
                                onPress={() => setShowFirePopup(false)}
                                style={{ backgroundColor: '#FF65D4', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 25 }}
                            >
                                <Text style={{ fontSize: 16, color: '#fff', fontWeight: 'bold' }}>{loc.cypherbox.vault.cold_storage.route_lightning}</Text>
                            </TouchableOpacity>
                            
                            <TouchableOpacity onPress={() => setShowFirePopup(false)} style={{ marginTop: 16 }}>
                                <Text style={{ fontSize: 14, color: '#666' }}>{loc._.cancel}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            </ScrollView>
        </ScreenLayout>
    )
}
