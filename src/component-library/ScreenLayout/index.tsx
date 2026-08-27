// *** React Import
import React, { ReactElement } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

// *** Custom component
import Text from '../Text';
import { colors } from '@Cypher/style-guide';
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
                  imageStyle={{ width: 30, height: 28, tintColor: '#FFFFFF' }}
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
  return (
    <View style={styles.inner}>
      <SafeAreaView
        edges={edges ? edges : DEFAULT_EDGES}
        style={StyleSheet.flatten([styles.inner, style])}>
        <StatusBar backgroundColor={colors.primary} barStyle={barStyle} />
        {renderContent()}
      </SafeAreaView>
    </View>
  );
}

export default ScreenLayout;
