import { Text } from "@Cypher/component-library";
import { widths } from "@Cypher/style-guide";
import React from "react";
import {
  Image,
  ImageSourcePropType,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import styles from "./styles";

interface TabItem {
  id: number;
  name: string;
  /** PNG/SVG source rendered via <Image>. Optional when iconElement is provided. */
  icon?: ImageSourcePropType;
  /** Rendered React element override — use this to plug in a vector
   *  icon (Ionicons / Feather / etc.) when no matching PNG exists in
   *  the assets. Wins over `icon` if both are set. */
  iconElement?: React.ReactNode;
}

interface Props {
  tabs: TabItem[];
  selectedTab: number;
  onTabChange: (tabId: number) => void;
  activeColors?: string[];
  inactiveColors?: string[];
}

export default function CustomTabView({
  tabs,
  selectedTab,
  onTabChange,
  activeColors = ["#171717", "#242222"],
  inactiveColors = ["#303030", "#303030"],
}: Props) {
  const customWidth = (widths - 40) / tabs.length

  return (
    <View style={styles.tabSelectorContainer}>
      {tabs.map((tab, index) => (
        <LinearGradient
          key={tab.id}
          colors={selectedTab === tab.id ? activeColors : inactiveColors}
          style={[
            styles.tabButton,
            index === 0 && styles.firstTab,
            index === tabs.length - 1 && styles.lastTab,
            {width: customWidth}
          ]}
        >
          <TouchableOpacity
            onPress={() => onTabChange(tab.id)}
            style={styles.tabButtonContent}
          >
            {tab.iconElement ? (
              tab.iconElement
            ) : tab.icon ? (
              <Image
                source={tab.icon}
                style={styles.tabIcon}
                resizeMode="contain"
              />
            ) : null}
            <Text bold h3>
              {tab.name}
            </Text>
          </TouchableOpacity>
        </LinearGradient>
      ))}
    </View>
  );
}
