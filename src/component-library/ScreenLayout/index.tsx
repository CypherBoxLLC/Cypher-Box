// *** React Import
import React, { ReactElement } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  RefreshControlProps,
  TouchableOpacity,
  StatusBar,
  StatusBarStyle,
  Image,
} from 'react-native';

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
                onPress={handledBackPress}>
                <ImageView
                  image={Back}
                  imageStyle={{ width: 30, height: 28 }}
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
        edges={edges ? edges : ['right', 'left', 'top']}
        style={StyleSheet.flatten([styles.inner, style])}>
        <StatusBar backgroundColor={colors.primary} barStyle={barStyle} />
        {renderContent()}
      </SafeAreaView>
    </View>
  );
}

export default ScreenLayout;
