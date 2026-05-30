import React, { useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, SectionList, View } from "react-native";
import dayjs from "dayjs";

import { Text } from "@Cypher/component-library";
import styles from "./styles";
import { colors } from "@Cypher/style-guide";
import Items from "./Items";
import Header from "./Header";
import { BlueStorageContext, WalletTransactionsStatus } from "../../../blue_modules/storage-context";
import screenHeight from "@Cypher/style-guide/screenHeight";
import { dispatchNavigate } from "@Cypher/helpers";
import { detectCpfpRelations } from "./cpfpDetection";

export default function History({ wallet, matchedRate, vaultTab }: any) {

    const { wallets, saveToDisk, setSelectedWalletID, walletTransactionUpdateStatus, isElectrumDisabled } = useContext(BlueStorageContext);
    const [dataSource, setDataSource] = useState(wallet.getTransactions(5));
    const [limit, setLimit] = useState(5);
    const [pageSize, setPageSize] = useState(5);
    const [isRefreshing, setIsRefreshing] = useState(false); // a simple flag to know that wallet was being updated once
    const [isLoading, setIsLoading] = useState(false);
    const [itemPriceUnit, setItemPriceUnit] = useState(wallet.getPreferredBalanceUnit());
    const [timeElapsed, setTimeElapsed] = useState(0);

    // const handleCoinControl = () => {
    //     const walletID = wallet.getID()
    //   };

    useEffect(() => {

        if (walletTransactionUpdateStatus === wallet.getID()) {
            // wallet is being refreshed, drawing the 'Updating...' header:
            setIsRefreshing(true);
          }
        if (isRefreshing && walletTransactionUpdateStatus === WalletTransactionsStatus.NONE) {
            // if we are here this means that wallet was being updated (`walletTransactionUpdateStatus` was set, and
            // `isRefreshing` flag was set) and we displayed "Updating..." message,
            // and when it ended `walletTransactionUpdateStatus` became false (flag `isRefreshing` stayed).
            // chances are that txs list changed for the wallet, so we need to re-render:
            console.log('re-rendering transactions');
            setDataSource([...getTransactionsSliced(limit)]);
            setIsRefreshing(false);
          }
      
    }, [wallet])

    useEffect(() => {
        setIsLoading(true);
        setLimit(5);
        setPageSize(1);
        setTimeElapsed(0);
        setItemPriceUnit(wallet.getPreferredBalanceUnit());
        setIsLoading(false);
        setSelectedWalletID(wallet.getID());
        setDataSource([...getTransactionsSliced(limit)]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (wallet.getLastTxFetch() === 0) {
            refreshTransactions();
        }
      }, [wallet]);

    const refreshTransactions = async () => {
        if (isElectrumDisabled) return setIsLoading(false);
        if (isLoading) return;
        setIsLoading(true);
        let noErr = true;
        let smthChanged = false;
        try {
          // await BlueElectrum.ping();
          if (wallet.allowBIP47() && wallet.isBIP47Enabled()) {
            const pcStart = +new Date();
            await wallet.fetchBIP47SenderPaymentCodes();
            const pcEnd = +new Date();
            console.log(wallet.getLabel(), 'fetch payment codes took', (pcEnd - pcStart) / 1000, 'sec');
          }
          const balanceStart = +new Date();
          const oldBalance = wallet.getBalance();
          await wallet.fetchBalance();
          if (oldBalance !== wallet.getBalance()) smthChanged = true;
          const balanceEnd = +new Date();
          console.log(wallet.getLabel(), 'fetch balance took', (balanceEnd - balanceStart) / 1000, 'sec');
          const start = +new Date();
          const oldTxLen = wallet.getTransactions().length;
          let immatureTxsConfs = ''; // a silly way to keep track if anything changed in immature transactions
          for (const tx of wallet.getTransactions()) {
            if (tx?.confirmations < 7) immatureTxsConfs += tx.txid + ':' + tx.confirmations + ';';
          }
          await wallet.fetchTransactions();
          if (wallet.fetchPendingTransactions) {
            await wallet.fetchPendingTransactions();
          }
          if (wallet.fetchUserInvoices) {
            await wallet.fetchUserInvoices();
          }
          if (oldTxLen !== wallet.getTransactions().length) smthChanged = true;
          let unconfirmedTxsConfs2 = ''; // a silly way to keep track if anything changed in immature transactions
          for (const tx of wallet.getTransactions()) {
            if (tx?.confirmations < 7) unconfirmedTxsConfs2 += tx.txid + ':' + tx.confirmations + ';';
          }
          if (unconfirmedTxsConfs2 !== immatureTxsConfs) {
            smthChanged = true;
          }
          const end = +new Date();
          console.log(wallet.getLabel(), 'fetch tx took', (end - start) / 1000, 'sec');
        } catch (err) {
          noErr = false;
          // alert(err.message);
          setIsLoading(false);
          setTimeElapsed(prev => prev + 1);
        }
        if (noErr && smthChanged) {
          console.log('saving to disk');
          await saveToDisk(); // caching
          setDataSource([...getTransactionsSliced(limit)]);
        }
        setIsLoading(false);
        setTimeElapsed(prev => prev + 1);
    };

    const getTransactionsSliced = (lmt = Infinity) => {
        let txs = wallet.getTransactions();
        console.log('txs: ', txs.length)
        for (const it of txs) {
          it.sort_ts = +new Date(it.received);
        }
        txs = txs.sort(function (a, b) {
          return b.sort_ts - a.sort_ts;
        });
        return txs.slice(0, lmt);
    };
    

    // Detect CPFP relationships across the FULL tx list (not just the
    // paginated slice in `dataSource`) so a parent-of-child relationship
    // isn't missed when the child pages out. Memoised on the tx list
    // identity — recomputes only when a sync delta lands.
    const { accelerators, suppressedChildIds } = useMemo(
        () => detectCpfpRelations(wallet.getTransactions(), wallet),
        // dataSource changes whenever new txs arrive; using it as the
        // dependency keeps the memo aligned with the rendered list.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [wallet, dataSource],
    );

    const onPressHandler = (item: any) => {
        dispatchNavigate('SendReceiveOnChain', {
            transaction: item,
            history: true,
            matchedRate,
            wallet,
            // Pass the accelerator info through so the detail screen can
            // gate the Accelerate button (already-bumped parents must not
            // be bumped again — the parent's output is already spent by
            // the existing child and CPFP would fail with a "missing utxo"
            // error in createCPFPbumpFee).
            cpfpAccelerator: accelerators.get(item?.hash || item?.txid) ?? null,
        });
    };

    const transformDataToSections = (data) => {
        const groupedData = data.reduce((acc, item) => {
            const date = dayjs(item.received).format('ddd MMM DD YYYY');
            if (!acc[date]) acc[date] = [];
            acc[date].push(item);
            return acc;
        }, {});

        return Object.keys(groupedData).map(date => ({
            title: date,
            data: groupedData[date]
        }));
    };

    // Suppress CPFP child rows from the displayed list. They're rendered
    // implicitly via the "⚡ Accelerated" badge on their parent.
    const visibleData = useMemo(
        () => dataSource.filter((tx: any) => !suppressedChildIds.has(tx?.hash || tx?.txid)),
        [dataSource, suppressedChildIds],
    );

    const sections = transformDataToSections(visibleData);

    console.log('getTransactionsSliced(Infinity).length: ', getTransactionsSliced(Infinity).length, sections, limit)

    return (
        <View style={{
            flex: 1, 
            marginTop: 15,
            borderTopColor: '#5E5E5E',
            borderTopWidth: 0.5,
        }}>
            <SectionList
                sections={sections}
                keyExtractor={(item, index) => index.toString()}
                renderItem={({ item }) => <Items wallet={wallet} matchedRate={matchedRate}  item={item} onPressHandler={() => onPressHandler(item)} vaultTab={vaultTab} cpfpChildInfo={accelerators.get(item?.hash || item?.txid) ?? null} />}
                renderSectionHeader={({ section: { title } }) => <Header title={title} />}
                onEndReached={async () => {
                    // pagination in works. in this block we will add more txs to FlatList
                    // so as user scrolls closer to bottom it will render mode transactions
        
                    if (getTransactionsSliced(Infinity).length < limit) {
                      // all list rendered. nop
                      return;
                    }
        
                    setDataSource(getTransactionsSliced(limit + pageSize));
                    setLimit(prev => prev + pageSize);
                    setPageSize(prev => prev * 2);
                }}
                onEndReachedThreshold={0.1}
                ListFooterComponent={() => {
                    return (wallet.getTransactions().length > limit && <ActivityIndicator style={{ marginTop: 10, marginBottom: 20 }} color={colors.white} />) || null;
                }}
                ListEmptyComponent={() => (
                    <View style={{ height: screenHeight / 2, justifyContent: 'center', alignItems: 'center', marginTop: 30 }}>
                        <Text white h3 bold>No Transactions History</Text>
                    </View>
                )}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={refreshTransactions}
                        tintColor="white"
                    />
                }
                contentContainerStyle={{
                    // borderTopColor: colors.white,
                    // borderTopWidth: 1,
                    // borderBottomColor: colors.white,
                    // borderBottomWidth: 1,
                }}
                style={{
                    flex: 1,
                    // borderTopColor: colors.white,
                    // borderTopWidth: 1,
                }}
                // invertStickyHeaders
            />
            <View style={styles.bottomView} />
        </View>
    )
}