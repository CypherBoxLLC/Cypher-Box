import React, { useRef } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ListItem } from 'react-native-elements';
import PropTypes from 'prop-types';
import { AddressTypeBadge } from './AddressTypeBadge';
import loc, { formatBalance } from '../../loc';
import TooltipMenu from '../TooltipMenu';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import { useTheme } from '../themes';

const AddressItem = ({ item, balanceUnit, walletID, allowSignVerifyMessage, isTouchable, navigateToReceive }) => {
  const { colors } = useTheme();

  const hasTransactions = item.transactions > 0;

  const stylesHook = StyleSheet.create({
    container: {
      borderBottomColor: colors.lightBorder,
      backgroundColor: colors.elevated,
    },
    list: {
      color: colors.buttonTextColor,
    },
    index: {
      color: colors.alternativeTextColor,
    },
    balance: {
      color: colors.alternativeTextColor,
    },
    address: {
      color: hasTransactions ? colors.darkGray : colors.buttonTextColor,
    },
  });

  const { navigate } = useNavigation();

  const menuRef = useRef();
  // const navigateToReceive = () => {
  //   menuRef.current?.dismissMenu();
  //   navigate('ReceiveDetailsRoot', {
  //     screen: 'ReceiveDetails',
  //     params: {
  //       walletID,
  //       address: item.address,
  //     },
  //   });
  // };

  const navigateToSignVerify = () => {
    menuRef.current?.dismissMenu();
    navigate('SignVerifyRoot', {
      screen: 'SignVerify',
      params: {
        walletID,
        address: item.address,
      },
    });
  };

  // Exactly what the inline onPress did before. Selecting a row hands its
  // PUBLIC receive address back to the caller and nothing else: no key
  // material, no signing, no storage write. The sign/verify path is a menu
  // action (onPressMenuItem -> navigateToSignVerify), gated on
  // allowSignVerifyMessage, and is deliberately untouched by this.
  const handleRowPress = () => {
    menuRef.current?.dismissMenu();
    navigateToReceive(item);
  };

  const balance = formatBalance(item.balance, balanceUnit, true);

  const handleCopyPress = () => {
    Clipboard.setString(item.address);
  };

  const handleSharePress = () => {
    Share.open({ message: item.address }).catch(error => console.log(error));
  };

  const onToolTipPress = id => {
    if (id === AddressItem.actionKeys.CopyToClipboard) {
      handleCopyPress();
    } else if (id === AddressItem.actionKeys.Share) {
      handleSharePress();
    } else if (id === AddressItem.actionKeys.SignVerify) {
      navigateToSignVerify();
    }
  };

  const getAvailableActions = () => {
    const actions = [
      {
        id: AddressItem.actionKeys.CopyToClipboard,
        text: loc.transactions.details_copy,
        icon: AddressItem.actionIcons.Clipboard,
      },
      {
        id: AddressItem.actionKeys.Share,
        text: loc.receive.details_share,
        icon: AddressItem.actionIcons.Share,
      },
    ];

    if (allowSignVerifyMessage) {
      actions.push({
        id: AddressItem.actionKeys.SignVerify,
        text: loc.addresses.sign_title,
        icon: AddressItem.actionIcons.Signature,
      });
    }

    return actions;
  };

  // TooltipMenu is platform-split and the two builds disagree about onPress.
  //
  // components/TooltipMenu.android.js wraps children in a TouchableOpacity and
  // forwards props.onPress, so Android taps work and a second touchable there
  // would double-fire.
  //
  // components/TooltipMenu.js, the iOS build, is `props => props.children`. It
  // discards every prop including onPress, so on iOS a row relying on it to
  // deliver a tap is completely inert. That is why picking an address from
  // Receive > vault > View all vault addresses did nothing on iOS: the whole
  // chain after the tap is correct (navigateToReceive hands the address to
  // HomeScreen, which consumes selectedVaultAddress), but the tap was thrown
  // away before it could start.
  //
  // Fixed here rather than in the shared stub on purpose. Five other files
  // import TooltipMenu, and all of them are legacy screens nothing in src/
  // navigates to, so changing the stub would alter five call sites to fix zero
  // reachable bugs.
  const tooltipDeliversTap = Platform.OS === 'android';

  const render = () => {
    const row = (
        <ListItem key={item.key} containerStyle={stylesHook.container}>
          <ListItem.Content style={stylesHook.list}>
            <ListItem.Title style={stylesHook.list} numberOfLines={1} ellipsizeMode="middle">
              <Text style={[styles.index, stylesHook.index]}>{item.index + 1}</Text>{' '}
              <Text style={[stylesHook.address, styles.address]}>{item.address}</Text>
            </ListItem.Title>
            <View style={styles.subtitle}>
              <Text style={[stylesHook.list, styles.balance, stylesHook.balance]}>{balance}</Text>
            </View>
          </ListItem.Content>
          <View style={styles.labels}>
            <AddressTypeBadge isInternal={item.isInternal} hasTransactions={hasTransactions} />
            <Text style={[stylesHook.list, styles.balance, stylesHook.balance]}>
              {loc.addresses.transactions}: {item.transactions}
            </Text>
          </View>
        </ListItem>
    );

    return (
      <TooltipMenu
        title={item.address}
        ref={menuRef}
        actions={getAvailableActions()}
        onPressMenuItem={onToolTipPress}
        previewQRCode
        previewValue={item.address}
        {...(isTouchable && tooltipDeliversTap && { onPress: handleRowPress })}
      >
        {isTouchable && !tooltipDeliversTap ? (
          <TouchableOpacity onPress={handleRowPress} accessibilityRole="button">
            {row}
          </TouchableOpacity>
        ) : (
          row
        )}
      </TooltipMenu>
    );
  };

  return render();
};

AddressItem.actionKeys = {
  Share: 'share',
  CopyToClipboard: 'copyToClipboard',
  SignVerify: 'signVerify',
};

AddressItem.actionIcons = {
  Signature: {
    iconType: 'SYSTEM',
    iconValue: 'signature',
  },
  Share: {
    iconType: 'SYSTEM',
    iconValue: 'square.and.arrow.up',
  },
  Clipboard: {
    iconType: 'SYSTEM',
    iconValue: 'doc.on.doc',
  },
};

const styles = StyleSheet.create({
  address: {
    fontWeight: 'bold',
    marginHorizontal: 40,
  },
  index: {
    fontSize: 15,
  },
  balance: {
    marginTop: 8,
    marginLeft: 14,
  },
  subtitle: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
});

AddressItem.propTypes = {
  item: PropTypes.shape({
    key: PropTypes.string,
    index: PropTypes.number,
    address: PropTypes.string,
    isInternal: PropTypes.bool,
    transactions: PropTypes.number,
    balance: PropTypes.number,
  }),
  balanceUnit: PropTypes.string,
};
export { AddressItem };
