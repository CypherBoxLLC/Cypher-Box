import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Input, Text } from "@Cypher/component-library";
import { ActivityIndicator, Animated, Dimensions, FlatList, ImageBackground, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import SimpleToast from "react-native-simple-toast";
import styles from "./styles";
import { GradientCard, GradientView } from "@Cypher/components";
import ListView from "./ListView";
// import BackgroundSvg from '../../assets/svg/transaction.svg';
// import Bitcoin from '../../assets/svg/bitcoin.svg';
import { colors, heights, widths } from "@Cypher/style-guide";
import debounce from "../../../blue_modules/debounce";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import screenHeight from "@Cypher/style-guide/screenHeight";
import { btc as btcHandle } from "@Cypher/helpers/coinosHelper";
import { dispatchNavigate } from "@Cypher/helpers";
import BottomModal from "../../../components/BottomModal";
import { useTheme } from "../../../components/themes";
import { OutputModalContent } from "../../../screen/send/coinControl";
import { createInvoice } from "@Cypher/api/coinOSApis";
import { AbstractWallet } from "../../../class";
import useAuthStore from "@Cypher/stores/authStore";
import { createInvoice as createInvoiceStrike } from "@Cypher/api/strikeAPIs";
// import { Bitcoin, Transaction, TransactionN } from "@Cypher/assets/svg";

export default function Capsules({ wallet, matchedRate, currency, to, vaultTab, toStrike }: any) {
    const { colors: themeColors } = useTheme();
    const [ids, setIds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [output, setOutput] = useState();
    const [bitcoinHash, setBitcoinHash] = useState();
    const [bitcoinStrikeHash, setBitcoinStrikeHash] = useState();
    console.log("🚀 ~ Capsules ~ ids:", ids)
    const [btc, setBtc] = useState('0.00');
    const [sendToAddress, setSendToAddress] = useState();
    const [selfAddress, setSelfAddress] = useState();
    const utxo = wallet.getUtxo(true).sort((a, b) => a.height - b.height || a.txid.localeCompare(b.txid) || a.vout - b.vout);
    const primaryColor = vaultTab ? colors.coldGreen : colors.green
    const [frozen, setFrozen] = useState(
        utxo.filter(out => wallet.getUTXOMetadata(out.txid, out.vout).frozen).map(({ txid, vout }) => `${txid}:${vout}`),
    );
    const { walletID, coldStorageWalletID, isAuth, isStrikeAuth, strikeUser } = useAuthStore();
    const { wallets, saveToDisk, sleep, isElectrumDisabled } = useContext(BlueStorageContext);

    const debouncedSaveFronen = useRef(
        debounce(async frzn => {
            utxo.forEach(({ txid, vout }) => {
                wallet.setUTXOMetadata(txid, vout, { frozen: frzn.includes(`${txid}:${vout}`) });
            });
            await saveToDisk();
        }, 500),
    );

    useEffect(() => {
        debouncedSaveFronen.current(frozen);
    }, [frozen]);

    useEffect(() => {
        (async () => {
            try {
                obtainWalletAddress();
                obtainSelfWalletAddress();
                await Promise.race([wallet.fetchUtxo(), sleep(10000)]);
            } catch (e) {
                console.log('coincontrol wallet.fetchUtxo() failed'); // either sleep expired or fetchUtxo threw an exception
            }
            const freshUtxo = wallet.getUtxo(true);
            setFrozen(freshUtxo.filter(out => wallet.getUTXOMetadata(out.txid, out.vout).frozen).map(({ txid, vout }) => `${txid}:${vout}`));
            setLoading(false);
        })();
    }, [wallet, setLoading, sleep]);
    // const offset = useRef(new Animated.Value(0)).current;
    // console.log("🚀 ~ Coins ~ offset:", offset);

    useEffect(() => {
        if(isAuth){
            (async () => {
                try {
                    const response = await createInvoice({
                        type: 'bitcoin',
                    });
                    setBitcoinHash(response.hash)
                    console.log('response: ', response)
                } catch (error) {
                    console.error('Error generating bitcoin address Capsules createInvoice:', error);
                }
            })();
        }
    }, [isAuth]);

    useEffect(() => {
        if(isStrikeAuth){
            (async () => {
                try {
                    const responseStrike = await createInvoiceStrike({
                        onchain: {
                        },
                        targetCurrency: strikeUser?.[1].currency || "USD"
                    });
                    console.warn('responseStrike: ', responseStrike)
                    setBitcoinStrikeHash(responseStrike.onchain?.address)
                } catch (error) {
                    console.error('Error generating bitcoin address Capsules createInvoiceStrike:', error);
                }
            })();
        }
    }, [isStrikeAuth])

    const obtainWalletAddress = async () => {
        let newAddress;
        const allWallets = wallets.concat(false);
        const walletTemp = vaultTab ? allWallets.find((w: AbstractWallet) => w.getID() === walletID) : allWallets.find((w: AbstractWallet) => w.getID() === coldStorageWalletID);    
        try {
            if (!isElectrumDisabled) newAddress = await Promise.race([walletTemp.getAddressAsync(), sleep(1000)]);
        } catch (_) { }
        if (newAddress === undefined) {
            // either sleep expired or getAddressAsync threw an exception
            console.warn('either sleep expired or getAddressAsync threw an exception');
            newAddress = walletTemp._getExternalAddressByIndex(walletTemp.getNextFreeAddressIndex());
        } else {
            saveToDisk(); // caching whatever getAddressAsync() generated internally
        }
        console.log('newAddress: ', newAddress)
        setSendToAddress(newAddress);
    }

    const obtainSelfWalletAddress = async () => {
        let newAddress;
        const allWallets = wallets.concat(false);
        const walletTemp = vaultTab ? allWallets.find((w: AbstractWallet) => w.getID() === coldStorageWalletID) : allWallets.find((w: AbstractWallet) => w.getID() === walletID);    
        try {
            if (!isElectrumDisabled) newAddress = await Promise.race([walletTemp.getAddressAsync(), sleep(1000)]);
        } catch (_) { }
        if (newAddress === undefined) {
            // either sleep expired or getAddressAsync threw an exception
            console.warn('either sleep expired or getAddressAsync threw an exception');
            newAddress = walletTemp._getExternalAddressByIndex(walletTemp.getNextFreeAddressIndex());
        } else {
            saveToDisk(); // caching whatever getAddressAsync() generated internally
        }
        console.log('newAddress: ', newAddress)
        setSelfAddress(newAddress);
    }

    const moveToVaultClickHandler = async () => {
        let capsulesData: any = [];
        let capsuleTotal: any = 0;
        ids.forEach(id => {
            const result = utxo?.find(obj => `${obj.txid}:${obj.vout}` === id)?.value;
            if (result) capsulesData.push({
                id, value: result
            });
            capsuleTotal += Number(result)
        });
        if(vaultTab && !walletID){
            SimpleToast.show("You need to create a Hot Vault first before moving capsules to it", SimpleToast.SHORT)
        } else if(!vaultTab && !coldStorageWalletID){
            SimpleToast.show("You need to create a Cold Vault first before moving capsules to it", SimpleToast.SHORT)
        }
        else if (ids.length > 0) {
            dispatchNavigate('ColdStorage', {wallet, currency, utxo, ids, maxUSD: total, isMaxEdit: true, inUSD: inUSD, total: total, matchedRate, capsulesData, to: sendToAddress, vaultTab, vaultSend: true, title: !vaultTab ? "Transfer To Cold Vault" : undefined, capsuleTotal});
        } else {
            SimpleToast.show("Please select Capsules to Send", SimpleToast.SHORT)
        }
    }

    console.log('selfAddress: ', selfAddress)

    const sendToBatchClickHandler = async () => {
        let capsulesData: any = [];
        let capsuleTotal: any = 0;
        ids.forEach(id => {
            const result = utxo?.find(obj => `${obj.txid}:${obj.vout}` === id)?.value;
            if (result) capsulesData.push({
                id, value: result
            });
            capsuleTotal += Number(result)
        });
        console.log('capsuleTotal: ', capsuleTotal)
        if (ids.length > 0) {
            dispatchNavigate('ColdStorage', {wallet, currency, capsuleTotal, utxo, ids, isMaxEdit: true, maxUSD: total, inUSD: inUSD, total: total, matchedRate, capsulesData, to: selfAddress, vaultTab, vaultSend: true, title: vaultTab ? "Batch Capsules" : undefined, isBatch: true});
        } else {
            SimpleToast.show("Please select Capsules to Send", SimpleToast.SHORT)
        }
    }

    const addressClickHandler = async () => {
        // if(!isAuth){
        //     SimpleToast.show('You need to be logged in to Coinos.io to top up', SimpleToast.SHORT);
        //     return;
        // }
        if (!isAuth && !isStrikeAuth) {
            SimpleToast.show('You need to be logged in to wallet to top up', SimpleToast.SHORT);
            return
        }
        let capsulesData: any = [];
        let capsuleTotal: any = 0;
        ids.forEach(id => {
            const result = utxo?.find(obj => `${obj.txid}:${obj.vout}` === id)?.value;
            if (result) capsulesData.push({
                id, value: result
            });
            capsuleTotal += Number(result)
        });
        if (ids.length > 0) {
            dispatchNavigate('EditAmount', { isEdit: false, currency, capsuleTotal, vaultTab, wallet, utxo, ids, maxUSD: total, inUSD: inUSD.toFixed(2), total, matchedRate, capsulesData, to: bitcoinHash, toStrike: bitcoinStrikeHash, type: "TOPUP" });
            // dispatchNavigate('ColdStorage', {wallet, currency, capsuleTotal, utxo, ids, vaultTab, maxUSD: total, inUSD: inUSD, total: total, matchedRate, capsulesData, to: bitcoinHash, toStrike: bitcoinStrikeHash, type: "TOPUP"});
        } else {
            SimpleToast.show("Please select Capsules to Send", SimpleToast.SHORT)
        }
    };
    
    // const addressClickHandler = () => { }

    const { total, inUSD } = useMemo(() => {
        let total = 0;
        ids.forEach(id => {
            const result = utxo?.find(obj => `${obj.txid}:${obj.vout}` === id)?.value;
            if (result) total += result;
        });
        const currency = btcHandle(1);
        const inUSD = Number(total) * Number(matchedRate) * currency;
        const BTCAmount = btcHandle(total);

        // const inUSD = total * 63749.40;
        return { total: BTCAmount, inUSD };
    }, [ids, utxo]);

    const onPressClickHandler = (id_: string) => {
        console.log("🚀 ~ onPressClickHandler ~ id:", id_)
        const isExist = ids.includes(id_);
        let newIds = [];
        if (isExist) {
            newIds = ids.filter(id => id != id_);
        } else {
            newIds = [...ids, id_];
        }
        setIds(newIds);
    }

    const handleSendBars = () => {
        if (ids.length > 0) {
            const usd = inUSD.toFixed(2);
            let capsulesData: any = [];
            utxo.forEach((u: any) => {
                const result = ids.includes(`${u.txid}:${u.vout}`);
                if (result) capsulesData.push({
                    id: `${u.txid}:${u.vout}`,
                    value: u.value || u.amount,
                });
            });
            const capsuleTotal = capsulesData.reduce((acc: number, c: any) => acc + (c.value || 0), 0);
            dispatchNavigate('EditAmount', { isEdit: false, currency, vaultTab, wallet, utxo, ids, maxUSD: total, inUSD: inUSD.toFixed(2), total, matchedRate, to, toStrike, capsulesData, capsuleTotal });
        } else {
            SimpleToast.show("Please select Capsules to Send", SimpleToast.SHORT)
        }
    };

    const handleChoose = item => setOutput(item);

    const handleUseCoin = u => {
        console.log('u: ', u[0])
        onPressClickHandler(`${u[0].txid}:${u[0].vout}`)
        setOutput(undefined);
        // onUTXOChoose(u);
    };

    const renderOutputModalContent = () => {
        const oFrozen = frozen.includes(`${output.txid}:${output.vout}`);
        const setOFrozen = value => {
            if (value) {
                setFrozen(f => [...f, `${output.txid}:${output.vout}`]);
            } else {
                setFrozen(f => f.filter(i => i !== `${output.txid}:${output.vout}`));
            }
        };
        return <OutputModalContent output={output} wallet={wallet} onUseCoin={handleUseCoin} frozen={oFrozen} setFrozen={setOFrozen} vaultTab={vaultTab} />;
    };

    return (
        <View style={styles.flex}>
            <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
                <Text bold style={[styles.desc, {flex: 1}]}>Select your UTXO capsules to send, consolidate, move to Cold Vault, or Top-up your Lightening Account:</Text>
                <TouchableOpacity onPress={() => dispatchNavigate('CapsuleCatalog')} style={{marginLeft: 10, marginRight: 15, marginTop: 5, width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: vaultTab ? colors.coldGreen : colors.green, alignItems: 'center', justifyContent: 'center'}}>
                    <Text bold style={{color: vaultTab ? colors.coldGreen : colors.green, fontSize: 14}}>?</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.titleStyle}>
                <Text bold style={styles.coin}>Capsules</Text>
                <Text bold style={styles.size}>Size</Text>
                <Text bold style={styles.label}>Label</Text>
                <Text bold style={styles.select}>Select</Text>
            </View>
            <View style={styles.border} />
            {loading ?
                <ActivityIndicator style={{ marginTop: 10, marginBottom: 20 }} color={colors.white} />
                :
                <FlatList
                    data={utxo}
                    keyExtractor={(_, index) => index.toString()}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={() => (
                        <View style={{ height: screenHeight / 3.5, justifyContent: 'center', alignItems: 'center', marginTop: 30 }}>
                            <Text white h3 bold>This wallet does not have any coins at the moment.</Text>
                        </View>
                    )}
                    renderItem={({ item, index }) => <ListView wallet={wallet} item={item} onPress={onPressClickHandler} handleChoose={handleChoose} ids={ids} vaultTab={vaultTab} />}
                    style={{marginTop: 10}}
                />
            }
            {/* <ScrollView>
                {data.map((data_, index) => <ListView item={data_} onPress={onPressClickHandler} ids={ids} />)}
            </ScrollView> */}
            <View style={styles.bottomViewNew}>
                <Text h2 center>Size of selected capsules:</Text>
                <View style={styles.priceView}>
                    <Input
                        onChange={setBtc}
                        value={`${total} BTC`}
                        keyboardType="number-pad"
                        editable={false}
                        textInputStyle={StyleSheet.flatten([styles.input, { borderColor: btc?.length > 0 ? primaryColor : colors.gray.default }])}
                    />
                    <Text h2 bold numberOfLines={1} style={{ marginStart: 10, width: 100, }}>~$ {inUSD.toFixed(2)}</Text>
                </View>
                <Text bold center style={styles.tips}>Tip: Selecting small capsules will increase network fees</Text>
                {vaultTab ?
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                    }}>
                        <GradientView
                            onPress={handleSendBars}
                            style={styles.capsuleLinearGradientStyle}
                            linearGradientStyle={styles.capsuleMainShadowStyle}
                            topShadowStyle={[styles.capsuleOuterShadowStyle, vaultTab && { shadowColor: colors.coldGreen}]}
                            bottomShadowStyle={[styles.capsuleInnerShadowStyle, vaultTab && { shadowColor: colors.coldGreen}]}
                            linearGradientStyleMain={styles.capsuleLinearGradientStyleMain}
                        >
                            <Text h3 center>Send</Text>
                        </GradientView>
                        <GradientView
                            onPress={addressClickHandler}
                            topShadowStyle={[styles.capsuleOuterShadowStyle, vaultTab && { shadowColor: colors.coldGreen}]}
                            bottomShadowStyle={[styles.capsuleInnerShadowStyle, vaultTab && { shadowColor: colors.coldGreen}]}
                            style={[styles.capsuleLinearGradientStyle, { marginStart: 25 }]}
                            linearGradientStyle={styles.capsuleMainShadowStyle}
                            linearGradientStyleMain={styles.capsuleLinearGradientStyleMain}
                        >
                            <Text h3 center>Top-up</Text>
                        </GradientView>
                    </View>
                :
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                    }}>
                        <GradientView
                            onPress={handleSendBars}
                            style={styles.capsuleLinearGradientStyle}
                            linearGradientStyle={styles.capsuleMainShadowStyle}
                            topShadowStyle={[styles.capsuleOuterShadowStyle, vaultTab && { shadowColor: colors.coldGreen}]}
                            bottomShadowStyle={[styles.capsuleInnerShadowStyle, vaultTab && { shadowColor: colors.coldGreen}]}
                            linearGradientStyleMain={styles.capsuleLinearGradientStyleMain}
                        >
                            <Text h3 center>Send</Text>
                        </GradientView>
                        <GradientView
                            onPress={addressClickHandler}
                            topShadowStyle={[styles.capsuleOuterShadowStyle, vaultTab && { shadowColor: colors.coldGreen}]}
                            bottomShadowStyle={[styles.capsuleInnerShadowStyle, vaultTab && { shadowColor: colors.coldGreen}]}
                            style={[styles.capsuleLinearGradientStyle, { marginStart: 25 }]}
                            linearGradientStyle={styles.capsuleMainShadowStyle}
                            linearGradientStyleMain={styles.capsuleLinearGradientStyleMain}
                        >
                            <Text h3 center>Top-up</Text>
                        </GradientView>
                    </View>
                }
                <View style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 10,
                    marginRight: 35
                }}>
                    <GradientView
                        onPress={sendToBatchClickHandler}
                        style={styles.capsuleLinearGradientStyle}
                        linearGradientStyle={styles.capsuleMainShadowStyle}
                        topShadowStyle={[styles.capsuleOuterShadowStyle, vaultTab && { shadowColor: colors.coldGreen}]}
                        bottomShadowStyle={[styles.capsuleInnerShadowStyle, vaultTab && { shadowColor: colors.coldGreen}]}
                        linearGradientStyleMain={styles.capsuleLinearGradientStyleMain}
                    >
                        <Text h3 center>Consolidate</Text>
                    </GradientView>
                    <GradientView
                        onPress={moveToVaultClickHandler}
                        topShadowStyle={[styles.capsuleOuterShadowStyle, vaultTab && { shadowColor: colors.coldGreen}]}
                        bottomShadowStyle={[styles.capsuleInnerShadowStyle, vaultTab && { shadowColor: colors.coldGreen}]}
                        style={[styles.capsuleLinearGradientStyle]}
                        linearGradientStyle={styles.capsuleMainShadowStyle}
                        linearGradientStyleMain={[styles.capsuleLinearGradientStyleMain]}
                    >
                        <Text h4 center>{vaultTab ? "Move to Hot Vault" : "Move to Cold Vault"}</Text>
                    </GradientView>
                </View>
            </View>
            <BottomModal
                isVisible={Boolean(output)}
                onClose={() => {
                    Keyboard.dismiss();
                    setOutput(undefined);
                }}
            >
                <KeyboardAvoidingView enabled={!Platform?.isPad} behavior={Platform.OS === 'ios' ? 'position' : null}>
                    <View style={[styles.modalContent, { backgroundColor: themeColors.elevated }]}>{output && renderOutputModalContent()}</View>
                </KeyboardAvoidingView>
            </BottomModal>

        </View>
    )
}