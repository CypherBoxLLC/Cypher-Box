import React, { useCallback, useState, useContext, useRef, useEffect, useLayoutEffect } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import Privacy from '../../blue_modules/Privacy';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import loc from '../../loc';
import navigationStyle from '../../components/navigationStyle';
import { AddressItem } from '../../components/addresses/AddressItem';
import { AddressTypeTabs, TABS } from '../../components/addresses/AddressTypeTabs';
import { WatchOnlyWallet } from '../../class';
import { useTheme } from '../../components/themes';
import { dispatchNavigate } from '@Cypher/helpers';
import useAuthStore from '@Cypher/stores/authStore';

export const totalBalance = ({ c, u } = { c: 0, u: 0 }) => c + u;

export const getAddress = (wallet, index, isInternal) => {
  let address;
  let balance = 0;
  let transactions = 0;

  if (isInternal) {
    address = wallet._getInternalAddressByIndex(index);
    balance = totalBalance(wallet._balances_by_internal_index[index]);
    transactions = wallet._txs_by_internal_index[index]?.length;
  } else {
    address = wallet._getExternalAddressByIndex(index);
    balance = totalBalance(wallet._balances_by_external_index[index]);
    transactions = wallet._txs_by_external_index[index]?.length;
  }

  return {
    key: address,
    index,
    address,
    isInternal,
    balance,
    transactions,
  };
};

export const sortByAddressIndex = (a, b) => {
  if (a.index > b.index) {
    return 1;
  }
  return -1;
};

export const filterByAddressType = (type, isInternal, currentType) => {
  if (currentType === type) {
    return isInternal === true;
  }
  return isInternal === false;
};

const WalletAddresses = () => {
  const [showAddresses, setShowAddresses] = useState(false);

  const [addresses, setAddresses] = useState([]);

  const [currentTab, setCurrentTab] = useState(TABS.EXTERNAL);

  const { wallets } = useContext(BlueStorageContext);
  const { setVaultDisplayAddress } = useAuthStore();

  const {
    walletID,
    isTouchable,
    selectForReceive,
    selectForBuyDeposit,
    selectForVaultDisplay,
    value,
    converted,
    isSats,
    to,
    type,
    recommendedFee,
    isWithdrawal,


    vaultTab,
    utxo,
    ids,
    maxUSD,
    inUSD,
    total,
    matchedRate,
    capsulesData,
    vaultSend,
    title,
    currency,
    isBatch,
    capsuleTotal,
} = useRoute().params;

  const addressList = useRef();

  // `wallet` can legitimately come back undefined, and every line below used to
  // dereference it unconditionally. This screen is reached by walletID from six
  // different flows, and that pointer can outlive the wallet it names: after a
  // reset, a re-import, or any of the pointer drift the recovery flow already
  // heals for. When it did, `wallet.getPreferredBalanceUnit()` threw during
  // render, and a render-time throw has no error boundary above it, so release
  // builds terminated the process outright. Reported from the field as tapping
  // the address closing the app and forcing a fresh login.
  const wallet = wallets.find(w => w.getID() === walletID);

  const balanceUnit = wallet ? wallet.getPreferredBalanceUnit() : undefined;

  const isWatchOnly = !!wallet && wallet.type === WatchOnlyWallet.type;

  const walletInstance = isWatchOnly ? wallet._hdWalletInstance : wallet;

  const allowSignVerifyMessage =
    !!wallet && 'allowSignVerifyMessage' in wallet && wallet.allowSignVerifyMessage();

  const { colors } = useTheme();

  const { setOptions, navigate } = useNavigation();

  const [search, setSearch] = React.useState('');

  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.elevated,
    },
  });

  // computed property
  const filteredAddresses = addresses
    .filter(address => filterByAddressType(TABS.INTERNAL, address.isInternal, currentTab))
    .sort(sortByAddressIndex);

  useEffect(() => {
    if (showAddresses) {
      addressList.current.scrollToIndex({ animated: false, index: 0 });
    }
  }, [showAddresses]);

  useLayoutEffect(() => {
    setOptions({
      headerSearchBarOptions: {
        onChangeText: event => setSearch(event.nativeEvent.text),
      },
    });
  }, [setOptions]);

  const getAddresses = () => {
    // Second crash site for the same missing wallet: this runs from
    // useFocusEffect, so the throw landed in an effect rather than in render,
    // but it was just as fatal. Bail quietly and let the empty state below
    // explain itself.
    if (!walletInstance) return;

    const newAddresses = [];

    for (let index = 0; index <= walletInstance.next_free_change_address_index; index++) {
      const address = getAddress(walletInstance, index, true);

      newAddresses.push(address);
    }

    for (let index = 0; index < walletInstance.next_free_address_index + walletInstance.gap_limit; index++) {
      const address = getAddress(walletInstance, index, false);

      newAddresses.push(address);
    }

    setAddresses(newAddresses);
    setShowAddresses(true);
  };

  useFocusEffect(
    useCallback(() => {
      Privacy.enableBlur();

      getAddresses();

      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const navigateToReceive = (item) => {
    // When opened from receive popup, return selected address to HomeScreen
    if(selectForReceive){
      dispatchNavigate('HomeScreen', {
        selectedVaultAddress: item.address,
        selectedVaultType: vaultTab ? 'cold' : 'hot',
      });
      return;
    }
    // Vault-display picker: pin this address as the one the vault's Vault tab
    // shows, then go back to that tab so the choice is visible immediately.
    // Same CommonActions merge as the buy-deposit case below, which keeps the
    // HotStorageVault instance (and its `wallet` param) rather than pushing a
    // second one.
    if (selectForVaultDisplay) {
      setVaultDisplayAddress(walletID, item.address);
      dispatchNavigate('HotStorageVault', { tapTab: 0 });
      return;
    }
    // BUY-flow deposit picker: navigate back to the ReviewPayment
    // screen we came from. CommonActions.navigate merges params into
    // the existing instance, so ReviewPayment's `purchaseDest` and
    // related state are preserved — the receiving useEffect picks up
    // the new `selectedDepositAddress` and refreshes the inline UI.
    if(selectForBuyDeposit){
      dispatchNavigate('ReviewPayment', {
        selectedDepositAddress: item.address,
        selectedDepositVaultType: vaultTab ? 'cold' : 'hot',
      });
      return;
    }
    if(isBatch){
      dispatchNavigate('ColdStorage', {
        wallet,
        vaultTab,
        utxo,
        ids,
        maxUSD,
        inUSD,
        total,
        matchedRate,
        capsulesData,
        to: item.address,
        vaultSend,
        title,
        type,
        isBatch,
        currency,
        capsuleTotal
      });
    } else {
      dispatchNavigate('ReviewPayment', {
        value: value,
        converted: converted,
        isSats: isSats,
        to: item.address,
        fees: 0,
        type: type,
        feeForBamskki: 0,
        recommendedFee,
        wallet,
        isWithdrawal: isWithdrawal
      });
    }
    // navigate('ReceiveDetailsRoot', {
    //   screen: 'ReceiveDetails',
    //   params: {
    //     walletID,
    //     address: item.address,
    //   },
    // });
  };

  const data =
    search.length > 0 ? filteredAddresses.filter(item => item.address.toLowerCase().includes(search.toLowerCase())) : filteredAddresses;

  const renderRow = item => {
    return <AddressItem {...item} balanceUnit={balanceUnit} walletID={walletID} allowSignVerifyMessage={allowSignVerifyMessage} isTouchable={isTouchable} navigateToReceive={navigateToReceive} />;
  };

  // Placed after every hook above, so hook order stays identical on the render
  // where the wallet is found and the one where it is not.
  //
  // Without this the list would sit on a permanent spinner, since its empty
  // state renders an ActivityIndicator and no addresses will ever arrive. Say
  // what happened instead: the screen is unusable either way, but a dead end
  // the user can back out of beats one that looks like it is still loading.
  if (!wallet) {
    return (
      <View style={[styles.root, stylesHook.root, styles.missingWallet]}>
        <Text style={{ color: colors.foregroundColor, textAlign: 'center' }}>
          This vault is no longer available on this device. Go back and open it
          again from the home screen.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, stylesHook.root]}>
      <FlatList
        contentContainerStyle={stylesHook.root}
        ref={addressList}
        data={data}
        extraData={data}
        initialNumToRender={20}
        renderItem={renderRow}
        ListEmptyComponent={search.length > 0 ? null : <ActivityIndicator />}
        centerContent={!showAddresses}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={<AddressTypeTabs currentTab={currentTab} setCurrentTab={setCurrentTab} />}
      />
    </View>
  );
};

WalletAddresses.navigationOptions = navigationStyle({
  title: loc.addresses.addresses_title,
  statusBarStyle: 'auto',
});

export default WalletAddresses;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  missingWallet: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
});
