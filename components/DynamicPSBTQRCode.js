/* eslint react/prop-types: "off", react-native/no-inline-styles: "off" */
/**
 * Multi-format PSBT QR Code exporter
 * 
 * Tries formats in order of preference (like BlueWallet):
 * 1. BBQr - Best compression, animated QR (for Jade, Passport, etc.)
 * 2. UR - For Coldcard and other UR-compatible devices
 * 3. Plain QR - For legacy wallets that don't support either
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
      format: null, // 'bbqr', 'ur', or 'plain'
    };
  }

  fragments = [];
  psbtBase64 = '';

  componentDidMount() {
    const { value, capacity = 200 } = this.props;
    this.psbtBase64 = value;
    
    // Try UR encoding first (for Coldcard, Jade, etc.) - matches original BlueWallet behavior
    try {
      const urFragments = encodeUR(value, capacity);
      if (urFragments && urFragments.length > 0) {
        this.fragments = urFragments;
        this.setState({ format: 'ur' });
        console.log('[PSBT QR] Using UR format,', this.fragments.length, 'parts');
        this._startAnimation();
        return;
      }
    } catch (e) {
      console.log('[PSBT QR] UR failed:', e.message);
    }
    
    // Fall back to BBQr (for Jade, Passport, etc.)
    try {
      const bbqrResult = splitBBQrQRs(value, {
        encoding: 'Z',
        minVersion: 5,
        maxVersion: 40,
      });
      
      if (bbqrResult.parts && bbqrResult.parts.length > 0) {
        this.fragments = bbqrResult.parts;
        this.setState({ format: 'bbqr' });
        console.log('[PSBT QR] Using BBQr format,', this.fragments.length, 'parts');
        this._startAnimation();
        return;
      }
    } catch (e) {
      console.log('[PSBT QR] BBQr failed:', e.message);
    }
    
    // Final fallback: plain QR (single QR code, no animation)
    // For small PSBTs that fit in one QR
    this.fragments = [value];
    this.setState({ format: 'plain', total: 1 });
    console.log('[PSBT QR] Using plain QR format');
  }

  _startAnimation() {
    this.setState(
      {
        total: this.fragments.length,
        displayQRCode: true,
      },
      () => {
        this.startAutoMove();
      },
    );
  }

  moveToNextFragment = () => {
    const { index, total } = this.state;
    if (index === total - 1) {
      this.setState({ index: 0 });
    } else {
      this.setState(state => ({ index: state.index + 1 }));
    }
  };

  startAutoMove = () => {
    // Only auto-animate if we have multiple fragments
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
    
    if (format === 'bbqr') {
      // BBQr parts are already complete QR strings
      return currentFragment;
    } else if (format === 'ur') {
      // UR parts need to be uppercased
      return currentFragment.toUpperCase();
    } else {
      // Plain format - use as-is
      return currentFragment;
    }
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
                <Text style={[animatedQRCodeStyle.text, this.state.total <= 1 && styles.disabled]}>
                  {loc.send.dynamic_prev}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={[animatedQRCodeStyle.button, { width: '50%' }]}
                onPress={this.state.intervalHandler ? this.stopAutoMove : this.startAutoMove}
                disabled={this.state.total <= 1}
              >
                <Text style={[animatedQRCodeStyle.text, this.state.total <= 1 && styles.disabled]}>
                  {this.state.intervalHandler ? loc.send.dynamic_stop : loc.send.dynamic_start}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={[animatedQRCodeStyle.button, { width: '25%', alignItems: 'flex-end' }]}
                onPress={this.moveToNextFragment}
                disabled={this.state.total <= 1}
              >
                <Text style={[animatedQRCodeStyle.text, this.state.total <= 1 && styles.disabled]}>
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

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.3,
  },
});
