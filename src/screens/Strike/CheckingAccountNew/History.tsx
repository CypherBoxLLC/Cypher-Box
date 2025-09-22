import { Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  SectionList,
  View,
} from "react-native";
import Header from "./Header";
import Items from "./Items";
import styles from "./styles";
import { getTransactionHistory } from "@Cypher/api/coinOSApis";
import { getInvoices } from "@Cypher/api/strikeAPIs";
import screenHeight from "@Cypher/style-guide/screenHeight";
import { CoinOS } from "@Cypher/assets/images";

export default function History({ matchedRate, receiveType, currency }: any) {
  const [isLoading, setIsLoading] = useState(false);
  const [payments, setPayments] = useState<any>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [limit] = useState(7);
  const [offset, setOffset] = useState(0);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (receiveType)
      loadPayments();
    else
      loadStrikePayments();
  }, [offset, receiveType]);

  const onPressHandler = (item: any) => {
    dispatchNavigate('Invoice', {
      item: item,
      matchedRate,
      receiveType
    });
  }

  const loadPayments = async (append = true) => {
    offset == 0 && setIsLoading(true);
    try {
      const paymentList : any = await getTransactionHistory(offset, limit);
      if (append && offset > 0) {
        setPayments((prevPayments:any) => [...prevPayments, ...paymentList.payments]);
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

  const sections : any = Object.entries(groupedPayments).map(([date, data]) => ({
    title: date,
    data: data,
  }));


  return (
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
                <Text white h3 bold>No Transactions</Text>
              </View>
            )}
            refreshControl={
              receiveType ? (
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={handleRefresh}
                  tintColor="white"
                />
              ) : undefined
            }
            keyExtractor={(item, index) => index.toString()}
            renderItem={({ item }) => <Items matchedRate={matchedRate} currency={currency} item={item} receiveType={receiveType} onPressHandler={onPressHandler} />}
            renderSectionHeader={({ section: { title } }) => <Header title={title} />}
          // invertStickyHeaders
          />
        </View>
      )}
      <View style={styles.bottomView}>
        <Image source={receiveType ? CoinOS : require("../../../../img/Strike.png")} />
      </View>
    </View>
  );
}
