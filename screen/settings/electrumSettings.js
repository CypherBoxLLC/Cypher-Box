import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {
  Alert,
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Text,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Pressable,
} from 'react-native';
import DefaultPreference from 'react-native-default-preference';
import AsyncStorage from '@react-native-async-storage/async-storage';
import loc from '../../loc';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import navigationStyle from '../../components/navigationStyle';
import {
  BlueButtonLink,
  BlueCard,
  BlueLoading,
  BlueSpacing20,
  BlueText,
  BlueDoneAndDismissKeyboardInputAccessory,
  BlueDismissKeyboardInputAccessory,
} from '../../BlueComponents';
import { BlueCurrentTheme } from '../../components/themes';
import WidgetCommunication from '../../blue_modules/WidgetCommunication';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import alert from '../../components/Alert';
import { requestCameraAuthorization } from '../../helpers/scan-qr';
import Button from '../../components/Button';
import ListItem from '../../components/ListItem';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { colors } from '@Cypher/style-guide';

const BlueElectrum = require('../../blue_modules/BlueElectrum');

export default class ElectrumSettings extends Component {
  static contextType = BlueStorageContext;
  constructor(props) {
    super(props);
    const server = props?.route?.params?.server;
    this.state = {
      isLoading: true,
      isOfflineMode: false,
      serverHistory: [],
      config: {},
      server,
      sslPort: '',
      port: '',
    };
  }

  componentWillUnmount() {
    clearInterval(this.state.inverval);
  }

  async componentDidMount() {
    const host = await AsyncStorage.getItem(BlueElectrum.ELECTRUM_HOST);
    const port = await AsyncStorage.getItem(BlueElectrum.ELECTRUM_TCP_PORT);
    const sslPort = await AsyncStorage.getItem(BlueElectrum.ELECTRUM_SSL_PORT);
    const serverHistoryStr = await AsyncStorage.getItem(BlueElectrum.ELECTRUM_SERVER_HISTORY);
    const isOfflineMode = await BlueElectrum.isDisabled();
    const serverHistory = JSON.parse(serverHistoryStr) || [];
    this.setState({
      isLoading: false,
      host,
      port,
      sslPort,
      serverHistory,
      isOfflineMode,
      isAndroidNumericKeyboardFocused: false,
      isAndroidAddressKeyboardVisible: false,
    });

    const inverval = setInterval(async () => {
      this.setState({
        config: await BlueElectrum.getConfig(),
      });
    }, 500);

    this.setState({
      config: await BlueElectrum.getConfig(),
      inverval,
    });

    if (this.state.server) {
      triggerHapticFeedback(HapticFeedbackTypes.ImpactHeavy);
      Alert.alert(
        loc.formatString(loc.settings.set_electrum_server_as_default, { server: this.state.server }),
        '',
        [
          {
            text: loc._.ok,
            onPress: () => {
              this.onBarScanned(this.state.server);
            },
            style: 'default',
          },
          { text: loc._.cancel, onPress: () => { }, style: 'cancel' },
        ],
        { cancelable: false },
      );
    }
  }

  checkServer = async () => {
    this.setState({ isLoading: true }, async () => {
      const features = await BlueElectrum.serverFeatures();
      triggerHapticFeedback(HapticFeedbackTypes.NotificationWarning);
      alert(JSON.stringify(features, null, 2));
      this.setState({ isLoading: false });
    });
  };

  selectServer = async server => {
    this.setState({ host: server.host, port: server.port, sslPort: server.sslPort }, () => {
      this.save();
    });
  };

  clearHistoryAlert() {
    triggerHapticFeedback(HapticFeedbackTypes.ImpactHeavy);
    Alert.alert(loc.settings.electrum_clear_alert_title, loc.settings.electrum_clear_alert_message, [
      { text: loc.settings.electrum_clear_alert_cancel, onPress: () => console.log('Cancel Pressed'), style: 'cancel' },
      { text: loc.settings.electrum_clear_alert_ok, onPress: () => this.clearHistory() },
    ]);
  }

  clearHistory = async () => {
    this.setState({ isLoading: true }, async () => {
      await AsyncStorage.setItem(BlueElectrum.ELECTRUM_SERVER_HISTORY, JSON.stringify([]));
      this.setState({
        serverHistory: [],
        isLoading: false,
      });
    });
  };

  resetToDefault = async () => {
    this.setState({ port: '', host: '', sslPort: '' }, () => {
      this.save();
    });
  };

  serverExists = server => {
    const { serverHistory } = this.state;
    return serverHistory.some(s => {
      return `${s.host}${s.port}${s.sslPort}` === `${server.host}${server.port}${server.sslPort}`;
    });
  };

  // Switches to the saved server now rather than after a restart: a Cold Vault set up right after connecting a node
  // must not have its addresses looked up on the old server. Opened from that setup (`returnAfterSave`), the screen
  // then goes back to it.
  useSavedServer = async () => {
    if (!(await BlueElectrum.isDisabled())) {
      try {
        BlueElectrum.forceDisconnect();
      } catch (_) {
        // not connected yet
      }
      BlueElectrum.connectMain();
    }
    if (this.props.route?.params?.returnAfterSave) this.props.navigation.goBack();
  };

  save = () => {
    const host = this.state.host ? this.state.host : '';
    const port = this.state.port ? this.state.port : '';
    const sslPort = this.state.sslPort ? this.state.sslPort : '';
    const serverHistory = this.state.serverHistory || [];

    this.setState({ isLoading: true }, async () => {
      try {
        if (!host && !port && !sslPort) {
          await AsyncStorage.setItem(BlueElectrum.ELECTRUM_HOST, '');
          await AsyncStorage.setItem(BlueElectrum.ELECTRUM_TCP_PORT, '');
          await AsyncStorage.setItem(BlueElectrum.ELECTRUM_SSL_PORT, '');
          try {
            await DefaultPreference.setName('group.io.cypherbox.btc');
            await DefaultPreference.clear(BlueElectrum.ELECTRUM_HOST);
            await DefaultPreference.clear(BlueElectrum.ELECTRUM_SSL_PORT);
            await DefaultPreference.clear(BlueElectrum.ELECTRUM_TCP_PORT);
            WidgetCommunication.reloadAllTimelines();
          } catch (e) {
            // Must be running on Android
            console.log(e);
          }
          triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
          alert(loc.settings.electrum_saved);
          await this.useSavedServer();
        } else if (!(await BlueElectrum.testConnection(host, port, sslPort))) {
          triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
          alert(loc.settings.electrum_error_connect);
        } else {
          await AsyncStorage.setItem(BlueElectrum.ELECTRUM_HOST, host);
          await AsyncStorage.setItem(BlueElectrum.ELECTRUM_TCP_PORT, port);
          await AsyncStorage.setItem(BlueElectrum.ELECTRUM_SSL_PORT, sslPort);

          if (!this.serverExists({ host, port, sslPort })) {
            serverHistory.push({
              host,
              port,
              sslPort,
            });
            await AsyncStorage.setItem(BlueElectrum.ELECTRUM_SERVER_HISTORY, JSON.stringify(serverHistory));
          }

          try {
            await DefaultPreference.setName('group.io.cypherbox.btc');
            await DefaultPreference.set(BlueElectrum.ELECTRUM_HOST, host);
            await DefaultPreference.set(BlueElectrum.ELECTRUM_TCP_PORT, port);
            await DefaultPreference.set(BlueElectrum.ELECTRUM_SSL_PORT, sslPort);
            WidgetCommunication.reloadAllTimelines();
          } catch (e) {
            // Must be running on Android
            console.log(e);
          }
          triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
          alert(loc.settings.electrum_saved);
          await this.useSavedServer();
        }
      } catch (error) {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        alert(error);
      }
      this.setState({ isLoading: false });
    });
  };

  onBarScanned = value => {
    if (DeeplinkSchemaMatch.getServerFromSetElectrumServerAction(value)) {
      // in case user scans a QR with a deeplink like `bluewallet:setelectrumserver?server=electrum1.bluewallet.io%3A443%3As`
      value = DeeplinkSchemaMatch.getServerFromSetElectrumServerAction(value);
    }
    const [host, port, type] = value.split(':');
    this.setState({ host, sslPort: '', port: '' }, () => {
      type === 's' ? this.setState({ sslPort: port }) : this.setState({ port });
    });
  };

  importScan = () => {
    requestCameraAuthorization().then(() =>
      this.props.navigation.navigate('ScanQRCodeRoot', {
        screen: 'ScanQRCode',
        params: {
          launchedBy: this.props.route.name,
          onBarScanned: this.onBarScanned,
          showFileImportButton: true,
        },
      }),
    );
  };

  useSSLPortToggled = value => {
    switch (value) {
      case true:
        this.setState(prevState => {
          return { port: '', sslPort: prevState.port };
        });
        break;
      case false:
        this.setState(prevState => {
          return { port: prevState.sslPort, sslPort: '' };
        });
        break;
    }
  };

  onElectrumConnectionEnabledSwitchValueChanged = async value => {
    if (value === true) {
      await BlueElectrum.setDisabled(true);
      this.context.setIsElectrumDisabled(true);
      BlueElectrum.forceDisconnect();
    } else {
      await BlueElectrum.setDisabled(false);
      this.context.setIsElectrumDisabled(false);
      BlueElectrum.connectMain();
    }
    this.setState({ isOfflineMode: value });
  };

  renderElectrumSettings = () => {
    const serverHistoryItems = this.state.serverHistory.map((server, i) => {
      return (
        <View key={i} style={styles.serverHistoryItem}>
          <Text style={styles.serverRow} numberOfLines={1} ellipsizeMode="middle">{`${server.host}:${server.port || server.sslPort}`}</Text>

          <TouchableOpacity accessibilityRole="button" style={styles.selectButton} onPress={() => this.selectServer(server)}>
            <BlueText>{loc.settings.electrum_select}</BlueText>
          </TouchableOpacity>
        </View>
      );
    });

    const connected = this.state.config.connected === 1;
    // yellow on one of the public servers the app picks by itself, green only on a node the user typed in
    const thirdParty = connected && BlueElectrum.isPublicServer(this.state.config.host);

    return (
      <>
        <BlueCard>
          <BlueText style={styles.status}>{loc.settings.electrum_status}</BlueText>
          <View style={styles.connectWrap}>
            <View
              style={[
                styles.container,
                !connected ? styles.containerDisconnected : thirdParty ? styles.containerThirdParty : styles.containerConnected,
              ]}
            >
              <BlueText style={!connected ? styles.textDisconnected : thirdParty ? styles.textThirdParty : styles.textConnected}>
                {!connected
                  ? loc.settings.electrum_connected_not
                  : thirdParty
                    ? loc.settings.electrum_connected_third_party
                    : loc.settings.electrum_connected}
              </BlueText>
            </View>
          </View>
          <BlueSpacing20 />
          <BlueText style={styles.hostname} onPress={this.checkServer}>
            {this.state.config.host}:{this.state.config.port}
          </BlueText>
          {thirdParty && (
            <View style={styles.thirdParty}>
              <BlueText style={styles.thirdPartyTitle}>{loc.settings.electrum_third_party_title}</BlueText>
              <BlueText style={styles.thirdPartyText}>{loc.settings.electrum_third_party_explain}</BlueText>
            </View>
          )}
        </BlueCard>
        <KeyboardAvoidingView>
          <BlueCard>
            <View style={styles.inputWrap}>
              <TextInput
                placeholder={loc.formatString(loc.settings.electrum_host, { example: '10.20.30.40' })}
                value={this.state.host}
                onChangeText={text => {
                  const host = text.trim();
                  this.setState({ host }, () => {
                    if (host.endsWith('.onion')) {
                      this.useSSLPortToggled(false);
                    }
                  });
                }}
                numberOfLines={1}
                style={styles.inputText}
                editable={!this.state.isLoading}
                placeholderTextColor="#81868e"
                autoCorrect={false}
                autoCapitalize="none"
                underlineColorAndroid="transparent"
                inputAccessoryViewID={BlueDoneAndDismissKeyboardInputAccessory.InputAccessoryViewID}
                testID="HostInput"
                onFocus={() => this.setState({ isAndroidAddressKeyboardVisible: true })}
                onBlur={() => this.setState({ isAndroidAddressKeyboardVisible: false })}
              />
            </View>
            <BlueSpacing20 />
            <View style={styles.portWrap}>
              <View style={styles.inputWrap}>
                <TextInput
                  placeholder={loc.formatString(loc.settings.electrum_port, { example: '50001' })}
                  value={this.state.sslPort?.trim() === '' || this.state.sslPort === null ? this.state.port : this.state.sslPort}
                  onChangeText={text =>
                    this.setState(prevState => {
                      if (prevState.sslPort?.trim() === '') {
                        return { port: text.trim(), sslPort: '' };
                      } else {
                        return { port: '', sslPort: text.trim() };
                      }
                    })
                  }
                  numberOfLines={1}
                  style={styles.inputText}
                  editable={!this.state.isLoading}
                  placeholderTextColor="#81868e"
                  underlineColorAndroid="transparent"
                  autoCorrect={false}
                  autoCapitalize="none"
                  keyboardType="number-pad"
                  inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
                  testID="PortInput"
                  onFocus={() => this.setState({ isAndroidNumericKeyboardFocused: true })}
                  onBlur={() => this.setState({ isAndroidNumericKeyboardFocused: false })}
                />
              </View>
              <BlueText style={styles.usePort}>{loc.settings.use_ssl}</BlueText>
              <Switch
                testID="SSLPortInput"
                value={this.state.sslPort?.trim() > 0}
                onValueChange={this.useSSLPortToggled}
                disabled={this.state.host?.endsWith('.onion') ?? false}
              />
            </View>
            <BlueSpacing20 />

            <View style={styles.serverAddTitle}>
              <BlueText style={styles.explain}>{loc.settings.electrum_settings_explain}</BlueText>
              <TouchableOpacity accessibilityRole="button" testID="ResetToDefault" onPress={() => this.resetToDefault()}>
                <BlueText>{loc.settings.electrum_reset}</BlueText>
              </TouchableOpacity>
            </View>
            <BlueSpacing20 />
            {this.state.isLoading ? <BlueLoading /> : <Button testID="Save" onPress={this.save} title={loc.settings.save} />}
            <BlueSpacing20 />
            <BlueButtonLink title={loc.wallets.import_scan_qr} onPress={this.importScan} />
            <BlueSpacing20 />
          </BlueCard>
          {Platform.select({
            ios: <BlueDismissKeyboardInputAccessory />,
            android: this.state.isAndroidNumericKeyboardFocused && <BlueDismissKeyboardInputAccessory />,
          })}

          {Platform.select({
            ios: (
              <BlueDoneAndDismissKeyboardInputAccessory
                onClearTapped={() => this.setState({ host: '' })}
                onPasteTapped={text => {
                  this.setState({ host: text });
                  Keyboard.dismiss();
                }}
              />
            ),
            android: this.state.isAndroidAddressKeyboardVisible && (
              <BlueDoneAndDismissKeyboardInputAccessory
                onClearTapped={() => {
                  this.setState({ host: '' });
                  Keyboard.dismiss();
                }}
                onPasteTapped={text => {
                  this.setState({ host: text });
                  Keyboard.dismiss();
                }}
              />
            ),
          })}
        </KeyboardAvoidingView>
        {serverHistoryItems.length > 0 && !this.state.isLoading && (
          <BlueCard>
            <View style={styles.serverHistoryTitle}>
              <BlueText style={styles.explain}>{loc.settings.electrum_history}</BlueText>
              <TouchableOpacity accessibilityRole="button" onPress={() => this.clearHistoryAlert()}>
                <BlueText>{loc.settings.electrum_clear}</BlueText>
              </TouchableOpacity>
            </View>
            {serverHistoryItems}
          </BlueCard>
        )}
      </>
    );
  };

  render() {
    return (
      <ScrollView keyboardShouldPersistTaps="always" automaticallyAdjustContentInsets contentInsetAdjustmentBehavior="automatic">
        <ListItem
          Component={Pressable}
          title={loc.settings.electrum_offline_mode}
          switch={{
            onValueChange: this.onElectrumConnectionEnabledSwitchValueChanged,
            value: this.state.isOfflineMode,
            testID: 'ElectrumConnectionEnabledSwitch',
          }}
        />
        <BlueCard>
          <BlueText>{loc.settings.electrum_offline_description}</BlueText>
        </BlueCard>
        {!this.state.isOfflineMode && this.renderElectrumSettings()}
      </ScrollView>
    );
  }
}

ElectrumSettings.propTypes = {
  navigation: PropTypes.shape({
    navigate: PropTypes.func,
    goBack: PropTypes.func,
  }),
  route: PropTypes.shape({
    name: PropTypes.string,
    params: PropTypes.shape({
      server: PropTypes.string,
      returnAfterSave: PropTypes.bool,
    }),
  }),
};

ElectrumSettings.navigationOptions = navigationStyle({}, opts => ({ ...opts, title: loc.settings.electrum_settings_server }));

const styles = StyleSheet.create({
  status: {
    textAlign: 'center',
    color: BlueCurrentTheme.colors.feeText,
    marginBottom: 4,
  },
  connectWrap: {
    width: 'auto',
    minHeight: 34,
    flexWrap: 'wrap',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  container: {
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 16,
    paddingRight: 16,
    borderRadius: 20,
  },
  containerConnected: {
    backgroundColor: colors.green,
  },
  containerThirdParty: {
    backgroundColor: colors.tundora,
  },
  containerDisconnected: {
    backgroundColor: BlueCurrentTheme.colors.redBG,
  },
  textConnected: {
    color: colors.black.default,
    fontWeight: 'bold',
  },
  textThirdParty: {
    color: colors.yellow2,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  thirdParty: {
    marginTop: 16,
  },
  thirdPartyTitle: {
    color: colors.yellow2,
    fontWeight: 'bold',
  },
  thirdPartyText: {
    color: colors.yellow2,
    marginTop: 4,
  },
  textDisconnected: {
    color: BlueCurrentTheme.colors.redText,
    fontWeight: 'bold',
  },
  hostname: {
    textAlign: 'center',
    color: BlueCurrentTheme.colors.foregroundColor,
  },
  usePort: {
    textAlign: 'center',
    color: BlueCurrentTheme.colors.foregroundColor,
    marginHorizontal: 8,
  },
  explain: {
    color: BlueCurrentTheme.colors.feeText,
    marginBottom: -24,
    flexShrink: 1,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    borderColor: BlueCurrentTheme.colors.formBorder,
    borderBottomColor: BlueCurrentTheme.colors.formBorder,
    borderWidth: 1,
    borderBottomWidth: 0.5,
    backgroundColor: BlueCurrentTheme.colors.inputBackgroundColor,
    minHeight: 44,
    height: 44,
    alignItems: 'center',
    borderRadius: 4,
  },
  portWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputText: {
    flex: 1,
    marginHorizontal: 8,
    minHeight: 36,
    color: '#81868e',
    height: 36,
  },
  serverAddTitle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 16,
  },
  serverHistoryTitle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  serverHistoryItem: {
    flexDirection: 'row',
    paddingVertical: 20,
    borderBottomColor: BlueCurrentTheme.colors.formBorder,
    borderBottomWidth: 0.5,
    flexWrap: 'nowrap',
  },
  serverRow: {
    flexGrow: 2,
    maxWidth: '80%',
    color: BlueCurrentTheme.colors.foregroundColor,
  },
  selectButton: {
    flexGrow: 1,
    marginLeft: 16,
    alignItems: 'flex-end',
  },
});
