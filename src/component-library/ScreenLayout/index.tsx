// *** React Import
import React, { ReactElement, useContext } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Platform,
  RefreshControlProps,
  TouchableOpacity,
  StatusBar,
  StatusBarStyle,
  Image,
} from 'react-native';
import { safeTopInset } from '../../helpers/safeTopInset';

/**
 * Which sides get an inset when a screen does not name its own.
 *
 * Android 16 (targetSdk 36) ENFORCES edge-to-edge and removed the
 * windowOptOutEdgeToEdgeEnforcement escape hatch, so the app draws behind the
 * system bars whether it asks to or not. Without a bottom inset, the last
 * element on a screen sits under the navigation bar or the gesture pill, which
 * is worst for the buttons that tend to live there: partly covered, and in the
 * gesture strip where swipes get intercepted before the button sees them.
 *
 * 81 of the screens in this app render through ScreenLayout and none of them
 * pass their own `edges`, so this default is the only thing standing between
 * them and that.
 *
 * ANDROID ONLY, deliberately. On iOS a bottom inset also pads for the home
 * indicator, which would shift the layout of every one of those screens. iOS
 * has no edge-to-edge enforcement to answer for, so it keeps the existing
 * three sides and stays visually unchanged.
 *
 * Safe on older Android: react-native-safe-area-context reports a bottom inset
 * of 0 when the app is not drawing behind the navigation bar, so this is inert
 * below Android 16 and correct on it.
 */
const DEFAULT_EDGES: ReadonlyArray<'top' | 'bottom' | 'left' | 'right'> =
  Platform.OS === 'android'
    ? ['right', 'left', 'top', 'bottom']
    : ['right', 'left', 'top'];

// *** Third Party Import
import { SafeAreaInsetsContext, SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

// *** Custom component
import Text from '../Text';
import { colors, rtl } from '@Cypher/style-guide';
import ImageView from '../ImageView';
import { Back, Close } from '@Cypher/assets/images';
import { Progress } from '@Cypher/components';

// *** Custom styles
import styles from './styles';
import { isIOS } from 'react-native-elements/dist/helpers';

export interface Props {
  style?: any;
  children?: any;
  showHeader?: boolean;
  edges?: any;
  headerTitle?: String;
  onBackPress?(): void;
  isBackButton?: boolean;
  innerStyle?: any;
  showToolbar?: boolean;
  title?: any;
  showFilter?: boolean;
  keyboardAware?: boolean;
  disableScroll?: boolean;
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
  bottomPadding?: number;
  RefreshControl?: ReactElement<RefreshControlProps>;
  bottomLinearColorWhite?: boolean;
  rightIcon?: any;
  showToolbarWithMenu?: boolean;
  isHeader?: boolean;
  isTitleCenter?: any;
  progress?: number;
  color?: string[];
  isClose?: boolean;
}

function ScreenLayout({
  style,
  children,
  showHeader = false,
  edges,
  headerTitle,
  onBackPress,
  title,
  isBackButton = true,
  innerStyle,
  showToolbar = false,
  keyboardAware = false,
  disableScroll = false,
  keyboardShouldPersistTaps = 'never',
  bottomPadding = 0,
  RefreshControl,
  rightIcon,
  showToolbarWithMenu = false,
  isHeader = false,
  isTitleCenter,
  progress = -1,
  color,
  isClose = false,
}: Props) {
  const navigation: any = useNavigation();
  // useContext rather than useSafeAreaInsets: null instead of a throw outside a SafeAreaProvider
  const insets = useContext(SafeAreaInsetsContext);

  const handledBackPress = () => {
    onBackPress ? onBackPress() : navigation.goBack();
  };

  const renderContent = () => {
    return (
      <>
        {progress > -1 &&
          <Progress key={progress} current={progress} color={color} />
        }
        {isClose &&
          <TouchableOpacity style={styles.closeView} onPress={handledBackPress}>
            <Image source={Close} style={styles.closeImage} resizeMode='contain' />
          </TouchableOpacity>
        }
        {showToolbar && !showHeader ? (
          <View style={[styles.showToolbar, { justifyContent: isTitleCenter ? 'flex-start' : 'center' }]}>
            {isBackButton && (
              <TouchableOpacity
                style={styles.icon}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 20 }}
                onPress={handledBackPress}>
                <ImageView
                  image={Back}
                  imageStyle={[{ width: 30, height: 28, tintColor: '#FFFFFF' }, rtl.mirror]}
                  style={{ width: 30, height: 28 }}
                />
              </TouchableOpacity>
            )}
            {title &&
              <Text bold subHeader style={{ marginStart: isTitleCenter ? 50 : 0 }}>
                {title}
              </Text>
            }
          </View>
        ) : null}

        {keyboardAware ? (
          <>
            <KeyboardAwareScrollView
              keyboardShouldPersistTaps="handled"
              style={[styles.scrollView]}
              contentContainerStyle={styles.scrollView}>
              {children}
              <View style={{ height: bottomPadding }} />
            </KeyboardAwareScrollView>
          </>
        ) : (
          <>
            {disableScroll ? (
              <View style={[styles.scrollView]}>
                {children}
                {rightIcon}
              </View>
            ) : (
              <ScrollView
                nestedScrollEnabled={true}
                keyboardShouldPersistTaps={keyboardShouldPersistTaps}
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
                style={[styles.scrollView]}
                contentContainerStyle={StyleSheet.flatten([
                  styles.main,
                  innerStyle,
                ])}
                refreshControl={RefreshControl}>
                {children}
                {rightIcon}
              </ScrollView>
            )}
          </>
        )}
      </>
    );
  };

  const barStyle: StatusBarStyle = isIOS ? 'dark-content' : 'light-content';

  // Removed the outer <LinearGradient colors={[colors.white, colors.white]} />.
  // Under RN 0.76 New Arch (Fabric) with react-native-linear-gradient@2.8.3
  // (no codegenConfig → routed through the slow bridge interop), each
  // LinearGradient native-view creation costs ~800ms on mount. This outer
  // one was painting solid white (same-color stops) and was fully
  // overlaid by the SafeAreaView's colors.primary backgroundColor, so it
  // contributed nothing visual but was the single biggest commit-phase
  // cost in every ScreenLayout-based screen. Replaced with a plain View.
  // iOS: the top inset is applied here, from the provider's insets and never below the one measured at launch
  // (safeTopInset), not by the native SafeAreaView. That view keeps the last inset it applied, and on an iPhone XR it
  // was left at 0: Home, then the send and amount screens, sat with their header under the clock and battery. Only an
  // edges array asking for 'top' is handled this way; the other sides, and Android, stay with the SafeAreaView. A
  // screen's own top padding is added to the inset, as the SafeAreaView does.
  const requestedEdges = edges ? edges : DEFAULT_EDGES;
  const topFromInsets = Platform.OS === 'ios' && Array.isArray(requestedEdges) && requestedEdges.includes('top');
  const containerStyle = StyleSheet.flatten([styles.inner, style]) ?? {};
  const ownTop = [containerStyle.paddingTop, containerStyle.paddingVertical, containerStyle.padding].find(
    (value): value is number => typeof value === 'number',
  ) ?? 0;

  return (
    <View style={styles.inner}>
      <SafeAreaView
        edges={topFromInsets ? requestedEdges.filter((edge: string) => edge !== 'top') : requestedEdges}
        style={topFromInsets ? [containerStyle, { paddingTop: ownTop + safeTopInset(insets?.top) }] : containerStyle}>
        <StatusBar backgroundColor={colors.primary} barStyle={barStyle} />
        {renderContent()}
      </SafeAreaView>
    </View>
  );
}

export default ScreenLayout;
