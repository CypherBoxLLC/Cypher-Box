import Clipboard from "@react-native-clipboard/clipboard";
import QRCode from "react-native-qrcode-svg";

import { Copy, StrikeFull } from "@Cypher/assets/images";
import { GradientSwitch, Text } from "@Cypher/component-library";
import { ExitFundingSourceList, GradientView } from "@Cypher/components";
import useAuthStore from "@Cypher/stores/authStore";
import { isCoinosAllowed, isStrikeAllowed } from "@Cypher/services/featureFlags";
import { colors, widths } from "@Cypher/style-guide";
import React, { useContext, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Image,
  Linking,
  Modal,
  Platform,
  Animated as RNAnimated,
  Text as RNText,
  ScrollView,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as Keychain from "react-native-keychain";
import { useNavigation } from "@react-navigation/native";
import SimpleToast from "react-native-simple-toast";
import styles from "./styles";
import { getStrikeProfile, getStrikeLimits, getBankPaymentMethods, revokeStrikeToken } from "@Cypher/api/strikeAPIs";
import {
  describeArkFailure,
  ESPLORA_URLS,
  ARK_SERVER_URL,
  AUTO_BACKUP_PATH,
  areBgNotificationsEnabled,
  computeArkExitPlan,
  computeExitFeeReserveSats,
  resolveExitReserveTarget,
  connectGoogleDrive,
  convertToExitFees,
  disconnectGoogleDrive,
  describeExitExclusion,
  estimateExitFeeConvert,
  getLastExitFeeDeadlineHeight,
  estimateArkOnchainRecover,
  recoverArkOnchainBoard,
  fetchArkExitVtxos,
  summariseExitPhase,
  AVG_BLOCK_MINUTES,
  fetchPendingExitsTotalSats,
  formatBlocksUntil,
  formatExitCollectWait,
  findAutoBackupForRecovery,
  getArkOnchainAddress,
  getAutoBackupPath,
  getCachedArkBackupFingerprint,
  getDriveBackupInfo,
  getICloudBackupPath,
  getICloudBackupPathForFingerprint,
  getLastLocalBackupNote,
  hasActiveArkExitRecords,
  isActiveExit,
  isGoogleDriveConnected,
  isICloudBackupAvailable,
  probeAspReachable,
  readArkSeedPhrase,
  resetArkWalletState,
  setArkBackgroundRefreshEnabled,
  startArkEmergencyExit,
  writeAndVerifyArkBackup,
  writeArkBackupToTempFile,
  buildExitFundingSources,
} from "@Cypher/services/ark";
import type { ExitEconomicPolicy, ExitFeeConvertEstimate, ExitTriageResult, ExitPhaseSummary } from "@Cypher/services/ark";
import RNFS from "react-native-fs";
import Share from "react-native-share";
import { BlueStorageContext } from "../../../../blue_modules/storage-context";
import { recordEvent } from "@Cypher/stores/eventLogStore";
import { setArkExitCorrelationId } from "@Cypher/services/activityCursors";
import loc from "../../../../loc";

interface Props {
  receiveType: boolean;
  currency: string;
  /** True when the parent tab navigated here as the Ark Vault settings. */
  isArk?: boolean;
}

export default function Settings({ receiveType, currency, isArk }: Props) {
  const { strikeMe, clearStrikeAuth, clearAuth } = useAuthStore();
  const navigation = useNavigation();
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [limits, setLimits] = useState<any>(null);
  const [bankMethods, setBankMethods] = useState<any[]>([]);

  useEffect(() => {
    // The Bark vault reuses this Settings screen but renders none of the Strike
    // data (no profile, fiat limits, or bank methods — see the `isArk` branch
    // below), so skip the Strike fetches entirely. Otherwise the vault fires
    // getStrikeProfile / getStrikeLimits / getBankPaymentMethods on mount, which
    // error in the background whenever Strike isn't logged in.
    if (isArk) {
      setIsLoading(false);
      return;
    }
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

  // Strike disconnect. Read the token BEFORE clearing, since clearStrikeAuth
  // nulls it, and fire the revoke without awaiting: local state must clear
  // immediately so a slow or failed network call can never leave the user
  // looking logged in with no way out. revokeStrikeToken never throws.
  const handleLogout = () => {
    const tokenToRevoke = useAuthStore.getState().strikeToken;
    void revokeStrikeToken(tokenToRevoke);
    clearStrikeAuth();
    setTimeout(() => {
      navigation.goBack();
    }, 500);
  };

  // CoinOS disconnect. This screen renders for both wallets, and the CoinOS
  // Logout used to call the Strike handler, so it disconnected Strike and left
  // the CoinOS session intact: the opposite of what the user asked for, and it
  // left a live custodial token behind.
  const handleCoinosLogout = () => {
    clearAuth();
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

  if (isArk) {
    // Ark Vault settings — non-custodial, so the surface is much smaller
    // than Strike's: no API account info to fetch (the SDK + ASP are the
    // ledger), no bank methods, no fiat limits. The headline addition is
    // the seed-phrase reveal, mirroring the Hot Vault Settings flow.
    return <ArkSettingsBody />;
  }

  if (receiveType) {
    // CoinOS settings - keep minimal
    return (
      <ScrollView style={styles.flex}>
        <RNAnimated.View style={[styles.main, { paddingHorizontal: 24 }]}>
          {renderSection(loc.cypherbox.strike.settings.account, <>
            {renderRow(loc.cypherbox.strike.settings.lightning_address, strikeMe?.handle ? `${strikeMe.handle}@coinos.io` : loc.cypherbox.strike.settings.not_available)}
          </>)}
          <GradientView
            style={{ marginTop: 40, alignSelf: 'center', height: 38, width: widths * 0.26, shadowColor: '#040404', shadowOffset: { width: 8, height: 8 }, shadowOpacity: 0.8, shadowRadius: 16, elevation: 8 }}
            linearGradientStyle={{ shadowColor: '#27272C', shadowOffset: { width: -8, height: -8 }, shadowOpacity: 0.48, shadowRadius: 12, elevation: 8 }}
            topShadowStyle={{ shadowOffset: { width: 2, height: 2 }, shadowRadius: 2, shadowColor: '#E85C5A', borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', alignItems: 'center' }}
            bottomShadowStyle={{ shadowOffset: { width: -2, height: -2 }, shadowRadius: 2, shadowOpacity: 1, shadowColor: '#030303', borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', position: 'absolute' }}
            linearGradientStyleMain={{ borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', alignItems: 'center' }}
            onPress={handleCoinosLogout}
          >
            <Text h3 bold center>{loc.cypherbox.strike.settings.logout}</Text>
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
            {renderSection(loc.cypherbox.strike.settings.account, <>
              {renderRow(loc.cypherbox.strike.settings.username, strikeMe?.handle || strikeMe?.username || loc.cypherbox.strike.settings.not_available)}
              {renderRow(loc.cypherbox.strike.settings.lightning_address, strikeMe?.handle ? `${strikeMe.handle}@strike.me` : loc.cypherbox.strike.settings.not_available)}
              {profile?.email && renderRow(loc.cypherbox.strike.settings.email, profile.email)}
              {profile?.country && renderRow(loc.cypherbox.strike.settings.country, profile.country)}
              {renderRow(loc.cypherbox.strike.settings.currency, currency || 'USD')}
            </>)}

            {/* Limits */}
            {limits && renderSection(loc.cypherbox.strike.settings.limits, <>
              {limits?.deposit && renderRow(
                loc.cypherbox.strike.settings.deposit_limit,
                `$${Number(limits.deposit?.remaining || limits.deposit?.limit || 0).toLocaleString()} / $${Number(limits.deposit?.limit || 0).toLocaleString()}`,
              )}
              {limits?.withdrawal && renderRow(
                loc.cypherbox.strike.settings.withdrawal_limit,
                `$${Number(limits.withdrawal?.remaining || limits.withdrawal?.limit || 0).toLocaleString()} / $${Number(limits.withdrawal?.limit || 0).toLocaleString()}`,
              )}
              {limits?.send && renderRow(
                loc.cypherbox.strike.settings.send_limit,
                `$${Number(limits.send?.remaining || limits.send?.limit || 0).toLocaleString()} / $${Number(limits.send?.limit || 0).toLocaleString()}`,
              )}
              {limits?.buy && renderRow(
                loc.cypherbox.strike.settings.buy_limit,
                `$${Number(limits.buy?.remaining || limits.buy?.limit || 0).toLocaleString()} / $${Number(limits.buy?.limit || 0).toLocaleString()}`,
              )}
              {/* If limits is an array, render each */}
              {Array.isArray(limits) && limits.map((item: any, idx: number) => (
                <View key={idx}>
                  {renderRow(
                    item?.description || item?.type || String(loc.formatString(loc.cypherbox.strike.settings.limit_n, { n: idx + 1 })),
                    String(loc.formatString(loc.cypherbox.strike.settings.amount_remaining, { amount: `$${Number(item?.remaining || item?.limit || 0).toLocaleString()}` })),
                  )}
                </View>
              ))}
            </>)}

            {/* Connected Bank Accounts */}
            {renderSection(loc.cypherbox.strike.settings.connected_banks, <>
              {bankMethods.length === 0 ? (
                <View style={{ paddingVertical: 14 }}>
                  <Text style={{ color: '#666', fontSize: 14, textAlign: 'center' }}>
                    {loc.cypherbox.strike.settings.no_banks}
                  </Text>
                </View>
              ) : (
                bankMethods.map((bank: any, idx: number) => (
                  <View key={bank?.id || idx} style={{ paddingVertical: 10, borderBottomWidth: idx < bankMethods.length - 1 ? 0.5 : 0, borderBottomColor: '#333' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text bold style={{ fontSize: 15 }}>{bank?.bankName || loc.cypherbox.strike.settings.bank_account}</Text>
                      <Text style={{ fontSize: 13, color: bank?.state === 'READY' ? colors.green : '#FF9500' }}>
                        {bank?.state || loc.cypherbox.strike.settings.unknown}
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
            {renderSection(loc.cypherbox.strike.settings.support, <>
              <View style={{ paddingVertical: 10 }}>
                <Text style={{ fontSize: 14, color: '#AAA' }}>
                  {loc.cypherbox.strike.settings.support_issues}
                </Text>
                <Text style={{ fontSize: 14, color: '#AAA', marginTop: 6 }}>
                  {loc.cypherbox.strike.settings.support_troubleshoot}
                </Text>
                <Text style={{ fontSize: 14, color: '#AAA', marginTop: 4 }}>
                  {loc.formatString(loc.cypherbox.strike.settings.support_contact, { link: <Text style={{ color: colors.pink.default }}>{loc.cypherbox.strike.settings.support_contact_link}</Text> })}
                </Text>
                <Text style={{ fontSize: 14, color: '#AAA', marginTop: 4 }}>
                  {loc.formatString(loc.cypherbox.strike.settings.support_api_issue, { link: <Text style={{ color: colors.pink.default }}>{loc.cypherbox.strike.settings.support_report_link}</Text> })}
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
              <Text h3 bold center>{loc.cypherbox.strike.settings.logout}</Text>
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

/**
 * Settings panel for the Ark Vault tab.
 *
 * Mirrors the Hot Vault Settings UX of "tap to reveal 12-word seed",
 * but reads from the iOS Keychain instead of an in-memory wallet
 * object — Ark's mnemonic is stored under the `ark-seed-phrase`
 * service slot, written biometric-protected at wallet creation.
 *
 * Reveal is two-stage:
 *   1. User taps "Show seed phrase" → triggers FaceID/passcode prompt
 *      via `Keychain.getGenericPassword`. If they decline, we surface
 *      a clean "Authentication declined" toast and stay collapsed.
 *   2. Words render in the same 12-tile grid the Hot Vault uses, with
 *      a "Hide" button that wipes them from React state when the user
 *      walks away. We never persist them in zustand or AsyncStorage.
 */
/**
 * Ark vault management panel.
 *
 * `view` controls which sections render so the same body can drive two
 * different tabs:
 *   - 'backup' (default) — Seed Phrase + Ark backup file. Lives on the
 *     Settings tab where one-time wallet-secret management belongs.
 *   - 'actions' — Auto-refresh capsules toggle, Emergency Exit flow,
 *     Delete Ark vault. Lives on the Vault tab so day-to-day wallet
 *     operations sit next to the balance card.
 *
 * All state and handlers live in this function regardless of view, so
 * mounting either tab pays a known cost; the unused branch just doesn't
 * render its JSX. The state still re-allocates per mount but only one
 * tab is mounted at a time per CheckingAccountNew session.
 */
export function ArkSettingsBody({ view = 'backup' }: { view?: 'backup' | 'actions' }) {
  const {
    clearArkAuth,
    isAuth,
    isStrikeAuth,
    walletID,
    coldStorageWalletID,
    arkBalanceDetail,
    arkExitInProgress,
    arkExitBatteryNoticeDismissed,
    setArkExitBatteryNoticeDismissed,
    arkExitDestinationAddress,
    arkExitStartedAt,
    arkExitFeeReserveSats,
    setArkExitInProgress,
    setArkExitDestinationAddress,
    setArkExitStartedAt,
    setArkExitDrained,
    arkExitStartedSats,
    setArkExitStartedSats,
    setArkExitFeeReserveSats,
    setArkExitRecommendedReserveSats,
    setArkExitFeeDeadlineHeight,
  } = useAuthStore() as any;
  const arkIosBackupReminderActive = useAuthStore((s) => s.arkIosBackupReminderActive);
  const setArkIosBackupReminderActive = useAuthStore((s) => s.setArkIosBackupReminderActive);
  const { wallets } = useContext(BlueStorageContext) as any;
  const navigation = useNavigation();

  // Find the most recent `ark-backup-*.cbark` in a directory. Used as a
  // fallback after the per-fingerprint stat probe to (a) survive RN 0.77
  // Fabric / RNFS interop quirks where exists() can return false for a
  // present file, and (b) display ANY existing backup even when the
  // fingerprint cache is cold or mismatched (legacy v1 backup, recovered-
  // with-new-seed flow). The user's safety perception depends on the UI
  // truthfully reflecting "a backup exists at this rail" — surfacing the
  // wrong "Not yet" while a real backup sits next to it in Files is the
  // bug this fixes.
  const findLatestArkBackup = async (dirPath: string) => {
    try {
      const entries = await RNFS.readDir(dirPath);
      const matches = entries
        .filter((e: any) => e.isFile() && /^ark-backup-.*\.cbark$/.test(e.name))
        .map((e: any) => ({
          name: e.name,
          mtime: e.mtime ? new Date(e.mtime as any).getTime() : 0,
          size: Number(e.size) || 0,
        }))
        .sort((a: any, b: any) => b.mtime - a.mtime);
      if (matches.length === 0) return null;
      const top = matches[0];
      return { modifiedAt: top.mtime, sizeBytes: top.size, filename: top.name };
    } catch (e: any) {
      if (__DEV__) console.log('[Ark settings] findLatestArkBackup failed:', e?.message ?? e);
      return null;
    }
  };
  const [words, setWords] = useState<string[] | null>(null);
  const [revealing, setRevealing] = useState(false);

  // Backup status — surfaced in the Settings panel so users can verify
  // each rail (local on-device + iCloud Drive on iOS / Google Drive on
  // Android) is healthy without opening a file manager. The local row
  // probes the always-local Documents path; the iCloud row probes the
  // ubiquity-container path independently so each shows a real
  // last-modified time, not just an "available?" state.
  // `null` = unknown / probing, `undefined` = no backup at this rail.
  // Errors are swallowed; UI shows the loading or "no backup yet" state.
  // `filename` is the actual on-disk name found during the probe so the
  // UI can surface the real per-wallet backup file (e.g.
  // `ark-backup-318f4a6a.cbark`) instead of hardcoding the legacy name.
  // Users were panicking when the UI said "No copy yet" while a real
  // backup sat next to it in Files; surfacing the filename closes that gap.
  type BackupInfo = { modifiedAt: number; sizeBytes: number; filename?: string };
  const [localBackup, setLocalBackup] = useState<BackupInfo | null | undefined>(null);
  // Diagnostic note from the most recent local-backup write (e.g. "saved via
  // direct write", or a failure reason). Surfaces the otherwise-silent local
  // write outcome so a New-Arch RNFS regression can't hide as "Not yet".
  const [localNote, setLocalNote] = useState<string | null>(null);
  const [iCloudAvailable, setICloudAvailable] = useState<boolean | null>(null);
  const [iCloudBackup, setICloudBackup] = useState<BackupInfo | null | undefined>(null);
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [driveBackup, setDriveBackup] = useState<BackupInfo | null | undefined>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  // Controls the expandable "When to use Emergency Exit" note below the
  // Emergency Exit button on the Ark Settings tab. Default collapsed —
  // the short caption is always visible, the longer explanation opens
  // inline on ? tap.
  const [exitInfoExpanded, setExitInfoExpanded] = useState(false);

  // Background-refresh toggle state + battery-exemption drift probe.
  // The toggle itself lives on this Settings tab so it's grouped with
  // other one-time wallet configuration; the Capsules tab now shows a
  // read-only "Auto-vtxo refresh: on/off" status indicator only.
  // `batteryNotExempt`: null = unprobed (don't render banner yet),
  // true = drifted (banner shown), false = exempt. iOS short-circuits
  // to false because `isIgnoringBatteryOptimizations` always returns
  // true there.
  const arkBgRefreshEnabled = useAuthStore((s) => s.arkBgRefreshEnabled);
  const [togglingBgRefresh, setTogglingBgRefresh] = useState(false);

  // Dropped in v0.1.1 alongside FGS_DATA_SYNC:
  // - batteryNotExempt state + probe effect + banner (battery Unrestricted
  //   only mattered for the FGS-driven alarm cadence; the surviving
  //   PushNotification.localNotificationSchedule path is allowWhileIdle).
  // - notificationsBlocked state + probe effect + banner (the banner
  //   nudged users to grant POST_NOTIFICATIONS specifically so the FGS
  //   notification would render; without the FGS the toggle alone is the
  //   user's signal, and the OS prompt fires on enable).
  // - [DEMO] Fire refresh alarm now button (Play submission demo).

  /**
   * Whether the OS will actually deliver a notification, as opposed to whether
   * the user has asked us to send them.
   *
   * These are two different facts and the screen used to show only the second.
   * `arkBgRefreshEnabled` defaults to true, and iOS resets notification
   * permission on every install, so after any reinstall or recovery the switch
   * came back green while nothing could be delivered. Permission is only
   * requested inside setArkBackgroundRefreshEnabled(true), which runs when the
   * switch is FLIPPED, so a switch that was already on never asked.
   *
   * That is the worst failure available to this particular control: its own
   * subtext promises five reminders and warns that recovery is not guaranteed
   * once a capsule expires, so a user reading it has affirmative evidence of
   * protection they do not have.
   *
   * null while the first probe is in flight; treated as "not blocked" so the
   * UI does not flash a warning before it knows anything.
   */
  const [osNotifPermission, setOsNotifPermission] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      areBgNotificationsEnabled()
        .then((ok) => {
          if (!cancelled) setOsNotifPermission(ok);
        })
        .catch(() => {
          // A failed probe is not evidence of a revoked permission. Assume
          // granted rather than accuse the OS of blocking us.
          if (!cancelled) setOsNotifPermission(true);
        });
    };
    probe();
    // Re-probe on foreground: granting permission happens in iOS Settings,
    // outside this app, so returning is the only moment we learn about it.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') probe();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  /** The user asked for reminders but the OS will not deliver them. */
  const remindersBlockedByOs = arkBgRefreshEnabled && osNotifPermission === false;
  /** What the control should SAY, which is whether reminders can arrive. */
  const remindersEffectivelyOn = arkBgRefreshEnabled && osNotifPermission !== false;

  const arkAutoRefreshEnabled = useAuthStore((s) => s.arkAutoRefreshEnabled);
  const setArkAutoRefreshEnabled = useAuthStore((s) => s.setArkAutoRefreshEnabled);

  /**
   * Turning automatic refresh OFF is confirmed; turning it back ON is not.
   *
   * Off is the direction that can cost the user their funds, and the deadline
   * it hands them is not the one they will assume. Expiry is not the last safe
   * moment: an emergency exit has to CONFIRM on chain before the capsule
   * expires, which is why the sweep itself refuses to act inside the last 28
   * hours. So the copy names a day of margin rather than saying "before it
   * expires".
   *
   * If reminders are off too, that is called out explicitly. Both off means
   * nothing in the app will tell them to act, and that combination should not
   * be reachable without being told.
   */
  const handleToggleAutoRefresh = (next: boolean) => {
    if (next) {
      setArkAutoRefreshEnabled(true);
      return;
    }
    const remindersAlsoOff = !remindersEffectivelyOn;
    Alert.alert(
      loc.cypherbox.strike.ark_settings.auto_refresh_off_title,
      loc.cypherbox.strike.ark_settings.auto_refresh_off_message
      + " "
      + (remindersAlsoOff
        ? loc.cypherbox.strike.ark_settings.auto_refresh_off_reminders_off
        : loc.cypherbox.strike.ark_settings.auto_refresh_off_reminders_on),
      [
        { text: loc._.cancel, style: "cancel" },
        {
          text: loc.cypherbox.strike.ark_settings.turn_off,
          style: "destructive",
          onPress: () => setArkAutoRefreshEnabled(false),
        },
      ],
      { cancelable: true },
    );
  };

  const handleToggleBgRefresh = async (next: boolean) => {
    if (togglingBgRefresh) return;
    setTogglingBgRefresh(true);
    try {
      if (next) {
        // No seed needed anymore: enabling only flips the flag and asks
        // for notification permission. The old path mirrored the seed
        // into a background-readable Keychain entry for headless wakes;
        // that machinery is gone.
        await setArkBackgroundRefreshEnabled(true);
        // Did the OS actually agree? iOS prompts at most once per install, so
        // a user who declined earlier gets no prompt and no permission, and
        // reporting "Reminders enabled" there would be the same lie in a
        // different place. Send them where they can actually grant it.
        const granted = await areBgNotificationsEnabled();
        setOsNotifPermission(granted);
        if (!granted) {
          Alert.alert(
            loc.cypherbox.strike.ark_settings.notif_permission_title,
            loc.cypherbox.strike.ark_settings.notif_permission_message,
            [
              { text: loc.cypherbox.strike.ark_settings.not_now, style: "cancel" },
              { text: loc.cypherbox.strike.ark_settings.open_settings, onPress: () => void Linking.openSettings() },
            ],
          );
          return;
        }
        SimpleToast.show(loc.cypherbox.strike.ark_settings.reminders_enabled, SimpleToast.SHORT);
      } else {
        await setArkBackgroundRefreshEnabled(false);
        SimpleToast.show(loc.cypherbox.strike.ark_settings.reminders_disabled, SimpleToast.SHORT);
      }
    } catch (err: any) {
      console.warn("[Ark bg refresh toggle] failed:", err);
      SimpleToast.show(
        String(loc.formatString(loc.cypherbox.strike.ark_settings.toggle_failed, { error: err?.message ?? loc.cypherbox.strike.ark_settings.unknown_error })),
        SimpleToast.LONG,
      );
    } finally {
      setTogglingBgRefresh(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    // One status read. Returns whether the fingerprint cache was warm —
    // caller uses that to decide whether to keep polling.
    //
    // iOS iCloud row: probes the ubiquity container DIRECTLY rather than
    // reusing the local file's stat. Documents IS the iCloud-mirrored
    // location when iCloud Drive is on, but Apple's sync isn't instant —
    // showing the iCloud copy's own mtime lets users SEE if upload is
    // lagging (mtime older than local row = sync stalled). This catches
    // the class of bug where the local file is fresh but iCloud's copy
    // is corrupted or truncated mid-upload.
    const refresh = async (): Promise<{ cacheWarm: boolean }> => {
      // Resolve the active wallet's per-wallet backup filename via the
      // cached BIP32 fingerprint — populated by every auto-backup tick.
      // When cold (cache empty), fall back to the legacy single-wallet
      // path so an upgrade-in-place user with a v1 backup still sees
      // something, and the polling loop below keeps trying until the
      // first auto-backup tick fires (~30s after wallet open).
      const fp = getCachedArkBackupFingerprint();
      const localPath = fp ? getAutoBackupPath(fp) : AUTO_BACKUP_PATH;

      // Local — RNFS.stat throws if the file doesn't exist; treat as
      // "no backup yet" rather than an error.
      try {
        const exists = await RNFS.exists(localPath);
        if (cancelled) return { cacheWarm: !!fp };
        if (exists) {
          const stat = await RNFS.stat(localPath);
          if (cancelled) return { cacheWarm: !!fp };
          setLocalBackup({
            modifiedAt: typeof stat.mtime === 'number' ? stat.mtime : new Date(stat.mtime as any).getTime(),
            sizeBytes: Number(stat.size) || 0,
            filename: localPath.split('/').pop(),
          });
        } else {
          // Fallback: enumerate Documents and pick the latest
          // `ark-backup-*.cbark`. Under RN 0.77 Fabric, RNFS.exists has
          // occasionally returned false for an actually-present file
          // (interop quirk + iCloud-evicted local copies). Without this
          // fallback the UI says "Not yet" while the user can see the
          // file in Files app, which scares them about funds safety.
          const found = await findLatestArkBackup(RNFS.DocumentDirectoryPath);
          if (cancelled) return { cacheWarm: !!fp };
          setLocalBackup(found ?? undefined);
        }
      } catch (e: any) {
        if (__DEV__) console.log('[Ark settings] local stat failed:', e?.message ?? e);
      }
      if (!cancelled) setLocalNote(getLastLocalBackupNote());

      // iCloud Drive (iOS only) — independent probe of the ubiquity
      // container. `isICloudBackupAvailable()` answers the gate question
      // (Drive on for Cypher Box?); the path stat answers the freshness
      // question against the active wallet's per-fingerprint file. We
      // fall back to the legacy single-file path when the fingerprint
      // cache is cold so an upgrade-in-place user with a v1 backup still
      // sees their iCloud copy reflected — the polling loop above will
      // re-probe after the first auto-backup tick warms the cache and
      // the per-wallet file shows up.
      if (Platform.OS === 'ios') {
        try {
          const available = await isICloudBackupAvailable();
          if (cancelled) return { cacheWarm: !!fp };
          setICloudAvailable(available);
          if (!available) {
            setICloudBackup(undefined);
          } else {
            const iCloudPath = fp
              ? await getICloudBackupPathForFingerprint(fp)
              : await getICloudBackupPath();
            if (cancelled) return { cacheWarm: !!fp };
            if (!iCloudPath) {
              // Bridge returned no path despite isICloudAvailable=true —
              // treat as "no copy yet" so the UI surfaces it instead of
              // spinning. Auto-backup tick will re-create on next run.
              setICloudBackup(undefined);
            } else {
              const exists = await RNFS.exists(iCloudPath);
              if (cancelled) return { cacheWarm: !!fp };
              if (exists) {
                const stat = await RNFS.stat(iCloudPath);
                if (cancelled) return { cacheWarm: !!fp };
                setICloudBackup({
                  modifiedAt:
                    typeof stat.mtime === 'number'
                      ? stat.mtime
                      : new Date(stat.mtime as any).getTime(),
                  sizeBytes: Number(stat.size) || 0,
                  filename: iCloudPath.split('/').pop(),
                });
              } else {
                // Same fallback rationale as the local probe — enumerate
                // the iCloud Documents directory and pick the latest
                // ark-backup-*.cbark. This catches both the
                // wrong-fingerprint case (cache cold or wallet recovered
                // with a new seed) and the RNFS.exists-returns-false-on-
                // iCloud-evicted-files case.
                const iCloudDir = iCloudPath.substring(0, iCloudPath.lastIndexOf('/'));
                const found = await findLatestArkBackup(iCloudDir);
                if (cancelled) return { cacheWarm: !!fp };
                setICloudBackup(found ?? undefined);
              }
            }
          }
        } catch (e: any) {
          if (__DEV__) console.log('[Ark settings] iCloud probe failed:', e?.message ?? e);
          // Resolve the spinner to a definite state even on probe error —
          // showing "Off for Cypher Box" is correct enough when the
          // bridge call throws, and avoids the user staring at the
          // spinner thinking the app's hung.
          if (!cancelled) {
            setICloudAvailable(false);
            setICloudBackup(undefined);
          }
        }
      }

      // Drive — connection check is cheap; metadata fetch is gated on it.
      // Pass the active fingerprint so the status reflects THIS wallet's
      // entry, not some other wallet's that happens to share the same
      // Google account. `null` (cold cache) targets the legacy single-
      // file entry as a back-compat fallback.
      try {
        const connected = await isGoogleDriveConnected();
        if (cancelled) return { cacheWarm: !!fp };
        setDriveConnected(connected);
        if (connected) {
          const info = await getDriveBackupInfo(fp);
          if (cancelled) return { cacheWarm: !!fp };
          setDriveBackup(info ?? undefined);
        } else {
          setDriveBackup(undefined);
        }
      } catch (e: any) {
        if (!cancelled) {
          setDriveConnected(false);
          setDriveError(e?.message || loc.cypherbox.strike.ark_settings.drive_unreachable);
        }
      }

      return { cacheWarm: !!fp };
    };

    // Poll until the fingerprint cache warms (= an auto-backup tick has
    // run since wallet open). Without polling, a user opening Settings
    // immediately after recovery sees "no copy yet" and never updates,
    // because the cache is module state and useEffect's deps array is
    // empty. Stop polling once the cache is warm — subsequent ticks
    // overwrite the same per-wallet file, so the displayed mtime/size
    // is at most one tick stale (acceptable for a status panel).
    let intervalHandle: ReturnType<typeof setInterval> | null = null;
    (async () => {
      const first = await refresh();
      if (cancelled || first.cacheWarm) return;
      // Re-poll every 3s for up to ~60s — covers the worst-case window
      // between wallet open and the first sync tick (which fires every
      // 30s in useArkSync). Once the cache warms, stop the interval.
      let polls = 0;
      intervalHandle = setInterval(async () => {
        polls += 1;
        const r = await refresh();
        if (cancelled || r.cacheWarm || polls >= 20) {
          if (intervalHandle !== null) {
            clearInterval(intervalHandle);
            intervalHandle = null;
          }
        }
      }, 3000);
    })();

    return () => {
      cancelled = true;
      if (intervalHandle !== null) clearInterval(intervalHandle);
    };
  }, []);

  // Compact relative-time formatter for the status panel —
  // "2 min ago", "3 hr ago", "5 days ago" — keeps the row width tight.
  const formatAgo = (ms: number): string => {
    if (!ms) return '—';
    const diff = Date.now() - ms;
    if (diff < 0) return loc.cypherbox.strike.ark_settings.just_now;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return loc.cypherbox.strike.ark_settings.just_now;
    if (mins < 60) return String(loc.formatString(loc.cypherbox.strike.ark_settings.mins_ago, { mins }));
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return String(loc.formatString(loc.cypherbox.strike.ark_settings.hrs_ago, { hrs }));
    const days = Math.floor(hrs / 24);
    if (days < 30) return String(loc.formatString((days === 1 ? loc.cypherbox.strike.ark_settings.days_ago_one : loc.cypherbox.strike.ark_settings.days_ago_other), { days }));
    return new Date(ms).toLocaleDateString();
  };

  const formatSize = (bytes: number): string => {
    if (!bytes || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1_048_576).toFixed(2)} MB`;
  };

  const [driveBusy, setDriveBusy] = useState(false);
  const [manualExportBusy, setManualExportBusy] = useState(false);

  // Refresh Drive status after connect/disconnect — keeps the panel
  // honest without forcing the user to reopen the screen.
  const refreshDriveStatus = async () => {
    setDriveBackup(null);
    setDriveError(null);
    try {
      const connected = await isGoogleDriveConnected();
      setDriveConnected(connected);
      if (connected) {
        const info = await getDriveBackupInfo();
        setDriveBackup(info ?? undefined);
      } else {
        setDriveBackup(undefined);
      }
    } catch (e: any) {
      setDriveConnected(false);
      setDriveError(e?.message || loc.cypherbox.strike.ark_settings.drive_unreachable);
    }
  };

  const handleDriveConnect = async () => {
    if (driveBusy) return;
    setDriveBusy(true);
    setDriveError(null);
    try {
      const ok = await connectGoogleDrive();
      if (!ok) {
        SimpleToast.show(loc.cypherbox.strike.ark_settings.drive_signin_cancelled, SimpleToast.SHORT);
      } else {
        SimpleToast.show(loc.cypherbox.strike.ark_settings.drive_connected, SimpleToast.SHORT);
      }
    } catch (e: any) {
      // Surface the real Google Sign-In error code so a misconfigured
      // OAuth client / missing Play Services / SHA-1 mismatch shows
      // up as a usable message instead of silent failure. Common codes:
      //   DEVELOPER_ERROR — wrong webClientId or SHA-1 not registered
      //   PLAY_SERVICES_NOT_AVAILABLE — emulator without GMS
      //   SIGN_IN_REQUIRED — user signed out mid-flow
      const code = e?.code ? ` [${e.code}]` : '';
      const msg = e?.message || loc.cypherbox.strike.ark_settings.drive_connect_failed;
      setDriveError(`${msg}${code}`);
      SimpleToast.show(String(loc.formatString(loc.cypherbox.strike.ark_settings.drive_connect_failed_detail, { code, msg })), SimpleToast.LONG);
    } finally {
      setDriveBusy(false);
      await refreshDriveStatus();
    }
  };

  const handleDriveDisconnect = async () => {
    if (driveBusy) return;
    Alert.alert(
      loc.cypherbox.strike.ark_settings.drive_disconnect_title,
      loc.cypherbox.strike.ark_settings.drive_disconnect_message,
      [
        { text: loc._.cancel, style: 'cancel' },
        {
          text: loc.cypherbox.strike.ark_settings.disconnect,
          style: 'destructive',
          onPress: async () => {
            setDriveBusy(true);
            try {
              await disconnectGoogleDrive();
            } catch (e: any) {
              SimpleToast.show(String(loc.formatString(loc.cypherbox.strike.ark_settings.disconnect_failed, { error: e?.message || loc.cypherbox.strike.ark_settings.unknown_error })), SimpleToast.SHORT);
            } finally {
              setDriveBusy(false);
              await refreshDriveStatus();
            }
          },
        },
      ],
    );
  };

  // iOS hint — opens iOS Settings so the user can enable iCloud Drive
  // for Cypher Box. There's no in-app "connect" because the local
  // Documents file IS the iCloud-synced copy when Drive sync is on.
  const handleICloudHint = () => {
    Alert.alert(
      loc.cypherbox.strike.ark_settings.icloud_enable_title,
      loc.cypherbox.strike.ark_settings.icloud_enable_message,
      [
        { text: loc._.cancel, style: 'cancel' },
        { text: loc.cypherbox.strike.ark_settings.open_settings, onPress: () => Linking.openSettings().catch(() => {}) },
      ],
    );
  };

  /**
   * Dismiss the iOS backup reminder, with self-validation. We probe
   * `URLForUbiquityContainerIdentifier` natively before flipping the flag —
   * if the OS returns a container URL, iCloud Drive is genuinely on for
   * Cypher Box and the auto-tick will start writing to it (or already is).
   * If it returns nil the user's claim is wrong (or they haven't enabled
   * the per-app toggle yet), and we send them to Settings instead of
   * silently dismissing into a snapshot-only state.
   */
  const handleDismissBackupReminder = async () => {
    const available = await isICloudBackupAvailable();
    if (available) {
      setArkIosBackupReminderActive(false);
      SimpleToast.show(loc.cypherbox.strike.ark_settings.icloud_verified, SimpleToast.LONG);
      return;
    }
    Alert.alert(
      loc.cypherbox.strike.ark_settings.icloud_not_on_title,
      loc.cypherbox.strike.ark_settings.icloud_not_on_message,
      [
        { text: loc._.cancel, style: 'cancel' },
        { text: loc.cypherbox.strike.ark_settings.open_settings, onPress: () => Linking.openSettings().catch(() => {}) },
      ],
    );
  };

  /**
   * One-shot manual export of the encrypted .cbark to the system share
   * sheet. Used to:
   *   - Send a snapshot to a different cloud (different Google account,
   *     OneDrive, email-to-self) for users who want a redundant copy
   *     beyond the auto-updating Drive + SAF channels.
   *   - On iOS, hand the file to "Save to Files" → user-chosen iCloud
   *     Drive subfolder when they want a non-app-Documents location.
   *
   * Lives in Settings rather than the create flow because it's
   * inherently a snapshot — doesn't auto-update with VTXO changes —
   * and shouldn't satisfy the wallet-create gate. The Continue gate
   * only counts auto-updating channels (Drive, SAF folder, iOS
   * Documents-via-iCloud). The previous version exposed this in the
   * create flow as a third gate-satisfying option; removed because it
   * encouraged users to save a stale snapshot and proceed thinking
   * they had recoverable backup, when in fact subsequent receives
   * wouldn't be in the file.
   */
  const handleManualExport = async () => {
    if (manualExportBusy) return;
    setManualExportBusy(true);
    try {
      const mnemonic = await readArkSeedPhrase();
      if (!mnemonic) {
        SimpleToast.show(loc.cypherbox.strike.ark_settings.no_seed_or_auth_declined, SimpleToast.SHORT);
        return;
      }
      const file = await writeArkBackupToTempFile(mnemonic);
      try {
        await Share.open({
          url: Platform.OS === 'android' ? `file://${file.path}` : file.path,
          type: 'application/octet-stream',
          filename: 'ark-backup.cbark',
          failOnCancel: false,
        });
      } catch (shareErr: any) {
        // react-native-share throws on cancel even with failOnCancel:false
        // on some platforms — silent.
        if (__DEV__) console.log('[Ark/manual-export] share returned:', shareErr?.message ?? shareErr);
      }
    } catch (err: any) {
      console.warn('[Ark/manual-export] failed:', err);
      SimpleToast.show(String(loc.formatString(loc.cypherbox.strike.ark_settings.backup_prepare_failed, { error: err?.message ?? loc.cypherbox.strike.ark_settings.unknown_error })), SimpleToast.LONG);
    } finally {
      setManualExportBusy(false);
    }
  };

  const handleReveal = async () => {
    if (revealing) return;
    setRevealing(true);
    try {
      const mnemonic = await readArkSeedPhrase();
      if (!mnemonic) {
        // Two cases: no Keychain entry (user skipped backup), or user
        // cancelled the biometric prompt. We can't distinguish them
        // from the helper's null return, so the toast is generic.
        SimpleToast.show(
          loc.cypherbox.strike.ark_settings.no_seed_or_auth_declined,
          SimpleToast.SHORT,
        );
        return;
      }
      const split = mnemonic.trim().split(/\s+/).filter(Boolean);
      setWords(split);
    } finally {
      setRevealing(false);
    }
  };

  const handleHide = () => setWords(null);

  /**
   * Emergency-exit: unilateral withdrawal from Ark to a destination of the
   * user's choosing, with NO ASP cooperation required. Use when the user
   * believes the ASP is down, malicious, or blocking their pubkey — every
   * cooperative path (refresh, send, swap-via-Lightning) goes through the
   * ASP, so this is the only path that survives an adversarial server.
   *
   * Three-phase by Ark protocol design (see services/ark/exit.ts docblock):
   *   1. Start: broadcast pre-signed exit txs → CSV-locked on-chain output
   *   2. Wait: vtxoExitDelta blocks (~24h on mainnet) — protocol-enforced
   *   3. Drain: sweep claimable outputs to user's chosen Bitcoin address
   *
   * Phases 2 + 3 run automatically in useArkSync; user only acts here for
   * phase 1. After phase 3 completes, useArkSync retires the exit flags and
   * KEEPS the vault (auto-delete was removed: an exit empties a wallet, it
   * doesn't end it, and funds can arrive mid-exit).
   */
  type ExitPickerStep = 'category' | 'hot-addr' | 'cold-addr' | 'external';
  const [exitPickerOpen, setExitPickerOpen] = useState(false);
  const [pickerStep, setPickerStep] = useState<ExitPickerStep>('category');
  const [hotAddrs, setHotAddrs] = useState<string[]>([]);
  const [coldAddrs, setColdAddrs] = useState<string[]>([]);
  const [selectedAddr, setSelectedAddr] = useState<string | null>(null);
  // While in 'hot-addr' / 'cold-addr', `addrListOpen=false` shows the QR
  // for `selectedAddr` (default-flow); flipping to `true` reveals the
  // scrollable list. Mirrors the receive-popup pattern in
  // [ReceivedListNew/index.tsx:494] (QR + "View All Addresses" button).
  const [addrListOpen, setAddrListOpen] = useState(false);
  const [hardwareVerified, setHardwareVerified] = useState(false);
  const [externalAddrInput, setExternalAddrInput] = useState('');
  const [exitStarting, setExitStarting] = useState(false);
  const [pendingExitSats, setPendingExitSats] = useState<number | null>(null);
  // Which phase the exit is in, derived from the SAME poll that produces the
  // sats total. The panel used to print one sentence for the entire two-day
  // run, so a stalled exit and a working one looked identical.
  const [exitPhase, setExitPhase] = useState<ExitPhaseSummary | null>(null);

  // --- Exit-fee funding gate ---
  //
  // The unilateral exit pays its on-chain CPFP fees from a SEPARATE bark
  // on-chain (BDK) wallet that a Lightning-only user never funds (holds 0
  // sats), so an unfunded exit silently stalls. We recommend an on-chain
  // reserve sized from the VTXOs' own exit weights (computeExitFeeReserveSats)
  // and gate Emergency Exit until the on-chain balance
  // (arkBalanceDetail.onchainBoardingSats, refreshed each sync tick) meets it.
  // `null` while the first computation is in flight.
  const [recommendedReserveSats, setRecommendedReserveSats] = useState<number | null>(null);
  // Why the recommendation came out the way it did. `recommendedSats` alone
  // cannot distinguish "nothing is worth exiting at current fee rates" from
  // "your capsules could not be read", and those need opposite copy: the first
  // is a normal state for a small wallet, the second is a fault.
  const [reserveDetail, setReserveDetail] = useState<{
    vtxoCount: number;
    excludedCount: number;
    excludedSats: number;
    feeRateSatPerVb: number;
  } | null>(null);
  const [exitFundingOpen, setExitFundingOpen] = useState(false);
  // Opens on Convert, the path a user can complete with what they already
  // hold. Falls back to Receive when Convert is unavailable, see the guard
  // effect below; that is the ASP-independent path, so it is the right landing
  // place whenever the server is the problem.
  const [fundingTab, setFundingTab] = useState<'receive' | 'wallet' | 'convert'>('convert');
  const [onchainFundAddr, setOnchainFundAddr] = useState<string | null>(null);
  // ASP reachability for the CONVERT (cooperative-offboard) tab. null = probing.
  const [aspReachable, setAspReachable] = useState<boolean | null>(null);
  const [convertAmount, setConvertAmount] = useState('');
  const [convertEst, setConvertEst] = useState<ExitFeeConvertEstimate | null>(null);
  const [fundingBusy, setFundingBusy] = useState(false);
  // Editable reserve-target field (sats) in the funding modal. Lets the user
  // hold more than the recommendation (bigger fee-spike buffer) or less.
  const [reserveTargetInput, setReserveTargetInput] = useState('');

  const onchainReserveSats: number = arkBalanceDetail?.onchainBoardingSats ?? 0;
  // Reserve target: the GREATER of what the user armed and what an exit is
  // currently estimated to cost. Drives the gate, the funded state and the
  // shortfall. While recommended is still null (first compute) and nothing is
  // armed, the target is 0 so we don't gate; the button shows "checking".
  //
  // This used to be `armed > 0 ? armed : recommended`, which let a stale armed
  // figure declare the reserve funded no matter how far the estimate had moved.
  // See resolveExitReserveTarget for the device case that exposed it.
  const reserveTargetSats: number = resolveExitReserveTarget({
    armedSats: arkExitFeeReserveSats,
    recommendedSats: recommendedReserveSats,
  });
  const exitFeeGated = reserveTargetSats > 0 && onchainReserveSats < reserveTargetSats;
  /**
   * Triage priced every capsule out of an exit: each one would cost more in
   * miner fees than it holds, so the plan selects nothing and the reserve comes
   * back 0.
   *
   * This is a real state for a small wallet, not a fault, and Emergency Exit
   * must be DISABLED in it. Leaving it tappable offered a trustless escape that
   * would spend the reserve and return less than it cost, and the only honest
   * answer is that the cooperative paths are the ones still open.
   *
   * Distinguished from "nothing to exit at all" by there being exclusions: a
   * wallet with no capsules has nothing to say.
   */
  const exitNotWorthFees =
    recommendedReserveSats !== null &&
    reserveTargetSats <= 0 &&
    (reserveDetail?.excludedCount ?? 0) > 0;
  const exitFeeShortfallSats = Math.max(0, reserveTargetSats - onchainReserveSats);
  /**
   * What is actually held on-chain is below the recommendation (warn them).
   *
   * Deliberately NOT `arkExitFeeReserveSats`. That is the target the user armed
   * in the funding modal, a snapshot of one decision, and it does not move when
   * they later fund past it or when the estimate changes underneath it.
   * Comparing it here made the card contradict itself: measured on device
   * 2026-09-26 with armed 5,000, recommendation 7,596 and 20,000 actually
   * on-chain, it rendered "20 000 sats are reserved on-chain to pay Emergency
   * Exit fees" directly above "You reserved less than the recommended 7 596
   * sats", while the user held 2.6x the recommendation.
   *
   * `onchainReserveSats` is what an exit actually spends, and it is already the
   * figure `exitFeeGated` measures, so the warning and the gate now agree.
   * A stale low armed value is harmless on its own: auto-board holds back
   * `max(armed, recommended)` (see decideAutoBoard), so it cannot strand fees.
   */
  const reserveBelowRecommended =
    (recommendedReserveSats ?? 0) > 0 &&
    onchainReserveSats < (recommendedReserveSats ?? 0);

  // Reset transient picker state whenever the modal closes so the next open
  // starts from category step with no stale selection / checkbox carry-over.
  useEffect(() => {
    if (!exitPickerOpen) {
      setPickerStep('category');
      setSelectedAddr(null);
      setHardwareVerified(false);
      setAddrListOpen(false);
      setHotAddrs([]);
      setColdAddrs([]);
    }
  }, [exitPickerOpen]);

  // While exit is in progress, poll the SDK every ~10s for an updated total.
  // Cheap call (reads local SQLite), useful to show shrinking sats as
  // batches confirm + claim. Stops as soon as the flag flips back to false.
  useEffect(() => {
    if (!arkExitInProgress) {
      setPendingExitSats(null);
      setExitPhase(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        // pendingExitsTotalSats() reads 0 while exit txs are still
        // broadcasting/confirming (SDK quirk — it only counts later
        // phases), which left this panel blank mid-exit. Derive the figure
        // from the per-VTXO exit records and keep the SDK total as a
        // lower bound for whatever later phase it does count.
        //
        // Liveness goes through isActiveExit, NOT a regex on String(v.state):
        // bark 0.6.1 made `state` a tagged-enum object, so the old
        // /^(Processing|Awaiting)/ test matched "[object Object]" never,
        // activeSats was always 0, and this fell back to the exact SDK quirk
        // the code above exists to work around.
        const [vtxos, pendingTotal] = await Promise.all([
          fetchArkExitVtxos(),
          fetchPendingExitsTotalSats(),
        ]);
        const active = vtxos.filter((v) => isActiveExit(v));
        const activeSats = active.reduce((acc, v) => acc + Number(v.amountSats), 0);

        // Phase, off the SAME records. Free: `vtxos` is already in hand and
        // this adds no request, which matters because chain-source budget is
        // the exit's scarcest resource.
        //
        // A capsule is claimable, or waiting out its CSV with an exact
        // ripening height, or still broadcasting with no height yet. That last
        // group is the one the app is load-bearing for, and the one whose
        // eventual height can push the finish line out.
        const claimable = active.filter((v) => v.isClaimable);
        const awaitingHeights: number[] = [];
        let processingCount = 0;
        // Per-TRANSACTION progress inside the broadcasting phase. Capsule counts
        // alone leave the panel printing the same sentence for an hour while
        // levels are actually confirming underneath, which reads as a stall.
        // AwaitingCpfpBroadcast means its child has not gone out yet; the two
        // Awaiting*Confirmation states mean it has and we are waiting on a block.
        let txAwaitingBroadcast = 0;
        let txAwaitingConfirmation = 0;
        for (const v of active) {
          if (v.isClaimable) continue;
          const h = Number(
            (v.state as { inner?: { claimableHeight?: number } })?.inner?.claimableHeight ?? 0,
          );
          if (Number.isFinite(h) && h > 0) {
            awaitingHeights.push(h);
            continue;
          }
          processingCount += 1;
          const txs =
            (v.state as { inner?: { transactions?: { status?: { tag?: string } }[] } })
              ?.inner?.transactions ?? [];
          for (const tx of txs) {
            const tag = tx?.status?.tag;
            if (tag === 'AwaitingCpfpBroadcast') txAwaitingBroadcast += 1;
            else if (tag === 'AwaitingConfirmation' || tag === 'AwaitingInputConfirmation') {
              txAwaitingConfirmation += 1;
            }
          }
        }
        // Live tip: the exit drive polls it itself and writes it here, which is
        // what made a real countdown possible (the store's tip used to freeze
        // for the whole exit, and bark's is stamped once on entry).
        const tipHeight = useAuthStore.getState().arkChainTipHeight ?? null;

        if (!cancelled) {
          setPendingExitSats(Math.max(activeSats, pendingTotal));
          setExitPhase(
            summariseExitPhase({
              claimableCount: claimable.length,
              awaitingHeights,
              processingCount,
              txAwaitingBroadcast,
              txAwaitingConfirmation,
              tipHeight,
              blockMinutes: AVG_BLOCK_MINUTES,
            }),
          );
        }
      } catch {
        // Best-effort; the status panel falls back to "—" sats.
      }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [arkExitInProgress]);

  // Compute the recommended exit-fee reserve when the actions tab is showing
  // and no exit is in flight. computeExitFeeReserveSats runs the JS-thread-
  // blocking allVtxos() call, so it lives in an effect (off the render path),
  // keyed on the spendable balance so it re-sizes when the VTXO set changes.
  useEffect(() => {
    if (view !== 'actions' || arkExitInProgress) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await computeExitFeeReserveSats();
        if (!cancelled) {
          setRecommendedReserveSats(r.recommendedSats);
          setReserveDetail({
            vtxoCount: r.vtxoCount,
            excludedCount: r.excludedCount,
            excludedSats: r.excludedSats,
            feeRateSatPerVb: r.feeRateSatPerVb,
          });
          // Persist it: auto-board runs in the sync loop with no access to this
          // screen, and without the estimate it would hold only the armed
          // reserve and board the rest away.
          setArkExitRecommendedReserveSats(r.recommendedSats);
        }
      } catch (err) {
        // Leave any prior recommendation in place; a transient failure
        // shouldn't flip a gated wallet to ungated.
        if (__DEV__) console.warn('[Ark exit-funding] reserve compute failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, arkExitInProgress, arkBalanceDetail?.spendableSats]);

  // When the funding modal opens: fetch a fresh on-chain address (RECEIVE tab)
  // and probe ASP reachability (gates the CONVERT tab).
  useEffect(() => {
    if (!exitFundingOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const addr = await getArkOnchainAddress();
        if (!cancelled) setOnchainFundAddr(addr);
      } catch (err) {
        if (__DEV__) console.warn('[Ark exit-funding] onchain address fetch failed:', err);
      }
      try {
        const ok = await probeAspReachable();
        if (!cancelled) setAspReachable(ok);
      } catch {
        if (!cancelled) setAspReachable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exitFundingOpen]);

  // Convert is the default tab, and there are two ways it can be unusable:
  // mid-exit its button is removed entirely (so the sheet would render
  // nothing), and with the ASP unreachable its action is disabled (so the
  // sheet would render a dead form). Both fall back to Receive, which needs
  // no server.
  //
  // `aspReachable === null` means the probe is still running, and that
  // deliberately does NOT fall back: the common case is that it comes back
  // reachable, and flipping the tab away and then back would be worse than a
  // moment on the tab the user asked to land on.
  useEffect(() => {
    if (fundingTab !== 'convert') return;
    if (arkExitInProgress || aspReachable === false) setFundingTab('receive');
  }, [arkExitInProgress, aspReachable, fundingTab]);

  // Debounced fee estimate for the CONVERT tab. Skipped when the ASP is known
  // unreachable (the offboard would fail) or the amount is empty/invalid.
  useEffect(() => {
    if (!exitFundingOpen || fundingTab !== 'convert') return;
    const amt = parseInt(convertAmount, 10);
    if (!Number.isFinite(amt) || amt <= 0 || aspReachable === false) {
      setConvertEst(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const est = await estimateExitFeeConvert(amt);
        if (!cancelled) setConvertEst(est);
      } catch (err) {
        if (!cancelled) setConvertEst(null);
        if (__DEV__) console.warn('[Ark exit-funding] convert estimate failed:', err);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [exitFundingOpen, fundingTab, convertAmount, aspReachable]);

  // Open the funding flow. ARM the reserve synchronously FIRST (before any
  // address is shown or deposit can confirm), so an incoming deposit isn't
  // auto-boarded back into a VTXO before the reserve is set (sync.ts reads
  // arkExitFeeReserveSats to decide how much to keep on-chain).
  const openExitFunding = () => {
    // Seed the target from the user's current armed reserve if any, else the
    // recommendation. Arm it so incoming deposits up to the target aren't
    // auto-boarded away (sync.ts reads arkExitFeeReserveSats).
    const current = (arkExitFeeReserveSats ?? 0) > 0 ? arkExitFeeReserveSats : (recommendedReserveSats ?? 0);
    if (current > 0) setArkExitFeeReserveSats(current);
    setReserveTargetInput(current > 0 ? String(current) : '');
    // Open on Convert. `openExitFunding` resets the tab on every open, so the
    // useState initial value alone would only apply to the very first one.
    // Mid-exit it is not offered at all, so land on Receive directly rather
    // than showing Convert for a frame and letting the guard bounce it.
    setFundingTab(arkExitInProgress ? 'receive' : 'convert');
    setConvertAmount(String(Math.max(0, current - onchainReserveSats)));
    setConvertEst(null);
    setAspReachable(null);
    setOnchainFundAddr(null);
    setExitFundingOpen(true);
  };

  // Apply an edited reserve target: this is how the user holds MORE than the
  // recommendation (bigger buffer) or less. Arms arkExitFeeReserveSats so
  // auto-board keeps exactly this much on-chain and boards any surplus.
  const applyReserveTarget = () => {
    const t = parseInt(reserveTargetInput, 10);
    if (!Number.isFinite(t) || t < 0) {
      setReserveTargetInput(String(reserveTargetSats));
      return;
    }
    setArkExitFeeReserveSats(t);
    setConvertAmount(String(Math.max(0, t - onchainReserveSats)));
  };

  // Release (recover) the on-chain fee funds back to the user's Hot Vault.
  // Replaces the old Capsules "recover" banner — same recoverArkOnchainBoard
  // flow, surfaced here so the Vault tab is the single home for the on-chain
  // wallet. Un-arms the reserve on success since the funds are leaving.
  const doRecoverOnchain = async () => {
    const hotVault: any = (wallets || []).find(
      (w: any) => typeof w?.getID === 'function' && w.getID() === walletID,
    );
    if (!hotVault || typeof hotVault._getInternalAddressByIndex !== 'function') {
      Alert.alert(loc.cypherbox.strike.ark_exit.no_hot_vault_title, loc.cypherbox.strike.ark_exit.no_hot_vault_message);
      return;
    }
    let est;
    try {
      est = await estimateArkOnchainRecover(onchainReserveSats);
    } catch {
      Alert.alert(loc.cypherbox.strike.ark_exit.release_unavailable_title, loc.cypherbox.strike.ark_exit.release_unavailable_message);
      return;
    }
    if (est.confirmedSats <= 0) {
      SimpleToast.show(loc.cypherbox.strike.ark_exit.nothing_to_release_now, SimpleToast.SHORT);
      return;
    }
    if (!est.economical) {
      Alert.alert(loc.cypherbox.strike.ark_exit.too_small_to_release_title, loc.cypherbox.strike.ark_exit.too_small_to_release_message);
      return;
    }
    let destAddress: string;
    try {
      destAddress = hotVault._getInternalAddressByIndex(hotVault.getNextFreeChangeAddressIndex());
    } catch {
      Alert.alert(loc.cypherbox.strike.ark_exit.no_hot_vault_address_title, loc.cypherbox.strike.ark_exit.no_hot_vault_address_message);
      return;
    }
    if (!destAddress) {
      Alert.alert(loc.cypherbox.strike.ark_exit.no_hot_vault_address_title, loc.cypherbox.strike.ark_exit.no_hot_vault_address_message);
      return;
    }
    Alert.alert(
      loc.cypherbox.strike.ark_exit.release_title,
      String(loc.formatString(loc.cypherbox.strike.ark_exit.release_message, { sats: est.recoverableSats.toLocaleString(), fee: est.feeSats.toLocaleString() })),
      [
        { text: loc._.cancel, style: 'cancel' },
        {
          text: loc.cypherbox.strike.ark_exit.release_button,
          onPress: async () => {
            try {
              const res = await recoverArkOnchainBoard(destAddress, est.confirmedSats, est.feeRateSatPerVb);
              setArkExitFeeReserveSats(0);
              if (res.status === 'already-cleared') {
                Alert.alert(loc.cypherbox.strike.ark_exit.nothing_to_release_title, loc.cypherbox.strike.ark_exit.already_cleared);
              } else {
                Alert.alert(loc.cypherbox.strike.ark_exit.release_sent_title, String(loc.formatString(loc.cypherbox.strike.ark_exit.release_sent_message, { sats: res.sentSats.toLocaleString() })));
              }
            } catch (e: any) {
              // Same treatment as the top-up path: a dropped connection now
              // arrives as a flagged message that says it may have gone
              // through, so do not overwrite it with an "unchanged" claim.
              Alert.alert(loc.cypherbox.strike.ark_exit.release_failed_title, String(e?.message || '') || loc.cypherbox.strike.ark_exit.release_failed_message);
            }
          },
        },
      ],
    );
  };

  const doConvertToExitFees = async () => {
    const amt = parseInt(convertAmount, 10);
    if (!Number.isFinite(amt) || amt <= 0) {
      SimpleToast.show(loc.cypherbox.strike.ark_exit.enter_convert_amount, SimpleToast.SHORT);
      return;
    }
    if (aspReachable === false) {
      SimpleToast.show(loc.cypherbox.strike.ark_exit.asp_unreachable, SimpleToast.LONG);
      return;
    }
    setFundingBusy(true);
    try {
      // Re-arm defensively in case the reserve was cleared between open and now.
      const rec = recommendedReserveSats ?? 0;
      if (rec > 0) setArkExitFeeReserveSats(rec);
      await convertToExitFees(amt);
      setExitFundingOpen(false);
      SimpleToast.show(
        loc.cypherbox.strike.ark_exit.converting_toast,
        SimpleToast.LONG,
      );
    } catch (e: any) {
      // "Could not convert" is kept: the tab the user is on says "Convert from
      // balance", so it matches. What was wrong is the body. "Offboard" is
      // bark's word and appears nowhere in this UI, and "Your Ark funds are
      // unchanged" is a claim a dropped connection can falsify. The service now
      // raises a flagged indeterminate error in that case, whose message is
      // already user-facing, so the fallback below applies only to refusals.
      Alert.alert(
        loc.cypherbox.strike.ark_exit.convert_failed_title,
        String(e?.message || '') ||
          loc.cypherbox.strike.ark_exit.convert_failed_message,
      );
    } finally {
      setFundingBusy(false);
    }
  };

  /**
   * Build a list of usable receive addresses for a BlueWallet HD wallet by
   * ID. First slot is always the next-free address (the "default" — fresh,
   * unused, the same one Hot Vault → Receive would surface). Following
   * slots are the most-recently-derived `historyCount` addresses below the
   * next-free index, descending — useful when the user wants to send to
   * an address they've already shown to a counterparty (e.g. one their
   * hardware device has already validated).
   *
   * Returns empty when the wallet isn't found / can't derive — caller
   * handles the empty case in UI.
   */
  const deriveAddressList = (id: string | undefined, historyCount = 5): string[] => {
    if (!id) return [];
    const w: any = wallets?.find?.((x: any) => x?.getID?.() === id);
    if (!w) return [];
    try {
      const next = w.getNextFreeAddressIndex?.() ?? 0;
      const list: string[] = [];
      // Default (next-free) first.
      try {
        const fresh = w._getExternalAddressByIndex(next);
        if (fresh) list.push(fresh);
      } catch {
        // ignore — fall through with whatever we have
      }
      // Recent history descending: indices next-1, next-2, …
      for (let i = next - 1; i >= 0 && list.length < historyCount + 1; i--) {
        try {
          const a = w._getExternalAddressByIndex(i);
          if (a && !list.includes(a)) list.push(a);
        } catch {
          // skip
        }
      }
      return list;
    } catch {
      return [];
    }
  };

  /** Loose Bitcoin address sanity check — the SDK's drainExits will do the
   *  authoritative validation, but we fail fast on obviously-bad input so
   *  the user doesn't kick off a 24h timelock pointed at garbage.
   *  Permits mainnet bech32 (bc1...), legacy / p2sh (1.../3...), testnet
   *  bech32 (tb1...) for future signet/testnet builds. Length sanity only —
   *  not a checksum check. */
  const looksLikeBitcoinAddress = (s: string): boolean => {
    const t = s.trim();
    if (t.length < 14 || t.length > 100) return false;
    return /^(bc1|tb1|bcrt1|[13]|[mn2])[a-zA-Z0-9]+$/.test(t);
  };

  /**
   * `economicPolicy` is how far past the economics the user has agreed to go.
   * It only ever moves off the default by the user tapping through the
   * override prompt below, which states the loss in sats first. Never raise it
   * silently: the whole point of spec principle 4 is that overspending is a
   * choice, and a choice nobody was offered is not one.
   */
  const startExitWithAddress = async (
    destLabel: string,
    address: string,
    economicPolicy: ExitEconomicPolicy = 'default',
  ) => {
    setExitPickerOpen(false);
    setExitStarting(true);
    // Triage NOW, not at screen mount: fee rates and the chain tip both move
    // between mount and this tap, and both change which capsules are worth
    // exiting. The plan decides the exit set AND sizes the reserve over that
    // set, so the shortfall quoted below is for the capsules actually being
    // exited rather than for every capsule in the wallet.
    let plan: ExitTriageResult | null = null;
    let freshRecommended = recommendedReserveSats ?? 0;
    try {
      plan = await computeArkExitPlan({ economicPolicy });
      if (plan) {
        freshRecommended = plan.reserveSats;
        setRecommendedReserveSats(plan.reserveSats);
      }
    } catch {
      // Keep the last computed recommendation on a transient failure.
    }

    // The capsule read failed, so there is no exit set to hand the SDK. Say
    // that, rather than letting startArkEmergencyExit reject an empty list with
    // copy that would read as "you have nothing worth exiting".
    if (!plan) {
      setExitStarting(false);
      Alert.alert(
        loc.cypherbox.strike.ark_exit.emergency_exit,
        loc.cypherbox.strike.ark_exit.read_capsules_failed,
      );
      return;
    }

    // What the plan could NOT verify. Built here, above every branch below,
    // because all three of them mislead when it is non-empty, and the branch
    // that misleads WORST is the one that reports nothing is recoverable: the
    // fallback bands price at 10 sat/vB, which condemns a small wallet on a fee
    // rate the app invented while unable to reach any fee source.
    //
    // The temporal axis is a hard exclusion when it can run: an exit that does
    // not clear its CSV before expiry loses the capsule AND the reserve spent
    // chasing it. Without a usable tip it cannot run, and triage deliberately
    // includes rather than excludes, because refusing to exit on a failed tip
    // read would disarm the emergency button for a network fault. That trade is
    // only honest if the user is told, and until now they were not: the note
    // was computed on every entry and rendered nowhere.
    const buildUnverifiedNotice = (p: ExitTriageResult): string => {
      const lines: string[] = [];
      if (p.runwayUnverifiedCount > 0) {
        lines.push(
          p.runwayUnverifiedCount === p.selected.length ? loc.cypherbox.strike.ark_exit.unverified_runway_all : String(loc.formatString(loc.cypherbox.strike.ark_exit.unverified_runway_some, { count: p.runwayUnverifiedCount })),
        );
      } else if (p.tipUnavailable) {
        lines.push(
          loc.cypherbox.strike.ark_exit.unverified_tip,
        );
      }
      if (p.feeRatesEstimated) {
        lines.push(
          loc.cypherbox.strike.ark_exit.unverified_fees,
        );
      }
      if (p.usedAssumedExitDelta) {
        lines.push(loc.cypherbox.strike.ark_exit.unverified_delta);
      }
      if (lines.length === 0) return '';
      return (
        loc.cypherbox.strike.ark_exit.unverified_header + '\n\n' +
        lines.map((l) => `  ${l}`).join('\n\n') +
        '\n\n' + loc.cypherbox.strike.ark_exit.unverified_footer + '\n\n'
      );
    };
    const unverifiedNotice = buildUnverifiedNotice(plan);

    // The override, offered only where it would change something. Re-planning
    // with 'recover-everything' is what actually applies it, so the figures in
    // the confirm dialog afterwards are the forced ones, not these.
    const forcePrompt = (bodyPrefix: string) => {
      setExitStarting(false);
      // Split the cost clause by WHY these capsules are overridable. A
      // 'fees-dwarf-value' capsule genuinely costs more to exit than it holds; a
      // 'refresh-before-exiting' one is economically fine and merely close to
      // expiry, so claiming a loss there would be false.
      const overridableEntries = plan!.excluded.filter(
        (e) => e.reason === 'fees-dwarf-value' || e.reason === 'refresh-before-exiting',
      );
      const anyLoss = overridableEntries.some((e) => e.reason === 'fees-dwarf-value');
      const anyStale = overridableEntries.some((e) => e.reason === 'refresh-before-exiting');
      // COPY: Bam finalizes.
      const costClause =
        anyLoss && anyStale
          ? loc.cypherbox.strike.ark_exit.cost_clause_mixed
          : anyLoss
            ? loc.cypherbox.strike.ark_exit.cost_clause_loss
            : loc.cypherbox.strike.ark_exit.cost_clause_stale;
      Alert.alert(
        loc.cypherbox.strike.ark_exit.emergency_exit,
        unverifiedNotice +
          bodyPrefix +
          '\n\n' + (plan!.overridableCount === 1 ? loc.cypherbox.strike.ark_exit.exit_anyway_offer_one : loc.cypherbox.strike.ark_exit.exit_anyway_offer_other) + ' ' +
          costClause,
        [
          { text: loc._.cancel, style: 'cancel' },
          {
            text: loc.cypherbox.strike.ark_exit.exit_anyway,
            style: 'destructive',
            onPress: () => {
              void startExitWithAddress(destLabel, address, 'recover-everything');
            },
          },
        ],
      );
    };

    // Nothing survived triage. Say why rather than starting an exit that would
    // spend the reserve and return nothing.
    if (plan.selectedIds.length === 0) {
      const list = plan.excluded
        .map((e) => `  ${loc.formatString(loc.cypherbox.strike.ark_exit.capsule_reason_row, { sats: e.sats.toLocaleString(), reason: describeExitExclusion(e.reason) })}`)
        .join('\n');
      if (plan.excluded.length === 0) {
        setExitStarting(false);
        Alert.alert(loc.cypherbox.strike.ark_exit.emergency_exit, loc.cypherbox.strike.ark_exit.no_capsules_to_exit);
        return;
      }
      if (plan.overridableCount === plan.excluded.length) {
        forcePrompt(
          String(loc.formatString((plan.excluded.length === 1 ? loc.cypherbox.strike.ark_exit.none_recoverable_one : loc.cypherbox.strike.ark_exit.none_recoverable_other), { count: plan.excluded.length })) +
            `\n${list}`,
        );
        return;
      }
      setExitStarting(false);
      Alert.alert(
        loc.cypherbox.strike.ark_exit.emergency_exit,
        unverifiedNotice +
          String(loc.formatString((plan.excluded.length === 1 ? loc.cypherbox.strike.ark_exit.none_recoverable_one : loc.cypherbox.strike.ark_exit.none_recoverable_other), { count: plan.excluded.length })) + '\n\n' +
          list +
          '\n\n' + loc.cypherbox.strike.ark_exit.stay_spendable,
      );
      return;
    }

    // Narrowed alias: `plan` is a let, so the null checks above do not survive
    // into the Alert's onPress closure.
    const exitPlan = plan;

    // Principle: never silently abandon funds. Every capsule left behind is
    // named, with its amount and the reason, BEFORE the user commits.
    const exclusionNotice =
      plan.excluded.length > 0
        ? String(loc.formatString((plan.excluded.length === 1 ? loc.cypherbox.strike.ark_exit.exclusion_header_one : loc.cypherbox.strike.ark_exit.exclusion_header_other), { count: plan.excluded.length, sats: plan.excludedSats.toLocaleString() })) + '\n' +
          plan.excluded
            .map(
              (e) =>
                `  ${loc.formatString(loc.cypherbox.strike.ark_exit.capsule_reason_row, { sats: e.sats.toLocaleString(), reason: describeExitExclusion(e.reason) })}`,
            )
            .join('\n') +
          '\n\n' + loc.cypherbox.strike.ark_exit.exclusion_footer + '\n\n'
        : '';

    // Principle: never silently spend more than the funds are worth. The
    // reserve sits next to what comes back, so a reserve larger than the value
    // is impossible to miss.
    // Every selected capsule, named, so the user can see what the totals are
    // made of. Listed only when there is more than one: with a single capsule
    // the row would just restate the line above it. Capped, with the remainder
    // counted rather than dropped silently.
    const CAPSULE_LIST_MAX = 6;
    const capsuleNotice =
      plan.selected.length > 1
        ? loc.cypherbox.strike.ark_exit.capsules_being_exited + '\n' +
          plan.selected
            .slice(0, CAPSULE_LIST_MAX)
            .map(
              (e) =>
                `  ${loc.formatString(loc.cypherbox.strike.ark_exit.capsule_exit_row, {
                  sats: e.sats.toLocaleString(),
                  net: e.netRecoveredSats.toLocaleString(),
                  collect: formatExitCollectWait(e.requiredRunwayBlocks),
                  expires: e.blocksUntilExpiry != null ? formatBlocksUntil(e.blocksUntilExpiry) : loc.cypherbox.strike.ark_exit.expires_unknown,
                })}`,
            )
            .join('\n') +
          (plan.selected.length > CAPSULE_LIST_MAX
            ? `\n  ${loc.formatString(loc.cypherbox.strike.ark_exit.and_more, { count: plan.selected.length - CAPSULE_LIST_MAX })}`
            : '') +
          '\n\n'
        : '';

    // Three DIFFERENT numbers, kept apart on purpose.
    //
    // What reaches you, what the fees are expected to cost, and what you must
    // have available. The reserve is not a cost: it carries spike headroom and
    // a 5,000 sat floor, and whatever is not spent stays in the on-chain
    // wallet. Pricing the loss against the reserve told a user exiting one 971
    // sat capsule that it cost 4,105 sats more than it was worth, when the
    // expected spend was about 632 against 895 recovered.
    const costNotice =
      String(loc.formatString((plan.selected.length === 1 ? loc.cypherbox.strike.ark_exit.cost_summary_one : loc.cypherbox.strike.ark_exit.cost_summary_other), { count: plan.selected.length, sats: plan.selectedSats.toLocaleString(), net: plan.netRecoverableSats.toLocaleString() })) + '\n\n' +
      String(loc.formatString(loc.cypherbox.strike.ark_exit.cost_fees, { spend: plan.expectedSpendSats.toLocaleString(), reserve: plan.reserveSats.toLocaleString() })) + '\n\n' +
      // The loss, in sats, whenever the exit spends more than it returns. This
      // is the sentence that makes an overridden exit a choice rather than a
      // surprise, so it is not conditional on how the policy got here.
      (plan.netLossSats > 0
        ? String(loc.formatString(loc.cypherbox.strike.ark_exit.net_loss, { loss: plan.netLossSats.toLocaleString() })) + '\n\n'
        : '');

    const shortfall = Math.max(0, freshRecommended - onchainReserveSats);
    const underfunded = freshRecommended > 0 && shortfall > 0;
    const underfundedPrefix = underfunded
      ? String(loc.formatString(loc.cypherbox.strike.ark_exit.underfunded, { held: onchainReserveSats.toLocaleString(), needed: freshRecommended.toLocaleString(), shortfall: shortfall.toLocaleString() })) + '\n\n'
      : '';
    try {
      Alert.alert(
        loc.cypherbox.strike.ark_exit.emergency_exit,
        unverifiedNotice +
          exclusionNotice +
          capsuleNotice +
          costNotice +
          underfundedPrefix +
          String(loc.formatString(loc.cypherbox.strike.ark_exit.exit_forces, { dest: destLabel, wait: formatExitCollectWait(exitPlan.collectableInBlocks) })) + '\n\n' +
          loc.cypherbox.strike.ark_exit.exit_one_day + '\n\n' +
          `${address}\n\n` +
          // The wait does NOT run itself. The drive is foreground-only, so the
          // claim fires when the user next opens the app. Saying otherwise was
          // untrue for most of the 44 hours the 2026-08-22 exit ran.
          String(loc.formatString(loc.cypherbox.strike.ark_exit.exit_come_back, { wait: formatExitCollectWait(exitPlan.collectableInBlocks) })),
        [
          {
            text: loc._.cancel,
            style: 'cancel',
            onPress: () => setExitStarting(false),
          },
          // Partial case: some capsules are worth exiting and some are being
          // left behind on cost alone. Naming them without offering the choice
          // would satisfy principle 3 and quietly ignore principle 4.
          ...(plan.overridableCount > 0
            ? [
                {
                  text: String(loc.formatString(loc.cypherbox.strike.ark_exit.include_all, { count: (plan.selected.length + plan.overridableCount) })),
                  style: 'destructive' as const,
                  onPress: () => {
                    void startExitWithAddress(destLabel, address, 'recover-everything');
                  },
                },
              ]
            : []),
          {
            text: loc.cypherbox.strike.ark_exit.start_exit,
            style: 'destructive',
            onPress: async () => {
              try {
                await startArkEmergencyExit(exitPlan.selectedIds);
                // Persist what the reserve was priced against, so the drive can
                // re-derive its bid each tick as the runway shrinks.
                setArkExitFeeDeadlineHeight(getLastExitFeeDeadlineHeight());
                setArkExitDestinationAddress(address);
                setArkExitStartedAt(Date.now());
                // Fresh exit: clear any stale "drained" flag from a prior exit
                // so the completion gate (useArkSync) starts clean.
                setArkExitDrained(false);
                // Snapshot the amount being exited (pre-exit spendable
                // balance). The SDK's pending counter reads 0 while the exit
                // txs broadcast and any live read needs an open handle, so
                // this persisted figure is what the status panel falls back
                // to across reloads.
                // The exit set, not the wallet: triage may have left capsules
                // behind, and quoting the whole spendable balance here would
                // report a total the exit can never deliver.
                const startedSats = exitPlan.selectedSats;
                setArkExitStartedSats(startedSats > 0 ? startedSats : null);
                setArkExitInProgress(true);
                // Activity log: read pending sats fresh — the exit just
                // moved every spendable VTXO into pending-exit state, so
                // pendingExitsTotalSats is the right "amount being
                // exited" number. correlationId persists across sync
                // cycles + app restarts so the auto-claim path in
                // useArkSync can match the started/finished pair.
                const correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
                await setArkExitCorrelationId(correlationId);
                // Use the pre-exit spendable snapshot: pendingExitsTotalSats
                // reads 0 while the exit txs are still broadcasting (SDK
                // quirk — see useArkSync exit block), which recorded every
                // exit as "0 sats" in the activity log.
                recordEvent({
                  kind: 'ark-exit-started',
                  sats: startedSats,
                  correlationId,
                });
                SimpleToast.show(
                  loc.cypherbox.strike.ark_exit.exit_started,
                  SimpleToast.LONG,
                );
              } catch (err: any) {
                console.warn('[Ark exit] start failed:', 'tag=', err?.tag, 'inner=', err?.inner?.errorMessage ?? err?.inner?.message, 'message=', err?.message ?? String(err));
                SimpleToast.show(
                  describeArkFailure(err, loc.cypherbox.strike.ark_exit.couldnt_start_exit, { chainUrls: ESPLORA_URLS, arkUrl: ARK_SERVER_URL }),
                  SimpleToast.LONG,
                );
              } finally {
                setExitStarting(false);
              }
            },
          },
        ],
      );
    } catch (err) {
      setExitStarting(false);
    }
  };

  const enterHotAddrStep = () => {
    if (!walletID) {
      SimpleToast.show(loc.cypherbox.strike.ark_exit.no_hot_vault_connected, SimpleToast.SHORT);
      return;
    }
    const list = deriveAddressList(walletID);
    if (list.length === 0) {
      SimpleToast.show(loc.cypherbox.strike.ark_exit.no_hot_vault_addresses, SimpleToast.LONG);
      return;
    }
    setHotAddrs(list);
    setSelectedAddr(list[0]);
    setAddrListOpen(false);
    setPickerStep('hot-addr');
  };

  const enterColdAddrStep = () => {
    if (!coldStorageWalletID) {
      SimpleToast.show(loc.cypherbox.strike.ark_exit.no_cold_wallet_connected, SimpleToast.SHORT);
      return;
    }
    const list = deriveAddressList(coldStorageWalletID);
    if (list.length === 0) {
      SimpleToast.show(loc.cypherbox.strike.ark_exit.no_cold_addresses, SimpleToast.LONG);
      return;
    }
    setColdAddrs(list);
    setSelectedAddr(list[0]);
    setHardwareVerified(false);
    setAddrListOpen(false);
    setPickerStep('cold-addr');
  };

  const confirmHotAddr = () => {
    if (!selectedAddr) return;
    void startExitWithAddress(loc.cypherbox.strike.ark_exit.dest_hot_vault, selectedAddr);
  };

  const confirmColdAddr = () => {
    if (!selectedAddr) return;
    if (!hardwareVerified) {
      SimpleToast.show("Confirm you've checked the address on your signing device first.", SimpleToast.LONG);
      return;
    }
    void startExitWithAddress(loc.cypherbox.strike.ark_exit.dest_cold_vault, selectedAddr);
  };

  const handlePickExternal = () => {
    const t = externalAddrInput.trim();
    if (!looksLikeBitcoinAddress(t)) {
      SimpleToast.show(loc.cypherbox.strike.ark_exit.invalid_address, SimpleToast.SHORT);
      return;
    }
    void startExitWithAddress(loc.cypherbox.strike.ark_exit.dest_external, t);
  };

  /**
   * Destructive: nukes the Ark vault from this device.
   *
   *   - Wipes the local datadir (VTXOs, presigned exit txs, round state)
   *   - Optionally wipes the seed from Keychain (controlled by the
   *     "keep seedphrase on device" checkbox in the confirm modal)
   *   - Clears the in-memory wallet handle
   *   - Clears zustand auth state
   *
   * If the seed is kept, a future Recover flow can surface the biometric
   * (Face/Touch ID) fast path so the user doesn't have to type 12 words
   * to come back. If unchecked, the user MUST have their 12-word phrase
   * to recover (and a `.cbark` backup file to restore funds — VTXOs are
   * never seed-derivable).
   */
  const [deleting, setDeleting] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  /** True when an Emergency Exit is mid-flight as the delete dialog opens. */
  const [exitInFlight, setExitInFlight] = useState(false);
  const [keepSeedOnDevice, setKeepSeedOnDevice] = useState(true);

  const biometricLabel = Platform.OS === 'ios' ? 'Face ID' : 'Touch ID';

  /**
   * Probe for an in-flight exit BEFORE the modal opens, so the warning is on
   * screen the first time the user sees the dialog. A warning that arrives a
   * moment later is worse than none, because by then they may already have
   * tapped through it.
   *
   * Reads the same three signals `assertNoActiveArkExitAsync` blocks on, so
   * this dialog warns on exactly the evidence that makes every other
   * fund-moving action refuse outright. Delete is the only one of them that
   * proceeds, since a verified backup is forced first and the packed datadir
   * carries the exit state, so the cost of deleting here is a stalled exit
   * rather than lost funds.
   *
   * A failed read shows NO warning rather than a false one, matching
   * `hasActiveArkExitRecords`' own posture: a read that throws is not
   * evidence of an exit.
   */
  const handleDeleteVault = async () => {
    if (deleting) return;
    setKeepSeedOnDevice(true);
    let active = false;
    try {
      const s = useAuthStore.getState();
      active =
        s.arkExitInProgress === true ||
        (s.arkVtxos ?? []).some((v) => (v as { exiting?: boolean }).exiting) ||
        (await hasActiveArkExitRecords());
    } catch {
      active = false;
    }
    setExitInFlight(active);
    setDeleteModalVisible(true);
  };

  const confirmDeleteVault = async () => {
    setDeleteModalVisible(false);
    setDeleting(true);
    try {
      // Fund-safety gate: Ark VTXO state is NOT seed-derivable, so wiping the
      // datadir without a current, verified backup is silent, permanent fund
      // loss. Force a fresh verified backup BEFORE the wipe and refuse to
      // delete if we can't produce one. reset() does not pass
      // deleteBackupFilesForFingerprint, so this .cbark survives the wipe and
      // stays a valid restore source afterward. Mirrors the wallet-create
      // policy that a user can't proceed without a verified backup.
      const mnemonic = await readArkSeedPhrase();
      if (!mnemonic) {
        SimpleToast.show(
          loc.cypherbox.strike.ark_settings.delete_seed_read_failed,
          SimpleToast.LONG,
        );
        setDeleting(false);
        return;
      }
      try {
        const verified = await writeAndVerifyArkBackup(mnemonic);
        if (!verified.local.ok) {
          SimpleToast.show(
            String(loc.formatString(loc.cypherbox.strike.ark_settings.delete_backup_write_failed, { error: verified.local.error })),
            SimpleToast.LONG,
          );
          setDeleting(false);
          return;
        }
      } catch (backupErr: any) {
        // writeAndVerifyArkBackup throws only on a fundamental pack failure
        // (e.g. empty or locked datadir). Treat as "cannot guarantee a
        // backup" and abort the delete rather than risk silent loss.
        console.warn('[Ark] pre-delete backup failed:', backupErr);
        SimpleToast.show(
          String(loc.formatString(loc.cypherbox.strike.ark_settings.delete_backup_create_failed, { error: backupErr?.message ?? loc.cypherbox.strike.ark_settings.unknown_error })),
          SimpleToast.LONG,
        );
        setDeleting(false);
        return;
      }

      await resetArkWalletState({ keepSeedInKeychain: keepSeedOnDevice });
      if (typeof clearArkAuth === 'function') {
        clearArkAuth();
      }
      SimpleToast.show(
        keepSeedOnDevice
          ? loc.cypherbox.strike.ark_settings.deleted_seed_kept
          : loc.cypherbox.strike.ark_settings.deleted,
        SimpleToast.LONG,
      );
      setTimeout(() => navigation.goBack(), 300);
    } catch (err: any) {
      console.warn('[Ark] Delete vault failed:', err);
      SimpleToast.show(
        String(loc.formatString(loc.cypherbox.strike.ark_settings.delete_failed, { error: err?.message ?? loc.cypherbox.strike.ark_settings.unknown_error })),
        SimpleToast.LONG,
      );
      setDeleting(false);
    }
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={{ paddingBottom: 40 }}>
      <RNAnimated.View style={[styles.main, { paddingHorizontal: 24 }]}>
      {view === 'backup' && (<>
        {/* Background VTXO refresh toggle + Emergency Exit + Delete Vault.
            Moved here from the Settings tab so day-to-day wallet operations
            sit next to the balance card. The Settings tab now only holds
            Seed Phrase + Ark backup file, true one-time setup. */}
        <View style={{ marginTop: 24 }}>
          <View
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: '#1a1a1a',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <RNText
                style={{
                  fontSize: 14,
                  fontWeight: '700',
                  color: colors.white,
                  flex: 1,
                  marginRight: 12,
                }}
              >
                {loc.cypherbox.strike.ark_settings.notify_before_expiry}
              </RNText>
              <Switch
                // The EFFECTIVE state, not the stored preference. A green
                // switch has to mean "a reminder will reach you".
                value={remindersEffectivelyOn}
                onValueChange={handleToggleBgRefresh}
                disabled={togglingBgRefresh}
                trackColor={{ false: '#3a3a3a', true: colors.green }}
                thumbColor={colors.white}
              />
            </View>
            <Text
              style={{
                fontSize: 12,
                color: remindersEffectivelyOn ? '#888' : colors.redLight,
                marginTop: 6,
                lineHeight: 16,
              }}
            >
              {/* Three states, because "the user wants reminders" and
                  "reminders can arrive" are different facts and only the
                  second one protects anybody. COPY: Bam finalizes. */}
              {remindersBlockedByOs
                ? loc.cypherbox.strike.ark_settings.reminders_blocked
                : remindersEffectivelyOn
                  ? loc.cypherbox.strike.ark_settings.reminders_on_desc
                  : loc.cypherbox.strike.ark_settings.reminders_off_desc}
            </Text>

          </View>

          {/* Automatic refresh. Separate card from reminders on purpose: one
              of these spends money and the other does not, and a single
              switch covering both would make "stop spending" and "stop
              warning me" the same action. COPY: Bam finalizes. */}
          <View
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: '#1a1a1a',
              marginTop: 12,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <RNText
                style={{
                  fontSize: 14,
                  fontWeight: '700',
                  color: colors.white,
                  flex: 1,
                  marginRight: 12,
                }}
              >
                {loc.cypherbox.strike.ark_settings.auto_refresh_label}
              </RNText>
              <Switch
                value={arkAutoRefreshEnabled}
                onValueChange={handleToggleAutoRefresh}
                trackColor={{ false: '#3a3a3a', true: colors.green }}
                thumbColor={colors.white}
              />
            </View>
            <Text
              style={{
                fontSize: 12,
                color: arkAutoRefreshEnabled ? '#888' : colors.redLight,
                marginTop: 6,
                lineHeight: 16,
              }}
            >
              {arkAutoRefreshEnabled
                ? loc.cypherbox.strike.ark_settings.auto_refresh_on_desc
                : loc.cypherbox.strike.ark_settings.auto_refresh_off_desc}
            </Text>
          </View>
        </View>

        <View style={{ marginTop: 24 }}>
          <Text bold style={{ fontSize: 16, color: colors.ark?.light ?? colors.pink.default, marginBottom: 8 }}>
            {loc.cypherbox.strike.ark_settings.seed_phrase_title}
          </Text>
          <View style={{ backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14 }}>
            {/* Two-line description split intentionally across two
                <Text> blocks: the first explains the seed's role and
                stays in muted gray; the second is the critical "you
                ALSO need the Ark backup file" warning, in red, so the
                user can't read the first sentence and assume the seed
                alone suffices. The previous "12 words are the only
                way you can recover" copy was wrong — Bark VTXOs are
                not seed-derivable, the .cbark backup file is also
                required and equally critical. */}
            <Text style={{ fontSize: 13, color: '#AAA', marginBottom: 6 }}>
              {loc.cypherbox.strike.ark_settings.seed_write_down}
            </Text>
            <Text bold style={{ fontSize: 13, color: '#FF7A68', marginBottom: 12 }}>
              {loc.cypherbox.strike.ark_settings.seed_keep_backup_file}
            </Text>
            {words ? (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                  {words.map((word, i) => (
                    <View
                      key={`${i}-${word}`}
                      style={{
                        width: '31%',
                        backgroundColor: '#2A2A2A',
                        borderRadius: 8,
                        paddingVertical: 8,
                        paddingHorizontal: 8,
                        marginBottom: 8,
                      }}
                    >
                      {/* RNText (built-in) here, not the @Cypher Text
                          wrapper: the wrapper hardcodes
                          adjustsFontSizeToFit, which under Fabric (RN
                          0.76 New Arch) shrinks longer BIP-39 words to
                          fit the 31%-wide cell. The numeric prefix
                          (1. → 12.) varies cell-to-cell, so a single
                          long word in one row would silently drag the
                          whole grid into a smaller font. Built-in
                          Text honors fontSize literally. */}
                      <RNText style={{ fontSize: 14, color: '#FFF', textAlign: 'center' }}>
                        {`${i + 1}. ${word}`}
                      </RNText>
                    </View>
                  ))}
                </View>
                <TouchableOpacity
                  onPress={handleHide}
                  style={{ marginTop: 8, alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: '#444' }}
                >
                  <Text bold style={{ fontSize: 13, color: '#AAA' }}>{loc.cypherbox.strike.ark_settings.hide}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                onPress={handleReveal}
                disabled={revealing}
                style={{
                  marginTop: 6,
                  paddingVertical: 12,
                  borderRadius: 10,
                  backgroundColor: revealing ? '#333' : (colors.ark?.light ?? colors.pink.default),
                  alignItems: 'center',
                }}
              >
                {revealing ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text bold style={{ fontSize: 15, color: '#000' }}>{loc.cypherbox.strike.ark_settings.show_seed_phrase}</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Backup status — shows whether the on-device auto-backup
            (.cbark in Documents) and the optional Google Drive copy are
            both up to date. The user can verify both rails without
            digging into a file manager or the Drive web UI. */}
        <View style={{ marginTop: 24 }}>
          <Text bold style={{ fontSize: 16, color: colors.ark?.light ?? colors.pink.default, marginBottom: 8 }}>
            {loc.cypherbox.strike.ark_settings.backup_file_title}
          </Text>

          {/* iOS backup-snapshot reminder. Active whenever the user
              satisfied the create-flow gate via manual share+confirm
              (the only honest iOS path — see ArkSeedPhraseScreen.iOS
              branch). Stays visible on every visit to this screen until
              iCloud Drive becomes available for Cypher Box, at which
              point the auto-tick has a verifiable off-device channel
              and the reminder auto-clears (see useArkSync's iCloud probe
              effect). Three inline actions:
                - Re-export now: writes a fresh snapshot via the share
                  sheet. The action that used to live as a separate
                  "Manual export" row in the Ark Backup card; moved
                  inline here because it's only meaningful while this
                  reminder is active.
                - How to enable iCloud Drive: opens the iCloud-hint
                  alert (links into iOS Settings).
                - iCloud Drive is on, dismiss: auto-validates via the
                  ubiquity probe before flipping the flag off, so a
                  user who taps it without actually enabling iCloud
                  Drive is sent back to Settings rather than silently
                  ending up in a snapshot-only state. */}
          {Platform.OS === 'ios' && arkIosBackupReminderActive && (
            <View
              style={{
                marginBottom: 12,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: 'rgba(251, 146, 60, 0.10)',
                borderWidth: 1,
                borderColor: 'rgba(251, 146, 60, 0.40)',
              }}
            >
              <Text bold style={{ fontSize: 14, color: '#FB923C', marginBottom: 4 }}>
                {loc.cypherbox.strike.ark_settings.reexport_title}
              </Text>
              <Text style={{ fontSize: 12, color: colors.white, lineHeight: 17 }}>
                {loc.cypherbox.strike.ark_settings.reexport_body}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                <TouchableOpacity
                  onPress={handleManualExport}
                  disabled={manualExportBusy}
                  activeOpacity={0.7}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: '#0F0F0F',
                    borderWidth: 1,
                    borderColor: 'rgba(251, 146, 60, 0.55)',
                    marginRight: 8,
                    marginBottom: 6,
                    opacity: manualExportBusy ? 0.5 : 1,
                  }}
                >
                  {manualExportBusy ? (
                    <ActivityIndicator size="small" color="#FB923C" />
                  ) : (
                    <Text bold style={{ fontSize: 12, color: '#FB923C' }}>
                      {loc.cypherbox.strike.ark_settings.reexport_now}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleICloudHint}
                  activeOpacity={0.7}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: '#0F0F0F',
                    borderWidth: 1,
                    borderColor: '#444',
                    marginRight: 8,
                    marginBottom: 6,
                  }}
                >
                  <Text bold style={{ fontSize: 12, color: '#AAA' }}>
                    {loc.cypherbox.strike.ark_settings.how_to_enable_icloud}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDismissBackupReminder}
                  activeOpacity={0.7}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: '#0F0F0F',
                    borderWidth: 1,
                    borderColor: 'rgba(74, 222, 128, 0.5)',
                    marginBottom: 6,
                  }}
                >
                  <Text bold style={{ fontSize: 12, color: '#4ADE80' }}>
                    {loc.cypherbox.strike.ark_settings.icloud_on_dismiss}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {/* Mirror of the red warning under the Seed Phrase section: a
              user reading only this card and seeing a fresh backup file
              shouldn't conclude they're protected. The .cbark file
              alone can't restore funds — it has no spending key. The
              symmetric pair (seed alone insufficient, backup alone
              insufficient) makes the (1/2) + (2/2) labels honest. */}
          <Text bold style={{ fontSize: 13, color: '#FF7A68', marginBottom: 10, lineHeight: 17 }}>
            {loc.cypherbox.strike.ark_settings.backup_also_need_seed}
          </Text>
          <View style={{ backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
            {/* Local file row — always probes Documents/ark-backup.cbark
                so the user sees when the on-device copy was last refreshed,
                even after iCloud Drive takes over as the active write
                target. The folder hint matches what the user would see in
                their files browser: iOS exposes the app's Documents
                directory under "On My iPhone → Cypher Box" via
                UIFileSharingEnabled + LSSupportsOpeningDocumentsInPlace,
                Android keeps it inside the private app sandbox where it
                isn't user-navigable without root or adb. */}
            <View style={{ paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#333' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, color: '#AAA' }}>{loc.cypherbox.strike.ark_settings.local_copy}</Text>
                {localBackup === null ? (
                  <ActivityIndicator size="small" color="#888" />
                ) : localBackup === undefined ? (
                  <Text bold style={{ fontSize: 13, color: '#E85C5A' }}>{loc.cypherbox.strike.ark_settings.not_yet}</Text>
                ) : (
                  <Text bold style={{ fontSize: 13, color: colors.green }}>{formatAgo(localBackup.modifiedAt)}</Text>
                )}
              </View>
              {localBackup && (
                <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                  {`${formatSize(localBackup.sizeBytes)} · ${localBackup.filename ?? 'ark-backup.cbark'}`}
                </Text>
              )}
              <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                {Platform.OS === 'ios'
                  ? loc.cypherbox.strike.ark_settings.local_path_ios
                  : loc.cypherbox.strike.ark_settings.local_path_android}
              </Text>
              {localNote && (
                <Text style={{ fontSize: 11, color: localNote.startsWith('Local save failed') ? '#E85C5A' : '#888', marginTop: 2 }}>
                  {localNote}
                </Text>
              )}
            </View>

            {/* iCloud Drive row (iOS) — independent probe of the ubiquity
                container so the timestamp reflects the iCloud copy's own
                last-modified time, not the local Documents file. Status
                pill mirrors the Drive row's shape so the two cloud rails
                read the same way: Off / No copy yet / X min ago.
                Android branch is the Google Drive row.*/}
            <View style={{ paddingVertical: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, color: '#AAA' }}>{Platform.OS === 'ios' ? loc.cypherbox.strike.ark_settings.icloud_copy : loc.cypherbox.strike.ark_settings.gdrive_copy}</Text>
                {Platform.OS === 'ios' ? (
                  iCloudAvailable === null ? (
                    <ActivityIndicator size="small" color="#888" />
                  ) : !iCloudAvailable ? (
                    <Text bold style={{ fontSize: 13, color: '#888' }}>{loc.cypherbox.strike.ark_settings.off_for_cypher_box}</Text>
                  ) : iCloudBackup === null ? (
                    <ActivityIndicator size="small" color="#888" />
                  ) : iCloudBackup === undefined ? (
                    <Text bold style={{ fontSize: 13, color: '#E85C5A' }}>{loc.cypherbox.strike.ark_settings.no_copy_yet}</Text>
                  ) : (
                    <Text bold style={{ fontSize: 13, color: colors.green }}>{formatAgo(iCloudBackup.modifiedAt)}</Text>
                  )
                ) : driveConnected === null ? (
                  <ActivityIndicator size="small" color="#888" />
                ) : !driveConnected ? (
                  <Text bold style={{ fontSize: 13, color: '#888' }}>{loc.cypherbox.strike.ark_settings.not_connected}</Text>
                ) : driveBackup === null ? (
                  <ActivityIndicator size="small" color="#888" />
                ) : driveBackup === undefined ? (
                  <Text bold style={{ fontSize: 13, color: '#E85C5A' }}>{loc.cypherbox.strike.ark_settings.no_copy_yet}</Text>
                ) : (
                  <Text bold style={{ fontSize: 13, color: colors.green }}>{formatAgo(driveBackup.modifiedAt)}</Text>
                )}
              </View>
              {Platform.OS === 'ios' && iCloudBackup && (
                <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                  {`${formatSize(iCloudBackup.sizeBytes)} · ${iCloudBackup.filename ?? 'ark-backup.cbark'}`}
                </Text>
              )}
              {Platform.OS === 'ios' && (
                <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                  {loc.cypherbox.strike.ark_settings.icloud_path}
                </Text>
              )}
              {Platform.OS === 'android' && driveBackup && (
                <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                  {`${formatSize(driveBackup.sizeBytes)} · appDataFolder`}
                </Text>
              )}
              {driveError && (
                <Text style={{ fontSize: 11, color: '#E85C5A', marginTop: 2 }}>
                  {driveError}
                </Text>
              )}
              {/* Cloud-rail CTA. Inline pill so the action is one tap
                  away — backup status is the kind of thing you only check
                  when something feels off, and bouncing through a separate
                  screen would defeat the point.
                    iOS: when iCloud is verified for Cypher Box, the pill
                      shows a green "✓ iCloud Drive enabled" — same
                      "connected" affordance the Android Drive row uses
                      when Google Drive is connected. Tap still opens the
                      iCloud-hint alert (Open Settings) so users can
                      verify or disable from one place. When iCloud is
                      off the pill reverts to the neutral "How to enable
                      iCloud Drive" prompt.
                    Android: Connect / Disconnect, gated on driveBusy. */}
              {Platform.OS === 'ios' ? (
                <TouchableOpacity
                  onPress={handleICloudHint}
                  activeOpacity={0.7}
                  style={{
                    marginTop: 10,
                    alignSelf: 'flex-start',
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: iCloudAvailable ? colors.green : '#444',
                    backgroundColor: '#0F0F0F',
                  }}
                >
                  {iCloudAvailable === null ? (
                    <ActivityIndicator size="small" color="#888" />
                  ) : (
                    <Text bold style={{
                      fontSize: 13,
                      color: iCloudAvailable ? colors.green : '#AAA',
                    }}>
                      {iCloudAvailable ? loc.cypherbox.strike.ark_settings.icloud_enabled : loc.cypherbox.strike.ark_settings.how_to_enable_icloud}
                    </Text>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={driveConnected ? handleDriveDisconnect : handleDriveConnect}
                  disabled={driveBusy}
                  activeOpacity={0.7}
                  style={{
                    marginTop: 10,
                    alignSelf: 'flex-start',
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: driveConnected ? '#E85C5A' : (colors.ark?.light ?? colors.green),
                    backgroundColor: '#0F0F0F',
                    opacity: driveBusy ? 0.5 : 1,
                  }}
                >
                  {driveBusy ? (
                    <ActivityIndicator size="small" color="#888" />
                  ) : (
                    <Text bold style={{
                      fontSize: 13,
                      color: driveConnected ? '#E85C5A' : (colors.ark?.light ?? colors.green),
                    }}>
                      {driveConnected ? loc.cypherbox.strike.ark_settings.disconnect : loc.cypherbox.strike.ark_settings.connect_gdrive}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

          </View>
        </View>

      </>)}
      {view === 'actions' && (<>
        {/* Emergency Exit + Delete Vault. The two notification toggles that
            used to sit here moved to the Settings tab: they are configuration
            a user sets once, not a day-to-day operation, and putting them
            beside Emergency Exit invited mis-taps on the one control that
            cannot be undone. */}
        {/* Exit-in-progress status panel replaces both action buttons.
            Shows a single source of truth for what's happening + the
            destination the user picked. Auto-claim runs from useArkSync,
            so there's nothing for the user to tap here. */}
        {arkExitInProgress ? (
          <View style={{ marginTop: 30, alignSelf: 'center', width: widths * 0.85, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: colors.redLight }}>
            <Text bold style={{ fontSize: 15, color: colors.redLight, marginBottom: 8 }}>
              {loc.cypherbox.strike.ark_exit.exit_in_progress}
            </Text>
            <Text style={{ fontSize: 13, color: '#DDD', marginBottom: 6 }}>
              {(() => {
                // Live per-VTXO read when the handle is open; otherwise the
                // persisted at-start snapshot, so the amount survives
                // reloads and closed-handle windows.
                //
                // Three sources, best first. Getting this ladder wrong is
                // what made the panel lie in two different ways.
                //
                // 1. `pendingExitSats`, the live per-VTXO poll above.
                // 2. the store's `pendingExitSats`, refreshed by useArkSync's
                //    exit drive and persisted (the store has no partialize, so
                //    it survives a cold launch). This rung is why the panel
                //    stops quoting a stale total: the local poll calls
                //    fetchArkExitVtxos, which THROWS while the wallet handle
                //    is closed, and the effect swallows it, so on a cold
                //    launch with the vault still locked the local value stays
                //    null for as long as the user takes to authenticate.
                // 3. `arkExitStartedSats`, the at-start snapshot, only when
                //    nothing better has ever been recorded.
                //
                // Rung 3 must never outrank rung 2, because the snapshot is
                // fixed at exit start and does NOT decrement as capsules are
                // claimed. Observed live: 1801 of 3671 sats already recovered
                // and confirmed on chain, vault locked after a relaunch, and
                // the panel still reading "3671 sats pending exit".
                const shownSats =
                  pendingExitSats ??
                  arkBalanceDetail?.pendingExitSats ??
                  arkExitStartedSats;
                // The AMOUNT only. What is happening to it is the phase line
                // below, which used to be baked into this sentence and so never
                // changed for the whole run.
                return shownSats == null || shownSats <= 0
                  ? loc.cypherbox.strike.ark_exit.exit_in_flight
                  : String(loc.formatString(loc.cypherbox.strike.ark_exit.sats_pending_exit, { sats: shownSats.toLocaleString() }));
              })()}
            </Text>

            {/* PHASE. The fix for a panel that read identically whether the
                exit was progressing or wedged. Falls back to the previous
                static sentence until the first poll returns, so a cold launch
                with the vault still locked is never blank. */}
            <Text style={{ fontSize: 13, color: '#DDD', marginBottom: 6 }}>
              {exitPhase?.headline
                ?? loc.cypherbox.strike.ark_exit.exit_phase_fallback}
            </Text>
            {exitPhase?.detail && (
              <Text style={{ fontSize: 12, color: '#AAA', marginBottom: 6 }}>
                {exitPhase.detail}
              </Text>
            )}

            {/* BATTERY NOTICE, Android only, during an exit only.
                An earlier version of this banner lived on the auto-refresh
                setting and was dropped with FGS_DATA_SYNC in v0.1.1. It matters
                far more here: the exit drive is foreground-only, so on a device
                that is not battery-exempt the OS suspends the app the moment
                the screen goes off and the exit stops dead. Measured on a
                Galaxy A14 2026-08-29: zero progressExits calls and zero log
                output across a lock window, with the process alive but frozen.

                Deliberately NOT probed. The native
                isIgnoringBatteryOptimizations() went with the background
                machinery in b8226f9, so nothing can read the OS allowlist any
                more. Rather than guess, this asks once and lets the user say it
                is done; the dismissal is persisted because an exit spans days
                and many launches.

                Linking.openSettings() opens this app's own settings page,
                which is where Battery > Unrestricted lives, and is the same
                call three other prompts in this screen already use. */}
            {Platform.OS === 'android' && !arkExitBatteryNoticeDismissed && (
              <View
                style={{
                  marginTop: 4,
                  marginBottom: 8,
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: 'rgba(251, 146, 60, 0.12)',
                  borderWidth: 1,
                  borderColor: 'rgba(251, 146, 60, 0.45)',
                }}>
                <Text bold style={{ fontSize: 12, color: '#FB923C', marginBottom: 3 }}>
                  {loc.cypherbox.strike.ark_exit.battery_title}
                </Text>
                <Text style={{ fontSize: 11, color: colors.white, lineHeight: 16 }}>
                  {loc.cypherbox.strike.ark_exit.battery_body}
                </Text>
                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={() => {
                      Linking.openSettings().catch((err) => {
                        console.warn('[Ark exit battery notice] open settings failed:', err);
                      });
                    }}
                    style={{ marginRight: 18 }}>
                    <Text bold style={{ fontSize: 12, color: '#FB923C' }}>
                      {loc.cypherbox.strike.ark_exit.open_settings}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setArkExitBatteryNoticeDismissed(true)}>
                    <Text style={{ fontSize: 12, color: '#888' }}>{loc.cypherbox.strike.ark_exit.already_done}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            {arkExitDestinationAddress && (
              <Text style={{ fontSize: 12, color: '#888' }} numberOfLines={1}>
                → {arkExitDestinationAddress}
              </Text>
            )}
            {arkExitStartedAt && (
              <Text style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                {loc.formatString(loc.cypherbox.strike.ark_exit.exit_started_at, { date: new Date(arkExitStartedAt).toLocaleString() })}
              </Text>
            )}

            {/* FEE RESERVE, DURING THE EXIT.
                Previously this whole section was replaced by the panel above,
                so the one moment the reserve matters most was the one moment
                the user could neither see it nor top it up. Worse, the panel
                promises funds sweep automatically while removing the means to
                make that true: every exit branch needs a CPFP broadcast and
                every claim needs a fee, and running dry strands capsules
                mid-exit until someone tops up.
                Observed live 2026-08-18 on a five-capsule exit that ran out at
                699 sats with four claims still owed.
                The receive path is ASP-independent, so it works during an
                outage, which is exactly when an exit is running. */}
            <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#2A2A2A' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 12, color: '#AAA' }}>{loc.cypherbox.strike.ark_exit.fee_reserve_onchain}</Text>
                <Text bold style={{ fontSize: 13, color: onchainReserveSats > 0 ? colors.green : '#FFD54F' }}>
                  {onchainReserveSats.toLocaleString()} sats
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: '#777', marginTop: 6, lineHeight: 15 }}>
                {loc.cypherbox.strike.ark_exit.fee_reserve_desc}
              </Text>
              <TouchableOpacity
                onPress={() => setExitFundingOpen(true)}
                activeOpacity={0.7}
                style={{ marginTop: 10, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)' }}
              >
                <Text bold style={{ fontSize: 13, color: '#FFF' }}>{loc.cypherbox.strike.ark_exit.top_up_exit_fees}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {/* Emergency Exit — sits ABOVE Delete Ark vault. Yellow text
                rather than red so users don't conflate it with the
                irreversible "Delete vault" path; the Alert in
                startExitWithAddress carries the full warning.

                Disabled while the on-chain fee reserve is still being sized
                (recommendedReserveSats === null) or below the recommendation
                (exitFeeGated). When gated, the amber block below explains why
                and offers "Fund exit fees" + a "Start exit anyway" break-glass. */}
            <GradientView
              style={{ marginTop: 30, alignSelf: 'center', height: 38, width: widths * 0.5, shadowColor: '#040404', shadowOffset: { width: 8, height: 8 }, shadowOpacity: 0.8, shadowRadius: 16, elevation: 8, opacity: (exitStarting || recommendedReserveSats === null || exitFeeGated || exitNotWorthFees) ? 0.45 : 1 }}
              linearGradientStyle={{ shadowColor: '#27272C', shadowOffset: { width: -8, height: -8 }, shadowOpacity: 0.48, shadowRadius: 12, elevation: 8 }}
              topShadowStyle={{ shadowOffset: { width: 2, height: 2 }, shadowRadius: 2, shadowColor: colors.ark?.shadowTopNew ?? '#E85C5A', borderRadius: 24, height: 38, width: widths * 0.5, justifyContent: 'center', alignItems: 'center' }}
              bottomShadowStyle={{ shadowOffset: { width: -2, height: -2 }, shadowRadius: 2, shadowOpacity: 1, shadowColor: '#030303', borderRadius: 24, height: 38, width: widths * 0.5, justifyContent: 'center', position: 'absolute' }}
              linearGradientStyleMain={{ borderRadius: 24, height: 38, width: widths * 0.5, justifyContent: 'center', alignItems: 'center' }}
              onPress={(exitStarting || recommendedReserveSats === null || exitFeeGated || exitNotWorthFees) ? undefined : () => setExitPickerOpen(true)}
            >
              <Text h3 bold center style={{ color: colors.ark?.light ?? colors.pink.default }}>
                {exitStarting
                  ? loc.cypherbox.strike.ark_exit.starting_exit
                  : recommendedReserveSats === null
                    ? loc.cypherbox.strike.ark_exit.checking_exit_fees
                    : loc.cypherbox.strike.ark_exit.emergency_exit}
              </Text>
            </GradientView>

            {/* Reserve status, ALWAYS shown.
                Everything below this is conditional on `exitFeeGated`, so a
                wallet whose reserve is funded, or whose reserve could not be
                sized at all, showed a bare Emergency Exit button and said
                nothing about fees or about the separate on-chain wallet they
                come out of. That wallet is invisible everywhere else in the
                app, so "nothing shown" read as "nothing needed".
                COPY: Bam finalizes. */}
            <View style={{ marginTop: 12, marginHorizontal: 24, padding: 10, borderRadius: 10, backgroundColor: exitNotWorthFees ? 'rgba(255, 200, 80, 0.06)' : '#131313', borderWidth: 1, borderColor: exitNotWorthFees ? 'rgba(255, 200, 80, 0.30)' : '#2A2A2A' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 12, color: '#888' }}>{loc.cypherbox.strike.ark_exit.exit_fee_wallet}</Text>
                <Text bold style={{ fontSize: 12, color: colors.white }}>
                  {onchainReserveSats.toLocaleString()} sats
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: '#888' }}>{loc.cypherbox.strike.ark_exit.reserve_needed}</Text>
                <Text bold style={{ fontSize: 12, color: (exitFeeGated || exitNotWorthFees) ? '#FFD54F' : colors.green }}>
                  {recommendedReserveSats === null
                    ? loc.cypherbox.strike.ark_exit.checking
                    : reserveTargetSats > 0
                      ? `${reserveTargetSats.toLocaleString()} sats`
                      : exitNotWorthFees
                        ? loc.cypherbox.strike.ark_exit.more_than_balance
                        : loc.cypherbox.strike.ark_exit.none_needed}
                </Text>
              </View>
              {/* Fee rate the reserve was priced at.
                  Without it the figure above cannot be interpreted. It is
                  max(RESERVE_FLOOR_SATS, totalExitVb * rate * SPIKE_MULT), so it
                  sits flat on the 5,000 floor at low rates and only starts
                  tracking the market once the real cost clears it. Measured on
                  device 2026-09-26: one capsule, 1,266 vB, read 5,000 at
                  1 sat/vB and 7,596 at 3 sat/vB. With no rate shown that reads
                  as the app changing its mind, and a user who funded the 5,000
                  it asked for is then told they are short.
                  The rate is already in reserveDetail and already rendered in
                  the exitNotWorthFees copy below, so this only surfaces it.
                  COPY: Bam finalizes. */}
              {(reserveDetail?.feeRateSatPerVb ?? 0) > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                  <Text style={{ fontSize: 11, color: '#777' }}>{loc.cypherbox.strike.ark_exit.priced_at}</Text>
                  <Text style={{ fontSize: 11, color: '#777' }}>
                    {reserveDetail?.feeRateSatPerVb} sat/vB
                  </Text>
                </View>
              )}
              <Text style={{ fontSize: 11, color: '#777', marginTop: 6, lineHeight: 16 }}>
                {recommendedReserveSats === null
                  ? loc.cypherbox.strike.ark_exit.sizing_reserve
                  : reserveTargetSats <= 0
                    ? (exitNotWorthFees && reserveDetail
                        ? loc.formatString((reserveDetail.excludedCount === 1 ? loc.cypherbox.strike.ark_exit.too_small_to_exit_one : loc.cypherbox.strike.ark_exit.too_small_to_exit_other), {
                            count: reserveDetail.excludedCount,
                            sats: reserveDetail.excludedSats.toLocaleString(),
                            rate_clause: reserveDetail.feeRateSatPerVb > 0 ? String(loc.formatString(loc.cypherbox.strike.ark_exit.rate_clause, { rate: reserveDetail.feeRateSatPerVb })) : '',
                          })
                        : loc.cypherbox.strike.ark_exit.no_capsules_no_reserve)
                    : exitFeeGated
                      ? loc.formatString(loc.cypherbox.strike.ark_exit.short_by, { sats: exitFeeShortfallSats.toLocaleString() })
                      : loc.cypherbox.strike.ark_exit.funded}
              </Text>
            </View>

            {/* Fee-funding gate: on-chain fee wallet is short. Explain, offer
                "Fund exit fees", and a low-emphasis break-glass to start anyway
                (progressExits resumes once fees are added). */}
            {exitFeeGated && onchainReserveSats <= 0 && (
              <View style={{ marginTop: 12, marginHorizontal: 24, padding: 12, borderRadius: 10, backgroundColor: 'rgba(255, 200, 80, 0.06)', borderWidth: 1, borderColor: 'rgba(255, 200, 80, 0.30)' }}>
                <Text bold style={{ fontSize: 13, color: '#FFD54F', marginBottom: 6 }}>
                  {loc.cypherbox.strike.ark_exit.fund_exit_fees_first}
                </Text>
                <Text style={{ fontSize: 12, color: '#CCC', lineHeight: 17 }}>
                  {loc.formatString(loc.cypherbox.strike.ark_exit.fund_exit_fees_first_body, { held: onchainReserveSats.toLocaleString(), shortfall: exitFeeShortfallSats.toLocaleString() })}
                </Text>
                <TouchableOpacity
                  onPress={openExitFunding}
                  style={{ marginTop: 10, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#FFD54F' }}
                >
                  <Text bold style={{ fontSize: 13, color: '#1C1C1C' }}>
                    {loc.cypherbox.strike.ark_exit.fund_exit_fees}
                  </Text>
                </TouchableOpacity>
                {/* Break-glass only when they actually have SOME on-chain fee
                    money. With 0 sats the exit can't broadcast anything, so
                    starting it is pointless: hide the escape hatch entirely. */}
                {onchainReserveSats > 0 && (
                  <TouchableOpacity
                    onPress={() => setExitPickerOpen(true)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ marginTop: 10, alignItems: 'center' }}
                  >
                    <Text style={{ fontSize: 12, color: '#888', textDecorationLine: 'underline' }}>
                      {loc.cypherbox.strike.ark_exit.start_exit_anyway}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* On-chain fee wallet card. Present whenever the on-chain wallet
                holds funds: show the balance and the actions the user can take
                on it — reserve as Emergency Exit fees, add more, or release
                (recover) it back to the Hot Vault. Green once armed, amber
                while unreserved. This is the single home for the on-chain
                wallet; the old Capsules "stuck funds" banner was removed in
                favour of it. Empty wallet falls through to the "Fund exit
                fees first" prompt above. */}
            {onchainReserveSats > 0 && (
              <View style={{ marginTop: 12, marginHorizontal: 24, padding: 12, borderRadius: 10, backgroundColor: (arkExitFeeReserveSats ?? 0) > 0 ? 'rgba(35, 196, 127, 0.07)' : 'rgba(255, 200, 80, 0.06)', borderWidth: 1, borderColor: (arkExitFeeReserveSats ?? 0) > 0 ? 'rgba(35, 196, 127, 0.35)' : 'rgba(255, 200, 80, 0.30)' }}>
                <Text bold style={{ fontSize: 13, color: (arkExitFeeReserveSats ?? 0) > 0 ? colors.green : '#FFD54F', marginBottom: 6 }}>
                  {(arkExitFeeReserveSats ?? 0) > 0 ? loc.cypherbox.strike.ark_exit.exit_fees_ready : loc.cypherbox.strike.ark_exit.onchain_funds}
                </Text>
                <Text style={{ fontSize: 12, color: '#CCC', lineHeight: 17 }}>
                  {(arkExitFeeReserveSats ?? 0) > 0
                    ? loc.formatString(loc.cypherbox.strike.ark_exit.reserved_desc, { sats: onchainReserveSats.toLocaleString() })
                    : loc.formatString(loc.cypherbox.strike.ark_exit.unreserved_desc, { sats: onchainReserveSats.toLocaleString() })}
                </Text>
                {(arkExitFeeReserveSats ?? 0) > 0 && reserveBelowRecommended && (
                  <Text style={{ fontSize: 11, color: '#FFD54F', marginTop: 8, lineHeight: 15 }}>
                    {loc.formatString(loc.cypherbox.strike.ark_exit.reserved_below_recommended, { sats: (recommendedReserveSats ?? 0).toLocaleString() })}
                  </Text>
                )}
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                  {(arkExitFeeReserveSats ?? 0) <= 0 && (
                    <TouchableOpacity
                      onPress={() => { setArkExitFeeReserveSats(onchainReserveSats); SimpleToast.show(loc.cypherbox.strike.ark_exit.reserved_toast, SimpleToast.SHORT); }}
                      style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', backgroundColor: '#FFD54F', marginRight: 8 }}
                    >
                      <Text bold style={{ fontSize: 12, color: '#1C1C1C' }}>{loc.cypherbox.strike.ark_exit.reserve_as_exit_fee}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={openExitFunding}
                    style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.green, marginRight: 8 }}
                  >
                    <Text bold style={{ fontSize: 12, color: colors.green }}>{loc.cypherbox.strike.ark_exit.add_more}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={doRecoverOnchain}
                    style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#888' }}
                  >
                    <Text bold style={{ fontSize: 12, color: '#AAA' }}>{loc.cypherbox.strike.ark_exit.release_button}</Text>
                  </TouchableOpacity>
                </View>
                {/* Break-glass: armed target is above the on-chain balance
                    (exitFeeGated) but funds ARE present on-chain. The main
                    button stays gated, but let the user start the exit anyway
                    rather than stranding them with no path but "Add more".
                    They accept the fee-spike risk; the picker's own warning
                    still applies. */}
                {exitFeeGated && (
                  <TouchableOpacity
                    onPress={() => setExitPickerOpen(true)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ marginTop: 12, alignItems: 'center' }}
                  >
                    <Text style={{ fontSize: 12, color: '#888', textDecorationLine: 'underline' }}>
                      {loc.cypherbox.strike.ark_exit.start_exit_anyway}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Caption row: short summary + circular "?" toggle that
                expands an inline note explaining all the cases where
                Emergency Exit is the right tool (server down, censored,
                shutdown, compromise). Matches the ?-button pattern used
                on the vault Capsules screen (HotStorageVault/Capsules.tsx). */}
            <View style={{ marginTop: 8, paddingHorizontal: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 11, color: '#888', textAlign: 'center', flexShrink: 1 }}>
                  {loc.cypherbox.strike.ark_exit.eject_caption}
                </Text>
                <TouchableOpacity
                  onPress={() => setExitInfoExpanded(v => !v)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={{
                    marginLeft: 8,
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: colors.ark?.light ?? colors.pink.default,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text bold style={{ color: colors.ark?.light ?? colors.pink.default, fontSize: 12, lineHeight: 16 }}>
                    ?
                  </Text>
                </TouchableOpacity>
              </View>
              {exitInfoExpanded && (
                <View
                  style={{
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 10,
                    backgroundColor: 'rgba(255, 200, 80, 0.06)',
                    borderWidth: 1,
                    borderColor: 'rgba(255, 200, 80, 0.30)',
                  }}
                >
                  <Text style={{ fontSize: 12, color: '#BBB', lineHeight: 17 }}>
                    <Text bold style={{ color: colors.ark?.light ?? colors.pink.default }}>
                      {loc.cypherbox.strike.ark_exit.when_to_use_title}
                    </Text>
                    {'\n\n'}
                    {loc.cypherbox.strike.ark_exit.when_to_use_intro}
                    {'\n\n'}
                    {loc.cypherbox.strike.ark_exit.use_it_when}
                    {'\n'}
                    {loc.cypherbox.strike.ark_exit.use_case_down}
                    {'\n'}
                    {loc.cypherbox.strike.ark_exit.use_case_refuses}
                    {'\n'}
                    {loc.cypherbox.strike.ark_exit.use_case_shutdown}
                    {'\n'}
                    {loc.cypherbox.strike.ark_exit.use_case_compromise}
                    {'\n\n'}
                    {loc.cypherbox.strike.ark_exit.when_to_use_outro}
                  </Text>
                </View>
              )}
            </View>

            {/* Delete Ark vault — last-ditch destructive action. Below
                Emergency Exit so users naturally try the safer option first. */}
            <GradientView
              style={{ marginTop: 18, alignSelf: 'center', height: 38, width: widths * 0.36, shadowColor: '#040404', shadowOffset: { width: 8, height: 8 }, shadowOpacity: 0.8, shadowRadius: 16, elevation: 8 }}
              linearGradientStyle={{ shadowColor: '#27272C', shadowOffset: { width: -8, height: -8 }, shadowOpacity: 0.48, shadowRadius: 12, elevation: 8 }}
              topShadowStyle={{ shadowOffset: { width: 2, height: 2 }, shadowRadius: 2, shadowColor: '#E85C5A', borderRadius: 24, height: 38, width: widths * 0.36, justifyContent: 'center', alignItems: 'center' }}
              bottomShadowStyle={{ shadowOffset: { width: -2, height: -2 }, shadowRadius: 2, shadowOpacity: 1, shadowColor: '#030303', borderRadius: 24, height: 38, width: widths * 0.36, justifyContent: 'center', position: 'absolute' }}
              linearGradientStyleMain={{ borderRadius: 24, height: 38, width: widths * 0.36, justifyContent: 'center', alignItems: 'center' }}
              onPress={deleting ? undefined : () => { void handleDeleteVault(); }}
            >
              <Text h3 bold center style={{ color: colors.redLight }}>
                {deleting ? loc.cypherbox.strike.ark_settings.deleting : loc.cypherbox.strike.ark_settings.delete_ark_vault}
              </Text>
            </GradientView>
          </>
        )}

        {/* Destination picker — two-step modal.
            Step 1 'category': Hot Vault / Cold Storage / External (always
              visible; disabled rows when no wallet of that kind is connected).
            Step 2:
              'hot-addr'    — list of Hot Vault addresses, first marked Default.
              'cold-addr'   — same for Cold Storage, plus the standard Cypher
                              Box hardware-verify warning + checkbox (matches
                              the cold-vault warnings in [ColdStorage:1259]
                              and [Vault:176]). Send disabled until ticked.
              'external'    — text input for any Bitcoin address.
            Loose validation in `looksLikeBitcoinAddress`; the SDK's
            drainExits does the authoritative checksum + network check. */}
        <Modal
          visible={exitPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setExitPickerOpen(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 24 }}>
            <View style={{ backgroundColor: '#1a1a1a', borderRadius: 14, padding: 18 }}>
              {/* Back button when not on the category step. */}
              {pickerStep !== 'category' && (
                <TouchableOpacity
                  onPress={() => setPickerStep('category')}
                  style={{ alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 4, marginBottom: 6 }}
                >
                  <Text bold style={{ fontSize: 13, color: colors.ark?.light ?? colors.pink.default }}>
                    {loc.cypherbox.strike.ark_exit.back}
                  </Text>
                </TouchableOpacity>
              )}

              {pickerStep === 'category' && (
                <>
                  <Text bold style={{ fontSize: 17, color: '#FFF', marginBottom: 6 }}>
                    {loc.cypherbox.strike.ark_exit.where_should_funds_go}
                  </Text>
                  <Text style={{ fontSize: 13, color: '#AAA', marginBottom: 14 }}>
                    {loc.cypherbox.strike.ark_exit.pick_destination_desc}
                  </Text>

                  <TouchableOpacity
                    onPress={enterHotAddrStep}
                    disabled={!walletID}
                    style={{ paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: '#333', opacity: walletID ? 1 : 0.5 }}
                  >
                    <Text bold style={{ fontSize: 15, color: '#FFF' }}>{loc.cypherbox.strike.ark_exit.hot_vault}</Text>
                    <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                      {walletID
                        ? loc.cypherbox.strike.ark_exit.hot_vault_desc
                        : loc.cypherbox.strike.ark_exit.no_hot_vault_connected}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={enterColdAddrStep}
                    disabled={!coldStorageWalletID}
                    style={{ paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: '#333', opacity: coldStorageWalletID ? 1 : 0.5 }}
                  >
                    <Text bold style={{ fontSize: 15, color: '#FFF' }}>{loc.cypherbox.strike.ark_exit.cold_vault}</Text>
                    <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                      {coldStorageWalletID
                        ? loc.cypherbox.strike.ark_exit.cold_vault_desc
                        : loc.cypherbox.strike.ark_exit.no_cold_wallet_connected}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setPickerStep('external')}
                    style={{ paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: '#333' }}
                  >
                    <Text bold style={{ fontSize: 15, color: '#FFF' }}>{loc.cypherbox.strike.ark_exit.external_address}</Text>
                    <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                      {loc.cypherbox.strike.ark_exit.paste_any_address}
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {(pickerStep === 'hot-addr' || pickerStep === 'cold-addr') && (
                <>
                  <Text bold style={{ fontSize: 17, color: '#FFF', marginBottom: 10 }}>
                    {pickerStep === 'hot-addr'
                      ? (addrListOpen ? loc.cypherbox.strike.ark_exit.pick_hot_address : loc.cypherbox.strike.ark_exit.hot_destination)
                      : (addrListOpen ? loc.cypherbox.strike.ark_exit.pick_cold_address : loc.cypherbox.strike.ark_exit.cold_destination)}
                  </Text>

                  {/* Default flow: QR + address + "Choose another" — mirrors
                      the Receive-to-vault popup pattern (ReceivedListNew). */}
                  {!addrListOpen && selectedAddr && (
                    <>
                      <View style={{ alignSelf: 'center', backgroundColor: 'white', padding: 10, borderRadius: 10, marginBottom: 12 }}>
                        <QRCode
                          value={selectedAddr}
                          size={150}
                          color="black"
                          backgroundColor="white"
                        />
                      </View>

                      <TouchableOpacity
                        onPress={() => {
                          if (selectedAddr) {
                            Clipboard.setString(selectedAddr);
                            SimpleToast.show(loc.cypherbox.strike.ark_exit.address_copied, SimpleToast.SHORT);
                          }
                        }}
                        activeOpacity={0.7}
                        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, marginBottom: 10 }}
                      >
                        <Text style={{ fontSize: 12, color: '#CCC', flex: 1, fontFamily: 'monospace' }} numberOfLines={1}>
                          {selectedAddr}
                        </Text>
                        <Image source={Copy} style={{ width: 20, height: 16, marginLeft: 8, tintColor: '#aaa' }} resizeMode="contain" />
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => setAddrListOpen(true)}
                        style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.ark?.light ?? colors.pink.default, marginBottom: 12 }}
                      >
                        <Text bold style={{ fontSize: 13, color: colors.ark?.light ?? colors.pink.default }}>
                          {loc.cypherbox.strike.ark_exit.choose_another_address}
                        </Text>
                      </TouchableOpacity>

                      {pickerStep === 'cold-addr' && (
                        <View style={{ padding: 10, borderRadius: 8, backgroundColor: 'rgba(232, 92, 90, 0.08)', borderWidth: 1, borderColor: colors.redLight, marginBottom: 4 }}>
                          <Text style={{ fontSize: 12, color: '#FFF', marginBottom: 8 }}>
                            ⚠️ DO NOT proceed without checking the selected
                            address on your signing device (hardware wallet
                            or offline phone). Confirm character-by-character
                            that the address above matches what it displays.
                          </Text>
                          <TouchableOpacity
                            onPress={() => setHardwareVerified((v) => !v)}
                            style={{ flexDirection: 'row', alignItems: 'center' }}
                          >
                            <View style={{
                              width: 18, height: 18, borderRadius: 4, borderWidth: 1,
                              borderColor: hardwareVerified ? (colors.ark?.light ?? colors.pink.default) : '#888',
                              backgroundColor: hardwareVerified ? (colors.ark?.light ?? colors.pink.default) : 'transparent',
                              alignItems: 'center', justifyContent: 'center', marginRight: 8,
                            }}>
                              {hardwareVerified && (
                                <Text bold style={{ fontSize: 12, color: '#000' }}>✓</Text>
                              )}
                            </View>
                            <Text style={{ fontSize: 12, color: '#FFF', flex: 1 }}>
                              I have checked this address on my signing device.
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      <TouchableOpacity
                        onPress={pickerStep === 'hot-addr' ? confirmHotAddr : confirmColdAddr}
                        disabled={!selectedAddr || (pickerStep === 'cold-addr' && !hardwareVerified)}
                        style={{
                          marginTop: 8,
                          paddingVertical: 12,
                          borderRadius: 10,
                          alignItems: 'center',
                          backgroundColor:
                            selectedAddr && (pickerStep === 'hot-addr' || hardwareVerified)
                              ? (colors.ark?.light ?? colors.pink.default)
                              : '#222',
                        }}
                      >
                        <Text bold style={{
                          fontSize: 13,
                          color:
                            selectedAddr && (pickerStep === 'hot-addr' || hardwareVerified)
                              ? '#000'
                              : '#666',
                        }}>
                          {loc.cypherbox.strike.ark_exit.send_to_this_address}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {/* Address list — opened from the "Choose another" button.
                      Tapping any row sets it selected and returns to the QR
                      view. Cold-vault path requires re-checking the hardware
                      verify box after switching addresses, since the verified
                      flag is per-address. */}
                  {addrListOpen && (
                    <>
                      <Text style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
                        {loc.cypherbox.strike.ark_exit.address_list_desc}
                      </Text>

                      <ScrollView style={{ maxHeight: 280 }}>
                        {(pickerStep === 'hot-addr' ? hotAddrs : coldAddrs).map((addr, idx) => {
                          const isSelected = selectedAddr === addr;
                          return (
                            <TouchableOpacity
                              key={addr}
                              onPress={() => {
                                setSelectedAddr(addr);
                                if (pickerStep === 'cold-addr') setHardwareVerified(false);
                                setAddrListOpen(false);
                              }}
                              style={{
                                paddingVertical: 10,
                                paddingHorizontal: 10,
                                borderRadius: 8,
                                marginBottom: 4,
                                borderWidth: 1,
                                borderColor: isSelected ? (colors.ark?.light ?? colors.pink.default) : '#333',
                                backgroundColor: isSelected ? 'rgba(255,255,255,0.04)' : 'transparent',
                              }}
                            >
                              <Text style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>
                                {idx === 0 ? loc.cypherbox.strike.ark_exit.default_new_address : loc.formatString(loc.cypherbox.strike.ark_exit.previously_derived, { n: idx })}
                              </Text>
                              <Text style={{ fontSize: 12, color: '#FFF' }}>
                                {addr}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>

                      <TouchableOpacity
                        onPress={() => setAddrListOpen(false)}
                        style={{ marginTop: 10, paddingVertical: 10, alignItems: 'center' }}
                      >
                        <Text bold style={{ fontSize: 13, color: '#AAA' }}>
                          {loc.cypherbox.strike.ark_exit.back_to_selected}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </>
              )}

              {pickerStep === 'external' && (
                <>
                  <Text bold style={{ fontSize: 17, color: '#FFF', marginBottom: 6 }}>
                    {loc.cypherbox.strike.ark_exit.external_address}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
                    {loc.cypherbox.strike.ark_exit.external_address_desc}
                  </Text>
                  <TextInput
                    value={externalAddrInput}
                    onChangeText={setExternalAddrInput}
                    placeholder="bc1q… / 1… / 3…"
                    placeholderTextColor="#555"
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    style={{
                      backgroundColor: '#0E0E0E',
                      color: '#FFF',
                      fontSize: 13,
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 10,
                      borderWidth: 1,
                      borderColor: '#333',
                    }}
                  />
                  <TouchableOpacity
                    onPress={handlePickExternal}
                    disabled={!externalAddrInput.trim()}
                    style={{
                      marginTop: 10,
                      paddingVertical: 10,
                      borderRadius: 10,
                      alignItems: 'center',
                      backgroundColor: externalAddrInput.trim()
                        ? (colors.ark?.light ?? colors.pink.default)
                        : '#222',
                    }}
                  >
                    <Text bold style={{ fontSize: 13, color: externalAddrInput.trim() ? '#000' : '#666' }}>
                      {loc.cypherbox.strike.ark_exit.send_to_this_address}
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity
                onPress={() => setExitPickerOpen(false)}
                style={{ marginTop: 14, paddingVertical: 10, alignItems: 'center' }}
              >
                <Text bold style={{ fontSize: 14, color: '#AAA' }}>{loc._.cancel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Fund-exit-fees modal. Tops up the on-chain (BDK) wallet that pays
            the unilateral-exit CPFP fees. Three paths, in tab order:
              Convert from balance: cooperative offboard from Ark. Listed
                first because it is the one a user can do with what they
                already hold, rather than having to source outside sats. It
                needs the ASP, so it is disabled when unreachable and absent
                entirely while an exit is in flight, and it is best done ahead
                of time rather than as an at-outage rescue.
              Receive Bitcoin: deposit external BTC to the on-chain address.
                ASP-independent, so this is the one that still works when the
                server is gone. The armed reserve keeps the deposit on-chain
                (sync.ts won't board it away) and the gate unlocks on confirm.
              From a wallet: same as above, sourced from another Cypher Box
                wallet.
            NOTE: the default selected tab is still 'receive'. Tab order is a
            discoverability choice; the default is a safety one, and opening on
            a tab that is disabled whenever the ASP is unreachable would be
            worse than opening on the path that always works. */}
        <Modal
          visible={exitFundingOpen}
          transparent
          animationType="fade"
          onRequestClose={() => !fundingBusy && setExitFundingOpen(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 24 }}>
            <View style={{ backgroundColor: '#1a1a1a', borderRadius: 14, padding: 18, borderWidth: 1, borderColor: colors.ark?.light ?? colors.pink.default }}>
              <Text bold style={{ fontSize: 17, color: '#FFF', marginBottom: 4 }}>
                {loc.cypherbox.strike.ark_exit.fund_exit_fees}
              </Text>
              <Text style={{ fontSize: 12, color: '#AAA', marginBottom: 12, lineHeight: 17 }}>
                {loc.formatString(loc.cypherbox.strike.ark_exit.funding_desc, { held: onchainReserveSats.toLocaleString(), target: reserveTargetSats.toLocaleString() })}
              </Text>

              {/* Editable reserve target: hold more (bigger fee-spike buffer) or
                  less. Applied on blur; auto-board keeps exactly this much
                  on-chain and boards any surplus into the Ark balance. */}
              <Text style={{ fontSize: 12, color: '#FFF', marginBottom: 6 }}>{loc.cypherbox.strike.ark_exit.reserve_for_fees}</Text>
              <TextInput
                value={reserveTargetInput}
                onChangeText={(t) => setReserveTargetInput(t.replace(/[^0-9]/g, ''))}
                onEndEditing={applyReserveTarget}
                keyboardType="number-pad"
                placeholder={String(recommendedReserveSats ?? 0)}
                placeholderTextColor="#666"
                editable={!fundingBusy}
                style={{ color: '#FFF', borderWidth: 1, borderColor: '#444', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 4 }}
              />
              <Text style={{ fontSize: 11, color: '#777', marginBottom: 14, lineHeight: 15 }}>
                {loc.formatString(loc.cypherbox.strike.ark_exit.recommended_reserve, { sats: (recommendedReserveSats ?? 0).toLocaleString() })}
              </Text>

              {/* Tab switch */}
              <View style={{ flexDirection: 'row', marginBottom: 14, borderRadius: 10, backgroundColor: '#222', padding: 3 }}>
                {((arkExitInProgress
                  ? (['receive', 'wallet'] as const)
                  : (['convert', 'receive', 'wallet'] as const)) as readonly ('receive' | 'wallet' | 'convert')[]).map((tab) => {
                  const active = fundingTab === tab;
                  return (
                    <TouchableOpacity
                      key={tab}
                      onPress={() => setFundingTab(tab)}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: active ? (colors.ark?.light ?? colors.pink.default) : 'transparent' }}
                    >
                      <Text bold style={{ fontSize: 12, color: active ? '#1C1C1C' : '#AAA', textAlign: 'center' }}>
                        {/* Kept short enough not to wrap. "Convert from
                            balance" took two lines in a third of the modal,
                            which made the whole strip double height and the
                            active pill read as oversized next to the others.
                            The tab body below carries the full explanation. */}
                        {tab === 'receive'
                          ? loc.cypherbox.strike.ark_exit.tab_receive
                          : tab === 'wallet'
                            ? loc.cypherbox.strike.ark_exit.tab_wallet
                            : loc.cypherbox.strike.ark_exit.tab_convert}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {fundingTab === 'receive' && (
                <>
                  <Text style={{ fontSize: 12, color: '#CCC', marginBottom: 12, lineHeight: 17 }}>
                    {loc.formatString(loc.cypherbox.strike.ark_exit.receive_desc, { sats: exitFeeShortfallSats.toLocaleString() })}
                  </Text>
                  {onchainFundAddr ? (
                    <>
                      <View style={{ alignSelf: 'center', backgroundColor: 'white', padding: 10, borderRadius: 10, marginBottom: 12 }}>
                        <QRCode value={onchainFundAddr} size={150} color="black" backgroundColor="white" />
                      </View>
                      <TouchableOpacity
                        onPress={() => {
                          if (onchainFundAddr) {
                            Clipboard.setString(onchainFundAddr);
                            SimpleToast.show(loc.cypherbox.strike.ark_exit.address_copied, SimpleToast.SHORT);
                          }
                        }}
                        activeOpacity={0.7}
                        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, marginBottom: 8 }}
                      >
                        <Text style={{ fontSize: 12, color: '#CCC', flex: 1, fontFamily: 'monospace' }} numberOfLines={1}>
                          {onchainFundAddr}
                        </Text>
                        <Image source={Copy} style={{ width: 20, height: 16, marginLeft: 8, tintColor: '#aaa' }} resizeMode="contain" />
                      </TouchableOpacity>
                      <Text style={{ fontSize: 11, color: '#777', lineHeight: 15 }}>
                        {loc.cypherbox.strike.ark_exit.unlocks_on_confirm}
                      </Text>
                    </>
                  ) : (
                    <ActivityIndicator color={colors.ark?.light ?? colors.pink.default} style={{ marginVertical: 24 }} />
                  )}
                </>
              )}

              {fundingTab === 'wallet' && (
                <>
                  <Text style={{ fontSize: 12, color: '#CCC', marginBottom: 12, lineHeight: 17 }}>
                    {loc.formatString(loc.cypherbox.strike.ark_exit.wallet_desc, { sats: exitFeeShortfallSats.toLocaleString() })}
                  </Text>
                  {/* Sources that cannot be used are listed too, dimmed and with
                      a reason. Hiding them makes the feature look broken to
                      someone expecting their wallet to appear. */}
                  <ExitFundingSourceList
                    shortfallSats={exitFeeShortfallSats}
                    sources={buildExitFundingSources({
                      coinos: { connected: !!isAuth && isCoinosAllowed() },
                      strike: { connected: !!isStrikeAuth && isStrikeAllowed() },
                      hotVault: { walletID: walletID ?? null },
                      coldVault: { walletID: coldStorageWalletID ?? null },
                      shortfallSats: exitFeeShortfallSats,
                    })}
                    onSelect={(id) => {
                      // Only CoinOS has a provider today. The others stay in the
                      // list so the roadmap is visible, but must not pretend to
                      // work.
                      if (id !== 'coinos') {
                        SimpleToast.show(loc.cypherbox.strike.ark_exit.coming_soon_wallet, SimpleToast.SHORT);
                        return;
                      }
                      setExitFundingOpen(false);
                      (navigation as any).navigate('ArkExitFundingConfirmScreen', {
                        sourceId: 'coinos',
                        sourceLabel: 'CoinOS',
                        shortfallSats: exitFeeShortfallSats,
                        // Balance is read on the confirm screen; null means
                        // "unknown", which plans for the full shortfall rather
                        // than refusing.
                        availableSats: null,
                      });
                    }}
                  />
                </>
              )}

              {fundingTab === 'convert' && (
                <>
                  <Text style={{ fontSize: 12, color: '#CCC', marginBottom: 10, lineHeight: 17 }}>
                    {loc.cypherbox.strike.ark_exit.convert_desc}
                  </Text>
                  {aspReachable === false && (
                    <View style={{ padding: 10, borderRadius: 8, backgroundColor: 'rgba(232, 92, 90, 0.08)', borderWidth: 1, borderColor: colors.redLight, marginBottom: 10 }}>
                      <Text style={{ fontSize: 12, color: '#FFF' }}>
                        {loc.cypherbox.strike.ark_exit.asp_unreachable}
                      </Text>
                    </View>
                  )}
                  <Text style={{ fontSize: 12, color: '#FFF', marginBottom: 6 }}>{loc.cypherbox.strike.ark_exit.amount_sats}</Text>
                  <TextInput
                    value={convertAmount}
                    onChangeText={(t) => setConvertAmount(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#666"
                    editable={aspReachable !== false && !fundingBusy}
                    style={{ color: '#FFF', borderWidth: 1, borderColor: '#444', borderRadius: 8, padding: 10, fontSize: 14 }}
                  />
                  {convertEst && (
                    <Text style={{ fontSize: 12, color: '#AAA', marginTop: 8, lineHeight: 17 }}>
                      {loc.formatString(loc.cypherbox.strike.ark_exit.convert_estimate, { net: convertEst.netLandingSats.toLocaleString(), fee: convertEst.feeSats.toLocaleString() })}
                    </Text>
                  )}
                  <TouchableOpacity
                    onPress={doConvertToExitFees}
                    disabled={fundingBusy || aspReachable === false || !convertEst}
                    style={{ marginTop: 14, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: (fundingBusy || aspReachable === false || !convertEst) ? '#222' : (colors.ark?.light ?? colors.pink.default) }}
                  >
                    <Text bold style={{ fontSize: 13, color: (fundingBusy || aspReachable === false || !convertEst) ? '#666' : '#000' }}>
                      {fundingBusy ? loc.cypherbox.strike.ark_exit.converting : loc.cypherbox.strike.ark_exit.convert_to_exit_fees}
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity
                onPress={() => !fundingBusy && setExitFundingOpen(false)}
                style={{ marginTop: 14, paddingVertical: 10, alignItems: 'center' }}
              >
                <Text bold style={{ fontSize: 13, color: '#AAA' }}>
                  {loc._.close}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Delete-vault confirm modal. Replaces the legacy native Alert
            because Alert can't host the "keep seedphrase on device" toggle.
            Tapping the toggle off shows a red warning under it; the user
            has to acknowledge they hold the seed before deleting. */}
        <Modal
          transparent
          visible={deleteModalVisible}
          animationType="fade"
          onRequestClose={() => setDeleteModalVisible(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 24 }}>
            <View style={{ backgroundColor: '#1a1a1a', borderRadius: 16, padding: 20 }}>
              <Text bold style={{ fontSize: 18, color: '#FFF', marginBottom: 10 }}>
                {loc.cypherbox.strike.ark_settings.delete_title}
              </Text>
              <Text style={{ fontSize: 13, color: '#CCC', lineHeight: 19, marginBottom: 16 }}>
                {loc.formatString(loc.cypherbox.strike.ark_settings.delete_body, { file: <Text bold style={{ color: '#FFF' }}>{loc.cypherbox.strike.ark_settings.delete_body_file}</Text> })}
              </Text>

              {/* An exit that is mid-flight has transactions on the chain and a
                  clock running against expiry. Deleting stops the drive that
                  pushes the remaining levels, so the user has to learn that
                  before they confirm rather than from the silence afterwards.
                  Amber, not red: the forced backup means this is a stalled
                  exit, not lost funds.
                  COPY: Bam finalizes. */}
              {exitInFlight && (
                <View
                  style={{
                    marginBottom: 16,
                    padding: 10,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: '#FFB020',
                    backgroundColor: 'rgba(255, 176, 32, 0.08)',
                  }}
                >
                  <Text bold style={{ color: '#FFC65C', fontSize: 12, marginBottom: 4 }}>
                    {loc.cypherbox.strike.ark_settings.delete_exit_in_progress_title}
                  </Text>
                  <Text style={{ color: '#FFD79A', fontSize: 12, lineHeight: 16 }}>
                    {loc.cypherbox.strike.ark_settings.delete_exit_in_progress_body}
                  </Text>
                </View>
              )}

              <TouchableOpacity
                onPress={() => setKeepSeedOnDevice(v => !v)}
                activeOpacity={0.8}
                style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6 }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 5,
                    borderWidth: 1.5,
                    borderColor: keepSeedOnDevice ? (colors.ark?.light ?? colors.pink.default) : '#888',
                    backgroundColor: keepSeedOnDevice ? (colors.ark?.light ?? colors.pink.default) : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 10,
                    marginTop: 1,
                  }}
                >
                  {keepSeedOnDevice && (
                    <Text style={{ color: '#000', fontSize: 14, lineHeight: 16 }}>✓</Text>
                  )}
                </View>
                <Text style={{ flex: 1, fontSize: 13, color: '#EEE', lineHeight: 18 }}>
                  {loc.formatString(loc.cypherbox.strike.ark_settings.keep_seed_on_device, { biometric: biometricLabel })}
                </Text>
              </TouchableOpacity>

              {!keepSeedOnDevice && (
                <View
                  style={{
                    marginTop: 10,
                    padding: 10,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: '#FF5A5A',
                    backgroundColor: 'rgba(255, 90, 90, 0.08)',
                  }}
                >
                  <Text bold style={{ color: '#FF7A7A', fontSize: 12, marginBottom: 4 }}>
                    {loc.cypherbox.strike.ark_settings.delete_seed_warning_title}
                  </Text>
                  <Text style={{ color: '#FF9A9A', fontSize: 12, lineHeight: 16 }}>
                    {loc.cypherbox.strike.ark_settings.delete_seed_warning_body}
                  </Text>
                </View>
              )}

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18, gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setDeleteModalVisible(false)}
                  style={{ paddingVertical: 10, paddingHorizontal: 16 }}
                >
                  <Text bold style={{ fontSize: 14, color: '#AAA' }}>{loc._.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={confirmDeleteVault}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 16,
                    borderRadius: 8,
                    backgroundColor: '#7A1A1A',
                  }}
                >
                  <Text bold style={{ fontSize: 14, color: '#FFB0B0' }}>{loc.cypherbox.strike.ark_settings.delete_vault}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </>)}
      </RNAnimated.View>
    </ScrollView>
  );
}
