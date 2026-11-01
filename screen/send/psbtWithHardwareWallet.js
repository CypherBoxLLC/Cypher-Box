import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, TouchableOpacity, ScrollView, View, TextInput, Text, StyleSheet } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useNavigation, useRoute, useIsFocused } from '@react-navigation/native';
import Biometric from '../../class/biometrics';

import { SecondButton, BlueText, BlueCard, BlueSpacing20, BlueCopyToClipboardButton } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import Notifications from '../../blue_modules/notifications';
import { DynamicQRCode } from '../../components/DynamicQRCode';
import alert from '../../components/Alert';
import { requestCameraAuthorization } from '../../helpers/scan-qr';
import { useTheme } from '../../components/themes';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import SafeArea from '../../components/SafeArea';
import { assertSignedTxMatchesPsbt, isRawTransactionHex, summarizeSignedTx, SIGNED_TX_INVALID } from '../../src/helpers/signedTransaction';
import { spendsPendingInputs } from '../../src/helpers/pendingSignature';
import useAuthStore from '../../src/stores/authStore';
const BlueElectrum = require('../../blue_modules/BlueElectrum');
const bitcoin = require('bitcoinjs-lib');
const fs = require('../../blue_modules/fs');

const PsbtWithHardwareWallet = () => {
  const { txMetadata, fetchAndSaveWalletTransactions, isElectrumDisabled } = useContext(BlueStorageContext);
  const navigation = useNavigation();
  const route = useRoute();
  const { fromWallet, memo, psbt, deepLinkPSBT, launchedBy } = route.params;
  const routeParamsPSBT = useRef(route.params.psbt);
  const routeParamsTXHex = route.params.txhex;
  const { colors } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [txHex, setTxHex] = useState(route.params.txhex);
  const openScannerButton = useRef();
  const dynamicQRCode = useRef();
  const isFocused = useIsFocused();

  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.elevated,
    },
    rootPadding: {
      backgroundColor: colors.elevated,
    },
    hexWrap: {
      backgroundColor: colors.elevated,
    },
    hexLabel: {
      color: colors.foregroundColor,
    },
    hexInput: {
      borderColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
      color: colors.foregroundColor,
    },
    hexText: {
      color: colors.foregroundColor,
    },
    helpBtn: {
      borderColor: colors.foregroundColor,
    },
  });

  const _combinePSBT = receivedPSBT => {
    return fromWallet.combinePsbt(psbt, receivedPSBT);
  };

  const onBarScanned = ret => {
    if (ret && !ret.data) ret = { data: ret };
    if (ret.data.toUpperCase().startsWith('UR')) {
      alert('BC-UR not decoded. This should never happen');
    }
    if (isRawTransactionHex(ret.data)) {
      // a finished transaction instead of a signed PSBT: only accept it if it is the one the user reviewed
      try {
        assertSignedTxMatchesPsbt(ret.data, psbt);
        setTxHex(ret.data.trim());
      } catch (Err) {
        alert(Err.message);
      }
      return;
    }
    try {
      const Tx = _combinePSBT(ret.data);
      setTxHex(Tx.toHex());
      if (launchedBy) {
        // we must navigate back to the screen who requested psbt (instead of broadcasting it ourselves)
        // most likely for LN channel opening
        navigation.navigate({ name: launchedBy, params: { psbt }, merge: true });
        // ^^^ we just use `psbt` variable sinse it was finalized in the above _combinePSBT()
        // (passed by reference)
      }
    } catch (Err) {
      alert(Err.message);
    }
  };

  useEffect(() => {
    if (isFocused) {
      dynamicQRCode.current?.startAutoMove();
    } else {
      dynamicQRCode.current?.stopAutoMove();
    }
  }, [isFocused]);

  useEffect(() => {
    if (!psbt && !route.params.txhex) {
      alert(loc.send.no_tx_signing_in_progress);
    }

    if (deepLinkPSBT) {
      const newPsbt = bitcoin.Psbt.fromBase64(deepLinkPSBT);
      try {
        const Tx = fromWallet.combinePsbt(routeParamsPSBT.current, newPsbt);
        setTxHex(Tx.toHex());
      } catch (Err) {
        alert(Err);
      }
    } else if (routeParamsTXHex) {
      setTxHex(routeParamsTXHex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkPSBT, routeParamsTXHex]);

  const broadcast = async () => {
    setIsLoading(true);
    const isBiometricsEnabled = await Biometric.isBiometricUseCapableAndEnabled();

    if (isBiometricsEnabled) {
      if (!(await Biometric.unlockWithBiometrics())) {
        setIsLoading(false);
        return;
      }
    }
    try {
      await BlueElectrum.ping();
      await BlueElectrum.waitTillConnected();
      const result = await fromWallet.broadcastTx(txHex);
      if (result) {
        setIsLoading(false);
        const txDecoded = bitcoin.Transaction.fromHex(txHex);
        const txid = txDecoded.getId();
        Notifications.majorTomToGroundControl([], [], [txid]);
        if (memo) {
          txMetadata[txid] = { memo };
        }
        // a cold vault spend waiting for signature can't be resumed once its capsules are spent
        const pending = useAuthStore.getState().pendingSignatures?.[fromWallet.getID()];
        if (pending && spendsPendingInputs(txHex, pending)) useAuthStore.getState().setPendingSignature(fromWallet.getID(), null);
        navigation.navigate('WalletsRoot', { screen: "TransactionBroadCastNew", params: { sats: undefined, inUSD: undefined } });
        await new Promise(resolve => setTimeout(resolve, 3000)); // sleep to make sure network propagates
        fetchAndSaveWalletTransactions(fromWallet.getID());
      } else {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        setIsLoading(false);
        alert(loc.errors.broadcast);
      }
    } catch (error) {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
      setIsLoading(false);
      alert(error.message);
    }
  };

  const copyHexToClipboard = () => {
    Clipboard.setString(txHex);
  };

  const isOwnAddress = address => {
    try {
      return !!fromWallet?.weOwnAddress?.(address);
    } catch (_) {
      return false;
    }
  };

  const _renderTxSummary = () => {
    let summary;
    try {
      // the fee needs the reviewed PSBT's input amounts; a transaction opened on its own shows outputs only
      summary = summarizeSignedTx(txHex, psbt && !routeParamsTXHex ? psbt : undefined);
    } catch (_) {
      return <BlueText style={[styles.hexLabel, stylesHook.hexLabel]}>{SIGNED_TX_INVALID}</BlueText>;
    }
    return (
      <View style={styles.summary}>
        {summary.outputs.map((output, i) => (
          <BlueText key={i} style={[styles.summaryRow, stylesHook.hexLabel]}>
            {loc.send.create_amount}: {output.value} sats{'\n'}
            {loc.send.create_to}: {output.address ?? 'Unknown output script'}
            {output.address && isOwnAddress(output.address) ? ' (your wallet)' : ''}
          </BlueText>
        ))}
        {summary.fee !== null ? (
          <BlueText style={[styles.summaryRow, stylesHook.hexLabel]}>
            {loc.send.create_fee}: {summary.fee} sats
          </BlueText>
        ) : null}
      </View>
    );
  };

  const openVerifyGuide = () => {
    // an imported finished transaction has no reviewed PSBT, so the app had nothing to compare it against
    navigation.navigate('VerifyTransactionGuide', { imported: !psbt || !!routeParamsTXHex });
  };

  const _renderBroadcastHex = () => {
    return (
      <View style={[styles.rootPadding, stylesHook.rootPadding]}>
        <BlueCard style={[styles.hexWrap, stylesHook.hexWrap]}>
          {_renderTxSummary()}
          <BlueText style={[styles.hexLabel, stylesHook.hexLabel]}>{loc.send.create_this_is_hex}</BlueText>
          <TextInput style={[styles.hexInput, stylesHook.hexInput]} height={112} multiline editable value={txHex} />

          <TouchableOpacity accessibilityRole="button" style={styles.hexTouch} onPress={copyHexToClipboard}>
            <Text style={[styles.hexText, stylesHook.hexText]}>{loc.send.create_copy}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="How to check this transaction yourself"
            style={styles.verifyRow}
            onPress={openVerifyGuide}
          >
            <Text style={[styles.verifyText, stylesHook.hexLabel]}>
              Spending large capsules from cold storage? Check this signed transaction in an independent, offline tool before you send it.
            </Text>
            <View style={[styles.helpBtn, stylesHook.helpBtn]}>
              <Text style={[styles.helpText, stylesHook.hexText]}>?</Text>
            </View>
          </TouchableOpacity>
          <BlueSpacing20 />
          <SecondButton
            disabled={isElectrumDisabled}
            onPress={broadcast}
            title={loc.send.confirm_sendNow}
            testID="PsbtWithHardwareWalletBroadcastTransactionButton"
          />
        </BlueCard>
      </View>
    );
  };

  const exportPSBT = () => {
    const fileName = `${Date.now()}.psbt`;
    dynamicQRCode.current?.stopAutoMove();
    fs.writeFileAndExport(fileName, typeof psbt === 'string' ? psbt : psbt.toBase64()).finally(() => {
      dynamicQRCode.current?.startAutoMove();
    });
  };

  const openSignedTransaction = async () => {
    // the shared reader handles binary .psbt files and file names with spaces, and alerts on failure itself
    const file = await fs.openSignedTransaction();
    if (file) {
      onBarScanned({ data: file });
    }
  };

  const openScanner = () => {
    requestCameraAuthorization().then(() => {
      navigation.navigate('ScanQRCodeRoot', {
        screen: 'ScanQRCode',
        params: {
          launchedBy: route.name,
          showFileImportButton: false,
          onBarScanned,
        },
      });
    });
  };

  if (txHex) return _renderBroadcastHex();

  return isLoading ? (
    <View style={[styles.rootPadding, stylesHook.rootPadding]}>
      <ActivityIndicator />
    </View>
  ) : (
    <SafeArea style={stylesHook.root}>
      <ScrollView centerContent contentContainerStyle={styles.scrollViewContent} testID="PsbtWithHardwareScrollView">
        <View style={styles.container}>
          <BlueCard>
            <BlueText testID="TextHelperForPSBT">{loc.send.psbt_this_is_psbt}</BlueText>
            <BlueSpacing20 />
            <Text testID="PSBTHex" style={styles.hidden}>
              {psbt.toHex()}
            </Text>
            <DynamicQRCode value={psbt.toHex()} ref={dynamicQRCode} />
            <BlueSpacing20 />
            <SecondButton
              testID="PsbtTxScanButton"
              icon={{
                name: 'qrcode',
                type: 'font-awesome',
                color: colors.buttonTextColor,
              }}
              onPress={openScanner}
              ref={openScannerButton}
              title={loc.send.psbt_tx_scan}
            />
            <BlueSpacing20 />
            <SecondButton
              icon={{
                name: 'login',
                type: 'entypo',
                color: colors.buttonTextColor,
              }}
              onPress={openSignedTransaction}
              title={loc.send.psbt_tx_open}
            />
            <BlueSpacing20 />
            <SecondButton
              icon={{
                name: 'share-alternative',
                type: 'entypo',
                color: colors.buttonTextColor,
              }}
              onPress={exportPSBT}
              title={loc.send.psbt_tx_export}
            />
            <BlueSpacing20 />
            <View style={styles.copyToClipboard}>
              <BlueCopyToClipboardButton
                stringToCopy={typeof psbt === 'string' ? psbt : psbt.toBase64()}
                displayText={loc.send.psbt_clipboard}
              />
            </View>
          </BlueCard>
        </View>
      </ScrollView>
    </SafeArea>
  );
};

export default PsbtWithHardwareWallet;

PsbtWithHardwareWallet.navigationOptions = navigationStyle({}, opts => ({ ...opts, title: loc.send.header }));

const styles = StyleSheet.create({
  scrollViewContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingTop: 16,
    paddingBottom: 16,
  },
  rootPadding: {
    flex: 1,
    paddingTop: 20,
  },
  hexWrap: {
    alignItems: 'center',
    flex: 1,
  },
  hexLabel: {
    fontWeight: '500',
  },
  hexInput: {
    borderRadius: 4,
    marginTop: 20,
    fontWeight: '500',
    fontSize: 14,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 16,
  },
  hexTouch: {
    marginVertical: 24,
  },
  verifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  verifyText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  helpBtn: {
    marginLeft: 12,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpText: {
    fontSize: 15,
    fontWeight: '600',
  },
  summary: {
    alignSelf: 'stretch',
    marginBottom: 20,
  },
  summaryRow: {
    marginBottom: 12,
  },
  hexText: {
    fontSize: 15,
    fontWeight: '500',
    alignSelf: 'center',
  },
  copyToClipboard: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  hidden: {
    width: 0,
    height: 0,
  },
});
