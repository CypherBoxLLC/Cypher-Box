import { Text } from "@Cypher/component-library";
import { GradientText } from "@Cypher/components";
import { dispatchNavigate } from "@Cypher/helpers";
import { formatNumber, getStrikeCurrency } from "@Cypher/helpers/coinosHelper";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import { Picker } from "@react-native-picker/picker";
import React, { useEffect, useState } from "react";
import { TouchableOpacity, View } from "react-native";
import Modal from "react-native-modal";
import { getFiatRate } from "../../../../models/fiatUnit";
import styles from "./styles";

/**
 * ArkThreshold — picker UI for the Ark vault's withdraw trigger + spending
 * reserve. Mirrors `Threshold.tsx` (Strike/CoinOS) so the user gets a
 * familiar dual-picker shape, but reads/writes the dedicated Ark slots in
 * the auth store (`withdrawArkThreshold`, `reserveArkAmount`).
 *
 * Differences from the Strike version:
 *   - Range data starts at 100K (Ark balances live in a smaller band than
 *     Strike's typical custody amounts).
 *   - Helper copy is Ark-flavored: "Lightning Account" → "Ark vault",
 *     "custody by a bitcoin custodian" → counter-party / ASP risk.
 *   - The "Customize" link routes to the shared WithdrawThreshold keypad
 *     screen with Ark-tuned bounds (`minSats`/`maxSats`/`kindLabel`) so
 *     the validation copy reads correctly.
 *
 * Embedded inline in the Ark Account tab (Account.tsx, isArk branch). Ark
 * doesn't have a dedicated Threshold tab slot — the Capsules tab takes
 * that position — so this component lives next to the Card on the
 * Account view.
 */

const data = [
  { sats: 100_000 },
  { sats: 200_000 },
  { sats: 300_000 },
  { sats: 400_000 },
  { sats: 500_000 },
  { sats: 600_000 },
  { sats: 700_000 },
  { sats: 800_000 },
  { sats: 900_000 },
  { sats: 1_000_000 },
  { sats: 2_000_000 },
  { sats: 3_000_000 },
  { sats: 4_000_000 },
  { sats: 5_000_000 },
  { sats: 6_000_000 },
  { sats: 7_000_000 },
  { sats: 8_000_000 },
  { sats: 9_000_000 },
  { sats: 10_000_000 },
];

// Reserve range starts smaller than Strike's because the typical Ark
// "leftover for Lightning sends" amount is closer to per-tx-sized than
// per-month-sized. Top stops at 1M to encourage withdrawing larger
// balances rather than keeping them parked in the ASP.
const reserveData = [
  { sats: 50_000 },
  { sats: 100_000 },
  { sats: 200_000 },
  { sats: 300_000 },
  { sats: 400_000 },
  { sats: 500_000 },
  { sats: 600_000 },
  { sats: 700_000 },
  { sats: 800_000 },
  { sats: 900_000 },
  { sats: 1_000_000 },
];

interface Props {
  matchedRate: any;
  currency: any;
}

export default function ArkThreshold({ matchedRate, currency }: Props) {
  const {
    withdrawArkThreshold,
    reserveArkAmount,
    setWithdrawArkThreshold,
    setReserveArkAmount,
  } = useAuthStore();

  const [isModalVisible, setModalVisible] = useState(false);
  const [isModalRAVisible, setModalRAVisible] = useState(false);
  const [value, setValue] = useState(Number(withdrawArkThreshold) || 500_000);
  const [reserveAmt, setReserveAmt] = useState(
    Number(reserveArkAmount) || 100_000,
  );

  // Pull USD-per-BTC directly from the BlueWallet currency module so the
  // exchange-rate label doesn't depend on the parent's `matchedRate` prop
  // (which arrives 0 in some entry paths). One-shot fetch on mount; the
  // BlueWallet currency module caches the rate to AsyncStorage between
  // app sessions, so subsequent fetches are essentially free.
  const [usdPerBtc, setUsdPerBtc] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rate = await getFiatRate(currency || 'USD');
        if (!cancelled) setUsdPerBtc(Number(rate) || 0);
      } catch (err) {
        if (__DEV__) console.warn('[ArkThreshold] rate fetch failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [currency]);

  // sats → fiat. 1 BTC = 100,000,000 sats; rate is USD per whole BTC.
  const fiatFromSats = (sats: number) => (sats / 100_000_000) * usdPerBtc;

  const selectClickHandler = (val: number) => {
    setWithdrawArkThreshold(val);
    setValue(Number(val));
    setModalVisible(false);
  };

  const selectRAClickHandler = (val: number) => {
    setReserveArkAmount(val);
    setReserveAmt(Number(val));
    setModalRAVisible(false);
  };

  // Customize → WithdrawThreshold keypad. Pass Ark-tuned bounds so the
  // validation copy ("between Xk to Ym sats") reads correctly. The keypad
  // still allows out-of-band values via "Set anyways"; bounds are guidance,
  // not hard caps.
  const customizeClickHandler = (index: number) => {
    dispatchNavigate("WithdrawThreshold", {
      title: index === 0 ? "Ark Withdraw Threshold" : "Ark Reserve Amount",
      titleBtn: index === 0 ? "Set Threshold" : "Set Reserve Amount",
      onSelect: onSelect,
      index,
      matchedRate,
      currency,
      // Threshold guidance: 50K floor (below this you'll churn fees), 10M
      // ceiling (above this you're carrying too much ASP-side balance).
      // Reserve guidance: 50K floor, 1M ceiling — keeps the spending
      // reserve in a per-tx band, not a savings band.
      minSats: index === 0 ? 50_000 : 50_000,
      maxSats: index === 0 ? 10_000_000 : 1_000_000,
      kindLabel: "Ark vault",
      // Ark surface uses the yellow palette instead of the default pink,
      // and hides the MAX shortcut — "max" doesn't mean anything when
      // setting a withdrawal threshold or reserve floor (it's not bounded
      // by a current balance).
      colors_: [colors.ark.extralight, colors.ark.main],
      hideMax: true,
    });
  };

  const onSelect = (val: number, index: number) => {
    if (index === 0) {
      setValue(Number(val));
      setWithdrawArkThreshold(val);
    } else {
      setReserveAmt(Number(val));
      setReserveArkAmount(val);
    }
  };

  return (
    <View style={{ marginTop: 12, marginHorizontal: 16 }}>
      <Text h2 semibold>
        Withdraw Threshold
      </Text>
      <Text style={{ marginTop: 6 }}>
        When your Ark vault balance crosses this amount, you'll be prompted to
        move funds into deeper self-custody — your Hot or Cold Vault.
      </Text>

      {/* Wide dark-rectangle dropdown — matches the new picker design used
          in CheckingAccountCreated (Strike onboarding). Replaces the older
          GradientCard chevron variant. */}
      <TouchableOpacity
        onPress={() => setModalVisible(true)}
        activeOpacity={0.7}
        style={{
          backgroundColor: colors.gray.dark,
          borderRadius: 14,
          padding: 14,
          marginTop: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderWidth: 1,
          borderColor: "#3A3A3A",
        }}
      >
        <Text bold style={{ fontSize: 16 }}>
          {formatNumber(value)} sats
        </Text>
        <Text style={{ fontSize: 13, color: "#AAAAAA" }}>Tap to change</Text>
      </TouchableOpacity>
      <Modal
        isVisible={isModalVisible}
        onBackdropPress={() => setModalVisible(false)}
      >
        <View
          style={{
            backgroundColor: colors.gray.dark,
            borderRadius: 20,
            padding: 16,
          }}
        >
          <Picker
            selectedValue={value}
            onValueChange={(itemValue) => selectClickHandler(itemValue)}
            itemStyle={{ color: "#FFFFFF", fontSize: 20 }}
          >
            {data.map((item) => (
              <Picker.Item
                key={item.sats}
                label={`${formatNumber(item.sats)} sats  ~${getStrikeCurrency(
                  currency || "USD",
                )}${fiatFromSats(item.sats).toFixed(2)}`}
                value={item.sats}
              />
            ))}
          </Picker>
        </View>
      </Modal>
      <Text center style={[styles.usd, { marginTop: 20 }]}>
        {getStrikeCurrency(currency || "USD")}
        {fiatFromSats(value).toFixed(2)}
      </Text>
      <TouchableOpacity onPress={() => customizeClickHandler(0)}>
        <GradientText
          style={styles.gradientText}
          colors_={[colors.ark.light, colors.ark.main]}
        >
          Customize
        </GradientText>
      </TouchableOpacity>

      {/* Reserve picker. Concept: how much you want to *keep* on Ark for
          everyday Lightning sends after a withdraw — i.e. the floor that
          a withdraw won't drop below. */}
      <View style={styles.reserve}>
        <Text h2 semibold>
          Reserve Amount
        </Text>
      </View>
      <Text style={{ marginTop: 6 }}>
        Sats kept in your Ark vault after a withdrawal — your spending buffer
        for everyday Lightning sends.
      </Text>
      <TouchableOpacity
        onPress={() => setModalRAVisible(true)}
        activeOpacity={0.7}
        style={{
          backgroundColor: colors.gray.dark,
          borderRadius: 14,
          padding: 14,
          marginTop: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderWidth: 1,
          borderColor: "#3A3A3A",
        }}
      >
        <Text bold style={{ fontSize: 16 }}>
          {formatNumber(reserveAmt)} sats
        </Text>
        <Text style={{ fontSize: 13, color: "#AAAAAA" }}>Tap to change</Text>
      </TouchableOpacity>
      <Text center style={[styles.usd, { marginTop: 20 }]}>
        {getStrikeCurrency(currency || "USD")}
        {fiatFromSats(reserveAmt).toFixed(2)}
      </Text>
      <TouchableOpacity onPress={() => customizeClickHandler(1)}>
        <GradientText
          style={styles.gradientText}
          colors_={[colors.ark.light, colors.ark.main]}
        >
          Customize
        </GradientText>
      </TouchableOpacity>
      <Modal
        isVisible={isModalRAVisible}
        onBackdropPress={() => setModalRAVisible(false)}
      >
        <View
          style={{
            backgroundColor: colors.gray.dark,
            borderRadius: 20,
            padding: 16,
          }}
        >
          <Picker
            selectedValue={reserveAmt}
            onValueChange={(itemValue) => selectRAClickHandler(itemValue)}
            itemStyle={{ color: "#FFFFFF", fontSize: 20 }}
          >
            {reserveData.map((item) => (
              <Picker.Item
                key={item.sats}
                label={`${formatNumber(item.sats)} sats  ~${getStrikeCurrency(
                  currency || "USD",
                )}${fiatFromSats(item.sats).toFixed(2)}`}
                value={item.sats}
              />
            ))}
          </Picker>
        </View>
      </Modal>
    </View>
  );
}
