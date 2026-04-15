/* eslint react/prop-types: "off", react-native/no-inline-styles: "off" */
/**
 * Multi-format PSBT QR Code exporter with format picker
 *
 * Supports:
 * - UR (Uniform Resources) — Coldcard, Keystone, etc.
 * - BBQr (Better Bitcoin QR) — Coldcard Q, Jade, Passport, SeedSigner
 * - Plain QR — legacy wallets (small PSBTs only)
 *
 * Input value is a hex-encoded PSBT string (from psbt.toHex()).
 */
import React, { Component } from 'react';
import { Text } from 'react-native-elements';
import { Dimensions, LayoutAnimation, StyleSheet, TouchableOpacity, View } from 'react-native';
import { splitQRs as splitBBQrQRs } from 'bbqr';
import { encodeUR } from '../blue_modules/ur';
import QRCodeComponent from './QRCodeComponent';
import { BlueCurrentTheme } from '../components/themes';
import { BlueSpacing20 } from '../BlueComponents';
import loc from '../loc';

const { height, width } = Dimensions.get('window');

export class DynamicPSBTQRCode extends Component {
  constructor() {
    super();
    const qrCodeHeight = height > width ? width - 90 : width / 3;
    const qrCodeMaxHeight = 370;
    this.state = {
      index: 0,
      total: 0,
      qrCodeHeight: Math.min(qrCodeHeight, qrCodeMaxHeight),
      intervalHandler: null,
      displayQRCode: true,
      format: 'ur', // 'bbqr', 'ur', or 'plain'
      availableFormats: [],
    };
  }

  fragments = [];
  urFragments = [];
  bbqrFragments = [];
  plainFragments = [];

  componentDidMount() {
    const { value, capacity = 200 } = this.props;
    const available = [];

    // Prepare UR fragments
    try {
      const ur = encodeUR(value, capacity);
      if (ur && ur.length > 0) {
        this.urFragments = ur;
        available.push('ur');
        console.log('[PSBT QR] UR ready,', ur.length, 'parts');
      }
    } catch (e) {
      console.log('[PSBT QR] UR failed:', e.message);
    }

    // Prepare BBQr fragments — value is hex, convert to raw bytes
    try {
      const raw = Uint8Array.from(Buffer.from(value, 'hex'));
      const bbqr = splitBBQrQRs(raw, 'P', {
        encoding: 'Z',
        minVersion: 5,
        maxVersion: 40,
      });
      if (bbqr.parts && bbqr.parts.length > 0) {
        this.bbqrFragments = bbqr.parts;
        available.push('bbqr');
        console.log('[PSBT QR] BBQr ready,', bbqr.parts.length, 'parts, encoding:', bbqr.encoding);
      }
    } catch (e) {
      console.log('[PSBT QR] BBQr failed:', e.message);
    }

    // Plain fallback is always available
    this.plainFragments = [value];
    available.push('plain');

    // Default to UR if available, otherwise BBQr, otherwise plain
    const defaultFormat = available.includes('ur') ? 'ur' : available.includes('bbqr') ? 'bbqr' : 'plain';

    this.setState({ availableFormats: available });
    this._switchFormat(defaultFormat);
  }

  _switchFormat = (format) => {
    this.stopAutoMove();

    if (format === 'ur') {
      this.fragments = this.urFragments;
    } else if (format === 'bbqr') {
      this.fragments = this.bbqrFragments;
    } else {
      this.fragments = this.plainFragments;
    }

    this.setState(
      {
        format,
        index: 0,
        total: this.fragments.length,
        displayQRCode: true,
      },
      () => {
        this.startAutoMove();
      },
    );
  };

  moveToNextFragment = () => {
    const { index, total } = this.state;
    if (index === total - 1) {
      this.setState({ index: 0 });
    } else {
      this.setState(state => ({ index: state.index + 1 }));
    }
  };

  startAutoMove = () => {
    if (this.fragments.length <= 1) return;
    if (!this.state.intervalHandler) {
      this.setState(() => ({
        intervalHandler: setInterval(this.moveToNextFragment, 500),
      }));
    }
  };

  stopAutoMove = () => {
    clearInterval(this.state.intervalHandler);
    this.setState(() => ({ intervalHandler: null }));
  };

  moveToPreviousFragment = () => {
    const { index, total } = this.state;
    if (index > 0) {
      this.setState(state => ({ index: state.index - 1 }));
    } else {
      this.setState(state => ({ index: total - 1 }));
    }
  };

  onError = () => {
    console.log('[PSBT QR] Data too large for QR Code');
    this.setState({ displayQRCode: false });
  };

  getCurrentValue() {
    const currentFragment = this.fragments[this.state.index];
    if (!currentFragment) return '';

    const { format } = this.state;

    if (format === 'ur') {
      return currentFragment.toUpperCase();
    }
    // BBQr and plain return as-is
    return currentFragment;
  }

  renderFormatPicker() {
    const { format, availableFormats } = this.state;
    // Only show picker if both UR and BBQr are available
    if (!availableFormats.includes('ur') || !availableFormats.includes('bbqr')) return null;

    return (
      <View style={pickerStyles.container}>
        <TouchableOpacity
          style={[pickerStyles.tab, format === 'ur' && pickerStyles.activeTab]}
          onPress={() => this._switchFormat('ur')}
        >
          <Text style={[pickerStyles.tabText, format === 'ur' && pickerStyles.activeTabText]}>UR</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[pickerStyles.tab, format === 'bbqr' && pickerStyles.activeTab]}
          onPress={() => this._switchFormat('bbqr')}
        >
          <Text style={[pickerStyles.tabText, format === 'bbqr' && pickerStyles.activeTabText]}>BBQr</Text>
        </TouchableOpacity>
      </View>
    );
  }

  render() {
    const currentFragment = this.fragments[this.state.index];

    if (!currentFragment && this.state.displayQRCode) {
      return (
        <View>
          <Text>{loc.send.dynamic_init}</Text>
        </View>
      );
    }

    return (
      <View style={animatedQRCodeStyle.container}>
        {this.renderFormatPicker()}

        <TouchableOpacity
          accessibilityRole="button"
          testID="DynamicPSBTCode"
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            this.setState(prevState => ({ hideControls: !prevState.hideControls }));
          }}
        >
          {this.state.displayQRCode && (
            <View style={animatedQRCodeStyle.qrcodeContainer}>
              <QRCodeComponent
                isLogoRendered={false}
                value={this.getCurrentValue()}
                size={this.state.qrCodeHeight}
                isMenuAvailable={false}
                ecl="L"
                onError={this.onError}
              />
            </View>
          )}
        </TouchableOpacity>

        {!this.state.hideControls && (
          <View style={animatedQRCodeStyle.container}>
            <BlueSpacing20 />
            <View>
              <Text style={animatedQRCodeStyle.text}>
                {this.state.format === 'plain'
                  ? `${loc.send.psbt_plain}`
                  : loc.formatString(loc._.of, { number: this.state.index + 1, total: this.state.total })
                }
              </Text>
            </View>
            <BlueSpacing20 />
            <View style={animatedQRCodeStyle.controller}>
              <TouchableOpacity
                accessibilityRole="button"
                style={[animatedQRCodeStyle.button, { width: '25%', alignItems: 'flex-start' }]}
                onPress={this.moveToPreviousFragment}
                disabled={this.state.total <= 1}
              >
                <Text style={[animatedQRCodeStyle.text, this.state.total <= 1 && disabledStyles.disabled]}>
                  {loc.send.dynamic_prev}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={[animatedQRCodeStyle.button, { width: '50%' }]}
                onPress={this.state.intervalHandler ? this.stopAutoMove : this.startAutoMove}
                disabled={this.state.total <= 1}
              >
                <Text style={[animatedQRCodeStyle.text, this.state.total <= 1 && disabledStyles.disabled]}>
                  {this.state.intervalHandler ? loc.send.dynamic_stop : loc.send.dynamic_start}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={[animatedQRCodeStyle.button, { width: '25%', alignItems: 'flex-end' }]}
                onPress={this.moveToNextFragment}
                disabled={this.state.total <= 1}
              >
                <Text style={[animatedQRCodeStyle.text, this.state.total <= 1 && disabledStyles.disabled]}>
                  {loc.send.dynamic_next}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }
}

const animatedQRCodeStyle = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
  },
  qrcodeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  controller: {
    width: '90%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 25,
    height: 45,
    paddingHorizontal: 18,
  },
  button: {
    alignItems: 'center',
    height: 45,
    justifyContent: 'center',
  },
  text: {
    fontSize: 14,
    color: BlueCurrentTheme.colors.foregroundColor,
    fontWeight: 'bold',
  },
});

const pickerStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#2a2a2e',
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
  },
  tab: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#4a90d9',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
  },
  activeTabText: {
    color: '#fff',
  },
});

const disabledStyles = StyleSheet.create({
  disabled: {
    opacity: 0.3,
  },
});
