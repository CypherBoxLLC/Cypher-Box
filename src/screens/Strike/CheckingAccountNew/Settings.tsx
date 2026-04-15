import { StrikeFull } from "@Cypher/assets/images";
import { GradientSwitch, Text } from "@Cypher/component-library";
import { GradientView } from "@Cypher/components";
import useAuthStore from "@Cypher/stores/authStore";
import { colors, widths } from "@Cypher/style-guide";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Animated as RNAnimated,
  ScrollView,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import SimpleToast from "react-native-simple-toast";
import styles from "./styles";
import { getStrikeProfile, getStrikeLimits, getBankPaymentMethods } from "@Cypher/api/strikeAPIs";

interface Props {
  receiveType: boolean;
  currency: string;
}

export default function Settings({ receiveType, currency }: Props) {
  const { strikeMe, clearStrikeAuth } = useAuthStore();
  const navigation = useNavigation();
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [limits, setLimits] = useState<any>(null);
  const [bankMethods, setBankMethods] = useState<any[]>([]);

  useEffect(() => {
    if (!receiveType) {
      loadStrikeData();
    } else {
      setIsLoading(false);
    }
  }, []);

  const loadStrikeData = async () => {
    setIsLoading(true);
    try {
      const [profileRes, limitsRes, bankRes] = await Promise.allSettled([
        getStrikeProfile(),
        getStrikeLimits(),
        getBankPaymentMethods(),
      ]);
      if (profileRes.status === 'fulfilled') setProfile(profileRes.value);
      if (limitsRes.status === 'fulfilled') setLimits(limitsRes.value);
      if (bankRes.status === 'fulfilled') {
        const methods = Array.isArray(bankRes.value) ? bankRes.value : bankRes.value?.items || [];
        setBankMethods(methods);
      }
    } catch (err) {
      console.error('Error loading Strike settings data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    clearStrikeAuth();
    setTimeout(() => {
      navigation.goBack();
    }, 500);
  };

  const renderRow = (label: string, value: string, valueColor?: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#333' }}>
      <Text style={{ fontSize: 15, color: '#AAA' }}>{label}</Text>
      <Text bold style={{ fontSize: 15, color: valueColor || '#FFF', flexShrink: 1, textAlign: 'right', marginLeft: 10 }}>{value}</Text>
    </View>
  );

  const renderSection = (title: string, children: React.ReactNode) => (
    <View style={{ marginTop: 24 }}>
      <Text bold style={{ fontSize: 16, color: colors.pink.default, marginBottom: 8 }}>{title}</Text>
      <View style={{ backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 4 }}>
        {children}
      </View>
    </View>
  );

  if (receiveType) {
    // CoinOS settings - keep minimal
    return (
      <ScrollView style={styles.flex}>
        <RNAnimated.View style={[styles.main, { paddingHorizontal: 24 }]}>
          {renderSection('Account', <>
            {renderRow('Lightning Address', strikeMe?.handle ? `${strikeMe.handle}@coinos.io` : 'N/A')}
          </>)}
          <GradientView
            style={{ marginTop: 40, alignSelf: 'center', height: 38, width: widths * 0.26, shadowColor: '#040404', shadowOffset: { width: 8, height: 8 }, shadowOpacity: 0.8, shadowRadius: 16, elevation: 8 }}
            linearGradientStyle={{ shadowColor: '#27272C', shadowOffset: { width: -8, height: -8 }, shadowOpacity: 0.48, shadowRadius: 12, elevation: 8 }}
            topShadowStyle={{ shadowOffset: { width: 2, height: 2 }, shadowRadius: 2, shadowColor: '#E85C5A', borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', alignItems: 'center' }}
            bottomShadowStyle={{ shadowOffset: { width: -2, height: -2 }, shadowRadius: 2, shadowOpacity: 1, shadowColor: '#030303', borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', position: 'absolute' }}
            linearGradientStyleMain={{ borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', alignItems: 'center' }}
            onPress={handleLogout}
          >
            <Text h3 bold center>Logout</Text>
          </GradientView>
        </RNAnimated.View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={{ paddingBottom: 40 }}>
      <RNAnimated.View style={[styles.main, { paddingHorizontal: 24 }]}>
        {isLoading ? (
          <ActivityIndicator size="large" color={colors.pink.default} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* Account Info */}
            {renderSection('Account', <>
              {renderRow('Username', strikeMe?.handle || strikeMe?.username || 'N/A')}
              {renderRow('Lightning Address', strikeMe?.handle ? `${strikeMe.handle}@strike.me` : 'N/A')}
              {profile?.email && renderRow('Email', profile.email)}
              {profile?.country && renderRow('Country', profile.country)}
              {renderRow('Currency', currency || 'USD')}
            </>)}

            {/* Limits */}
            {limits && renderSection('Limits', <>
              {limits?.deposit && renderRow(
                'Deposit Limit',
                `$${Number(limits.deposit?.remaining || limits.deposit?.limit || 0).toLocaleString()} / $${Number(limits.deposit?.limit || 0).toLocaleString()}`,
              )}
              {limits?.withdrawal && renderRow(
                'Withdrawal Limit',
                `$${Number(limits.withdrawal?.remaining || limits.withdrawal?.limit || 0).toLocaleString()} / $${Number(limits.withdrawal?.limit || 0).toLocaleString()}`,
              )}
              {limits?.send && renderRow(
                'Send Limit',
                `$${Number(limits.send?.remaining || limits.send?.limit || 0).toLocaleString()} / $${Number(limits.send?.limit || 0).toLocaleString()}`,
              )}
              {limits?.buy && renderRow(
                'Buy Limit',
                `$${Number(limits.buy?.remaining || limits.buy?.limit || 0).toLocaleString()} / $${Number(limits.buy?.limit || 0).toLocaleString()}`,
              )}
              {/* If limits is an array, render each */}
              {Array.isArray(limits) && limits.map((item: any, idx: number) => (
                <View key={idx}>
                  {renderRow(
                    item?.description || item?.type || `Limit ${idx + 1}`,
                    `$${Number(item?.remaining || item?.limit || 0).toLocaleString()} remaining`,
                  )}
                </View>
              ))}
            </>)}

            {/* Connected Bank Accounts */}
            {renderSection('Connected Banks', <>
              {bankMethods.length === 0 ? (
                <View style={{ paddingVertical: 14 }}>
                  <Text style={{ color: '#666', fontSize: 14, textAlign: 'center' }}>
                    No bank accounts connected.{'\n'}Link a bank account in the Strike app.
                  </Text>
                </View>
              ) : (
                bankMethods.map((bank: any, idx: number) => (
                  <View key={bank?.id || idx} style={{ paddingVertical: 10, borderBottomWidth: idx < bankMethods.length - 1 ? 0.5 : 0, borderBottomColor: '#333' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text bold style={{ fontSize: 15 }}>{bank?.bankName || 'Bank Account'}</Text>
                      <Text style={{ fontSize: 13, color: bank?.state === 'READY' ? colors.green : '#FF9500' }}>
                        {bank?.state || 'Unknown'}
                      </Text>
                    </View>
                    {bank?.accountNumber && (
                      <Text style={{ fontSize: 13, color: '#888', marginTop: 2 }}>
                        ****{bank.accountNumber.slice(-4)} {bank?.transferType ? `(${bank.transferType})` : ''}
                      </Text>
                    )}
                  </View>
                ))
              )}
            </>)}

            {/* Support */}
            {renderSection('Support', <>
              <View style={{ paddingVertical: 10 }}>
                <Text style={{ fontSize: 14, color: '#AAA' }}>
                  Experiencing issues with your Strike account?
                </Text>
                <Text style={{ fontSize: 14, color: '#AAA', marginTop: 6 }}>
                  1. Troubleshoot from the Strike app
                </Text>
                <Text style={{ fontSize: 14, color: '#AAA', marginTop: 4 }}>
                  2. Contact <Text style={{ color: colors.pink.default }}>Strike support</Text>
                </Text>
                <Text style={{ fontSize: 14, color: '#AAA', marginTop: 4 }}>
                  API issue? <Text style={{ color: colors.pink.default }}>Report here</Text>
                </Text>
              </View>
            </>)}

            {/* Logout */}
            <GradientView
              style={{ marginTop: 30, alignSelf: 'center', height: 38, width: widths * 0.26, shadowColor: '#040404', shadowOffset: { width: 8, height: 8 }, shadowOpacity: 0.8, shadowRadius: 16, elevation: 8 }}
              linearGradientStyle={{ shadowColor: '#27272C', shadowOffset: { width: -8, height: -8 }, shadowOpacity: 0.48, shadowRadius: 12, elevation: 8 }}
              topShadowStyle={{ shadowOffset: { width: 2, height: 2 }, shadowRadius: 2, shadowColor: '#E85C5A', borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', alignItems: 'center' }}
              bottomShadowStyle={{ shadowOffset: { width: -2, height: -2 }, shadowRadius: 2, shadowOpacity: 1, shadowColor: '#030303', borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', position: 'absolute' }}
              linearGradientStyleMain={{ borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', alignItems: 'center' }}
              onPress={handleLogout}
            >
              <Text h3 bold center>Logout</Text>
            </GradientView>

            <Image
              source={StrikeFull}
              style={styles.strikeImage}
              resizeMode="contain"
            />
          </>
        )}
      </RNAnimated.View>
    </ScrollView>
  );
}
