/* eslint react/prop-types: "off", react-native/no-inline-styles: "off" */
import React, { Component } from 'react';
import { Text } from 'react-native-elements';
import { Dimensions, LayoutAnimation, StyleSheet, TouchableOpacity, View } from 'react-native';
import { splitQRs } from 'bbqr';
import QRCodeComponent from './QRCodeComponent';
import { BlueCurrentTheme } from '../components/themes';
import { BlueSpacing20 } from '../BlueComponents';
import loc from '../loc';

const { height, width } = Dimensions.get('window');

export class BBQrDynamicQRCode extends Component {
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
    };
  }

  fragments = [];

  componentDidMount() {
    const { value, fileType = 'P' } = this.props;
    try {
      // Convert base64 PSBT string to Uint8Array for BBQr
      const raw = Uint8Array.from(Buffer.from(value, 'base64'));
      const result = splitQRs(raw, fileType, {
        encoding: 'Z',
        minVersion: 5,
        maxVersion: 40,
      });

      this.fragments = result.parts;
      console.log('[BBQr] Split into', this.fragments.length, 'parts, encoding:', result.encoding);
      
      this.setState(
        {
          total: this.fragments.length,
          displayQRCode: true,
        },
        () => {
          this.startAutoMove();
        },
      );
    } catch (e) {
      console.log('[BBQr] Error splitting PSBT:', e);
      this.setState({ displayQRCode: false });
    }
  }

  moveToNextFragment = () => {
    const { index, total } = this.state;
    if (index === total - 1) {
      this.setState({
        index: 0,
      });
    } else {
      this.setState(state => ({
        index: state.index + 1,
      }));
    }
  };

  startAutoMove = () => {
    if (!this.state.intervalHandler)
      this.setState(() => ({
        intervalHandler: setInterval(this.moveToNextFragment, 500),
      }));
  };

  stopAutoMove = () => {
    clearInterval(this.state.intervalHandler);
    this.setState(() => ({
      intervalHandler: null,
    }));
  };

  moveToPreviousFragment = () => {
    const { index, total } = this.state;
    if (index > 0) {
      this.setState(state => ({
        index: state.index - 1,
      }));
    } else {
      this.setState(state => ({
        index: total - 1,
      }));
    }
  };

  onError = () => {
    console.log('Data is too large for QR Code.');
    this.setState({ displayQRCode: false });
  };

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
          testID="DynamicCode"
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            this.setState(prevState => ({ hideControls: !prevState.hideControls }));
          }}
        >
          {this.state.displayQRCode && (
            <View style={animatedQRCodeStyle.qrcodeContainer}>
              <QRCodeComponent
                isLogoRendered={false}
                value={currentFragment}
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
                {loc.formatString(loc._.of, { number: this.state.index + 1, total: this.state.total })}
              </Text>
            </View>
            <BlueSpacing20 />
            <View style={animatedQRCodeStyle.controller}>
              <TouchableOpacity
                accessibilityRole="button"
                style={[animatedQRCodeStyle.button, { width: '25%', alignItems: 'flex-start' }]}
                onPress={this.moveToPreviousFragment}
              >
                <Text style={animatedQRCodeStyle.text}>{loc.send.dynamic_prev}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={[animatedQRCodeStyle.button, { width: '50%' }]}
                onPress={this.state.intervalHandler ? this.stopAutoMove : this.startAutoMove}
              >
                <Text style={animatedQRCodeStyle.text}>{this.state.intervalHandler ? loc.send.dynamic_stop : loc.send.dynamic_start}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={[animatedQRCodeStyle.button, { width: '25%', alignItems: 'flex-end' }]}
                onPress={this.moveToNextFragment}
              >
                <Text style={animatedQRCodeStyle.text}>{loc.send.dynamic_next}</Text>
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
