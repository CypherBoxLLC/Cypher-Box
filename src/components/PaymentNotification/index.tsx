import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, Vibration } from 'react-native';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../../blue_modules/hapticFeedback';

type WalletType = 'coinos' | 'hot' | 'cold' | 'lightning';

interface NotificationData {
  amount: number;
  confirmed: boolean;
  walletType: WalletType;
  walletName?: string;
}

const WALLET_THEMES: Record<WalletType, { bg: string; border: string; accent: string; label: string }> = {
  coinos: {
    bg: '#2a1225',
    border: '#e84393',
    accent: '#e84393',
    label: 'CoinOS',
  },
  lightning: {
    bg: '#2a1225',
    border: '#e84393',
    accent: '#e84393',
    label: 'Lightning',
  },
  hot: {
    bg: '#0d2818',
    border: '#00b894',
    accent: '#00b894',
    label: 'Hot Vault',
  },
  cold: {
    bg: '#0d1f2b',
    border: '#00cec9',
    accent: '#00cec9',
    label: 'Cold Storage',
  },
};

let notificationQueue: NotificationData[] = [];
let showNotification: ((data: NotificationData) => void) | null = null;

const processQueue = () => {
  if (notificationQueue.length > 0 && showNotification) {
    const next = notificationQueue.shift()!;
    showNotification(next);
  }
};

export const triggerPaymentNotification = (
  amount: number,
  confirmed: boolean,
  walletType: WalletType = 'coinos',
  walletName?: string,
) => {
  const data: NotificationData = { amount, confirmed, walletType, walletName };
  if (showNotification) {
    notificationQueue.push(data);
    if (notificationQueue.length === 1) {
      processQueue();
    }
  }
};

function formatSats(amount: number): string {
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(4)} BTC`;
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(2)}M sats`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K sats`;
  return `${amount.toLocaleString()} sats`;
}

const PaymentNotification: React.FC = () => {
  const translateY = useRef(new Animated.Value(-150)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<NotificationData>({ amount: 0, confirmed: false, walletType: 'coinos' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    showNotification = (notifData: NotificationData) => {
      if (timerRef.current) clearTimeout(timerRef.current);

      setData(notifData);
      setVisible(true);

      // Haptic + vibration
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
      Vibration.vibrate([0, 200, 100, 200]);

      // Slide in
      translateY.setValue(-150);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 60,
          friction: 8,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto dismiss after 4s, then process next in queue
      timerRef.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: -150,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setVisible(false);
          processQueue();
        });
      }, 4000);
    };

    return () => {
      showNotification = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!visible) return null;

  const theme = WALLET_THEMES[data.walletType] || WALLET_THEMES.coinos;
  const formatted = formatSats(data.amount);
  const label = data.confirmed ? 'Received' : 'Incoming';
  const walletLabel = data.walletName || theme.label;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <View style={[styles.banner, { backgroundColor: theme.bg, borderColor: theme.border, shadowColor: theme.accent }]}>
        <Text style={styles.icon}>⚡️</Text>
        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: theme.accent }]}>{label} · {walletLabel}</Text>
          <Text style={styles.amount}>{formatted}</Text>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 9999,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 8,
  },
  icon: {
    fontSize: 32,
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  amount: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
  },
});

export default PaymentNotification;
