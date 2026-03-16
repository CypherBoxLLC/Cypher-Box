import React, { useContext, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import { Text } from "@Cypher/component-library";
import { ScreenLayout } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import { BlueStorageContext } from "../../blue_modules/storage-context";
import useAuthStore from "@Cypher/stores/authStore";
import { getTransactionHistory as getCoinosHistory } from "@Cypher/api/coinOSApis";
import { getInvoices as getStrikeHistory } from "@Cypher/api/strikeAPIs";
import { btc, formatNumber } from "@Cypher/helpers/coinosHelper";
import dayjs from "dayjs";

interface TransactionItem {
  id: string;
  type: 'coinos' | 'strike' | 'vault';
  date: string;
  amount: number;
  description: string;
  status?: string;
}

export default function GlobalHistory() {
  const { isAuth, isStrikeAuth } = useAuthStore();
  const { wallets, walletTransactionUpdateStatus } = useContext(BlueStorageContext);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadAllTransactions();
  }, []);

  const loadAllTransactions = async () => {
    setIsLoading(true);
    let allTransactions: TransactionItem[] = [];

    try {
      // Load Coinos transactions if logged in
      if (isAuth) {
        try {
          const coinosData = await getCoinosHistory(0, 20);
          if (coinosData?.payments) {
            const coinosTxs = coinosData.payments.map((payment: any) => ({
              id: `coinos-${payment.id}`,
              type: 'coinos' as const,
              date: payment.created_at,
              amount: payment.amount,
              description: payment.with?.username || payment.description || 'Coinos',
              status: payment.status,
            }));
            allTransactions = [...allTransactions, ...coinosTxs];
          }
        } catch (e) {
          console.log('Error loading Coinos history:', e);
        }
      }

      // Load Strike transactions if logged in
      if (isStrikeAuth) {
        try {
          const strikeData = await getStrikeHistory(0, 20);
          if (strikeData?.invoices) {
            const strikeTxs = strikeData.invoices.map((invoice: any) => ({
              id: `strike-${invoice.id}`,
              type: 'strike' as const,
              date: invoice.created,
              amount: invoice.amount ? invoice.amount * 100000000 : 0,
              description: invoice.description || 'Strike',
              status: invoice.state,
            }));
            allTransactions = [...allTransactions, ...strikeTxs];
          }
        } catch (e) {
          console.log('Error loading Strike history:', e);
        }
      }

      // Load Vault transactions
      const allWallets = wallets || [];
      for (const wallet of allWallets) {
        try {
          const walletTxs = wallet.getTransactions ? wallet.getTransactions(10) : [];
          if (walletTxs?.length > 0) {
            const vaultTxs = walletTxs.map((tx: any) => ({
              id: `vault-${wallet.getID()}-${tx.hash}`,
              type: 'vault' as const,
              date: tx.received_at,
              amount: tx.amount,
              description: wallet.getLabel ? wallet.getLabel() : 'Hot/Cold Vault',
              status: tx.confirmations > 0 ? 'confirmed' : 'pending',
            }));
            allTransactions = [...allTransactions, ...vaultTxs];
          }
        } catch (e) {
          console.log('Error loading wallet transactions:', e);
        }
      }

      // Sort by date (newest first)
      allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setTransactions(allTransactions);
    } catch (e) {
      console.log('Error loading global history:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadAllTransactions();
    setIsRefreshing(false);
  };

  const renderItem = ({ item }: { item: TransactionItem }) => {
    const isPositive = item.amount > 0;
    const btcAmount = btc(Math.abs(item.amount));

    return (
      <View style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 15,
        borderBottomWidth: 1,
        borderBottomColor: colors.gray.dark,
      }}>
        <View>
          <Text bold style={{ color: colors.white }}>
            {item.type.toUpperCase()}
          </Text>
          <Text style={{ color: colors.gray.default, fontSize: 12 }}>
            {dayjs(item.date).format('MMM DD, YYYY HH:mm')}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text bold style={{ color: isPositive ? colors.green : colors.pink.default }}>
            {isPositive ? '+' : '-'}{btcAmount} BTC
          </Text>
          <Text style={{ color: colors.gray.default, fontSize: 12 }}>
            {item.description}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <ScreenLayout showToolbar title="Transaction History">
      {isLoading ? (
        <ActivityIndicator size="large" color={colors.green} />
      ) : transactions.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text bold style={{ color: colors.white }}>No transactions yet</Text>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.green}
            />
          }
        />
      )}
    </ScreenLayout>
  );
}