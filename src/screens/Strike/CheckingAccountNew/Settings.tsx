import Clipboard from "@react-native-clipboard/clipboard";
import QRCode from "react-native-qrcode-svg";

import { Copy, StrikeFull } from "@Cypher/assets/images";
import { GradientSwitch, Text } from "@Cypher/component-library";
import { GradientView } from "@Cypher/components";
import useAuthStore from "@Cypher/stores/authStore";
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
import { getStrikeProfile, getStrikeLimits, getBankPaymentMethods } from "@Cypher/api/strikeAPIs";
import {
  AUTO_BACKUP_PATH,
  connectGoogleDrive,
  disconnectGoogleDrive,
  fetchPendingExitsTotalSats,
  findAutoBackupForRecovery,
  getAutoBackupPath,
  getCachedArkBackupFingerprint,
  getDeviceManufacturer,
  getDriveBackupInfo,
  getICloudBackupPath,
  getICloudBackupPathForFingerprint,
  getLastLocalBackupNote,
  isGoogleDriveConnected,
  isICloudBackupAvailable,
  isIgnoringBatteryOptimizations,
  openBatteryOptimizationSettings,
  readArkSeedPhrase,
  resetArkWalletState,
  setArkBackgroundRefreshEnabled,
  startArkEmergencyExit,
  vendorGuidance,
  writeArkBackupToTempFile,
} from "@Cypher/services/ark";
import RNFS from "react-native-fs";
import Share from "react-native-share";
import { BlueStorageContext } from "../../../../blue_modules/storage-context";
import { recordEvent } from "@Cypher/stores/eventLogStore";
import { setArkExitCorrelationId } from "@Cypher/services/activityCursors";

interface Props {
  receiveType: boolean;
  currency: string;
  /** True when the parent tab navigated here as the Ark Vault settings. */
  isArk?: boolean;
}

export default function Settings({ receiveType, currency, isArk }: Props) {
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
    walletID,
    coldStorageWalletID,
    arkExitInProgress,
    arkExitDestinationAddress,
    arkExitStartedAt,
    setArkExitInProgress,
    setArkExitDestinationAddress,
    setArkExitStartedAt,
  } = useAuthStore() as any;
  const arkIosBackupReminderActive = useAuthStore((s) => s.arkIosBackupReminderActive);
  const setArkIosBackupReminderActive = useAuthStore((s) => s.setArkIosBackupReminderActive);
  const { wallets } = useContext(BlueStorageContext) as any;
  const navigation = useNavigation();
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
  type BackupInfo = { modifiedAt: number; sizeBytes: number };
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
  const [batteryNotExempt, setBatteryNotExempt] = useState<boolean | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    // Probe regardless of the auto-refresh toggle. The battery-Unrestricted
    // setting also gates the scheduled expiry-warning notifications (which
    // fire whether or not auto-refresh is on), so the banner must show
    // whenever the app isn't battery-exempt, not only while auto-refresh runs.
    let cancelled = false;
    const probe = async () => {
      try {
        const ignoring = await isIgnoringBatteryOptimizations();
        if (!cancelled) setBatteryNotExempt(!ignoring);
      } catch (err) {
        // Native bridge hiccup — leave the previous value alone rather
        // than flipping the banner state on a transient.
        if (__DEV__) console.warn('[ArkSettings] battery probe failed:', err);
      }
    };
    void probe();
    const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') void probe();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const handleToggleBgRefresh = async (next: boolean) => {
    if (togglingBgRefresh) return;
    setTogglingBgRefresh(true);
    try {
      if (next) {
        const creds = await Keychain.getGenericPassword({ service: "ark-seed-phrase" });
        if (!creds || !creds.password) {
          SimpleToast.show(
            "Can't enable. Seed is not in Keychain. Use Recover to type it in first.",
            SimpleToast.LONG,
          );
          return;
        }
        await setArkBackgroundRefreshEnabled(true, creds.password);
        SimpleToast.show("Reminders enabled", SimpleToast.SHORT);

        // Battery onboarding nudge. AlarmManager fires can be deferred
        // indefinitely under Doze + vendor battery managers; probing on
        // toggle-on is the right moment for a one-time setup walkthrough.
        // iOS resolves true and skips this entirely.
        const ignoring = await isIgnoringBatteryOptimizations();
        if (!ignoring) {
          const manufacturer = await getDeviceManufacturer();
          const guidance = vendorGuidance(manufacturer);
          const body = [
            "Android sleeps apps to save battery. Without this, expiry reminders can fire late or not at all. You'll need to open Cypher Box yourself to refresh your capsules before they expire.",
            "",
            ...guidance.steps,
          ].join("\n");
          Alert.alert(
            guidance.headline,
            body,
            [
              { text: "Skip for now", style: "cancel" },
              {
                text: "Open Settings",
                onPress: () => {
                  openBatteryOptimizationSettings().catch((err) => {
                    console.warn("[Ark bg refresh toggle] open settings failed:", err);
                  });
                },
              },
            ],
            { cancelable: true },
          );
        }
      } else {
        await setArkBackgroundRefreshEnabled(false);
        SimpleToast.show("Reminders disabled", SimpleToast.SHORT);
      }
    } catch (err: any) {
      console.warn("[Ark bg refresh toggle] failed:", err);
      SimpleToast.show(
        `Toggle failed: ${err?.message ?? "unknown error"}`,
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
        if (!exists) {
          setLocalBackup(undefined);
        } else {
          const stat = await RNFS.stat(localPath);
          if (cancelled) return { cacheWarm: !!fp };
          setLocalBackup({
            modifiedAt: typeof stat.mtime === 'number' ? stat.mtime : new Date(stat.mtime as any).getTime(),
            sizeBytes: Number(stat.size) || 0,
          });
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
              if (!exists) {
                setICloudBackup(undefined);
              } else {
                const stat = await RNFS.stat(iCloudPath);
                if (cancelled) return { cacheWarm: !!fp };
                setICloudBackup({
                  modifiedAt:
                    typeof stat.mtime === 'number'
                      ? stat.mtime
                      : new Date(stat.mtime as any).getTime(),
                  sizeBytes: Number(stat.size) || 0,
                });
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
          setDriveError(e?.message || 'Drive unreachable');
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
    if (diff < 0) return 'just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
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
      setDriveError(e?.message || 'Drive unreachable');
    }
  };

  const handleDriveConnect = async () => {
    if (driveBusy) return;
    setDriveBusy(true);
    setDriveError(null);
    try {
      const ok = await connectGoogleDrive();
      if (!ok) {
        SimpleToast.show('Drive sign-in cancelled.', SimpleToast.SHORT);
      } else {
        SimpleToast.show('Google Drive connected.', SimpleToast.SHORT);
      }
    } catch (e: any) {
      // Surface the real Google Sign-In error code so a misconfigured
      // OAuth client / missing Play Services / SHA-1 mismatch shows
      // up as a usable message instead of silent failure. Common codes:
      //   DEVELOPER_ERROR — wrong webClientId or SHA-1 not registered
      //   PLAY_SERVICES_NOT_AVAILABLE — emulator without GMS
      //   SIGN_IN_REQUIRED — user signed out mid-flow
      const code = e?.code ? ` [${e.code}]` : '';
      const msg = e?.message || 'Drive connect failed';
      setDriveError(`${msg}${code}`);
      SimpleToast.show(`Drive connect failed${code}: ${msg}`, SimpleToast.LONG);
    } finally {
      setDriveBusy(false);
      await refreshDriveStatus();
    }
  };

  const handleDriveDisconnect = async () => {
    if (driveBusy) return;
    Alert.alert(
      'Disconnect Google Drive?',
      'Your existing backup file will stay in Drive — disconnecting only stops future uploads. You can reconnect any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setDriveBusy(true);
            try {
              await disconnectGoogleDrive();
            } catch (e: any) {
              SimpleToast.show(`Disconnect failed: ${e?.message || 'unknown error'}`, SimpleToast.SHORT);
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
      'Enable iCloud Drive',
      'Cypher Box stores its backup in your Documents folder. To sync it to iCloud, open iOS Settings → [your name] → iCloud → iCloud Drive, then enable Cypher Box in the app list.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
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
      SimpleToast.show('iCloud Drive verified — reminder dismissed.', SimpleToast.LONG);
      return;
    }
    Alert.alert(
      "iCloud Drive isn't on for Cypher Box",
      "Open iOS Settings → [your name] → iCloud → iCloud Drive → scroll the app list and switch Cypher Box ON. Then come back here and tap 'iCloud Drive is on — dismiss' again.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
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
        SimpleToast.show('No seed available, or authentication declined.', SimpleToast.SHORT);
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
      SimpleToast.show(`Couldn't prepare backup file: ${err?.message ?? 'unknown error'}.`, SimpleToast.LONG);
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
          'No seed available, or authentication declined.',
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
   * phase 1. After phase 3 completes, useArkSync auto-deletes the vault
   * (resetArkWalletState + clearArkAuth) — Bam's call: don't make the user
   * come back later to clean up.
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
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const n = await fetchPendingExitsTotalSats();
        if (!cancelled) setPendingExitSats(n);
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

  const startExitWithAddress = async (destLabel: string, address: string) => {
    setExitPickerOpen(false);
    setExitStarting(true);
    try {
      Alert.alert(
        'Emergency Exit',
        `Forces your VTXO capsules onto the Bitcoin chain. Funds arrive at your ${destLabel} after a ~24-hour wait set by Bitcoin. Once you start, this can't be cancelled.\n\n${address}\n\n` +
          'Cypher Box keeps the exit running in the background and removes this Ark wallet when the funds arrive.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => setExitStarting(false),
          },
          {
            text: 'Start exit',
            style: 'destructive',
            onPress: async () => {
              try {
                await startArkEmergencyExit();
                setArkExitDestinationAddress(address);
                setArkExitStartedAt(Date.now());
                setArkExitInProgress(true);
                // Activity log: read pending sats fresh — the exit just
                // moved every spendable VTXO into pending-exit state, so
                // pendingExitsTotalSats is the right "amount being
                // exited" number. correlationId persists across sync
                // cycles + app restarts so the auto-claim path in
                // useArkSync can match the started/finished pair.
                const correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
                setArkExitCorrelationId(correlationId);
                let exitSats = 0;
                try {
                  exitSats = await fetchPendingExitsTotalSats();
                } catch {
                  // non-fatal — emit the event with 0 if the read fails
                }
                recordEvent({
                  kind: 'ark-exit-started',
                  sats: exitSats,
                  correlationId,
                });
                SimpleToast.show(
                  'Emergency exit started — broadcasting on-chain. Funds will sweep automatically once the timelock expires.',
                  SimpleToast.LONG,
                );
              } catch (err: any) {
                console.warn('[Ark exit] start failed:', err);
                SimpleToast.show(
                  `Couldn't start exit: ${err?.message ?? 'unknown error'}`,
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
      SimpleToast.show("No Hot Vault connected.", SimpleToast.SHORT);
      return;
    }
    const list = deriveAddressList(walletID);
    if (list.length === 0) {
      SimpleToast.show("Couldn't derive any Hot Vault addresses.", SimpleToast.LONG);
      return;
    }
    setHotAddrs(list);
    setSelectedAddr(list[0]);
    setAddrListOpen(false);
    setPickerStep('hot-addr');
  };

  const enterColdAddrStep = () => {
    if (!coldStorageWalletID) {
      SimpleToast.show("No Cold Storage wallet connected.", SimpleToast.SHORT);
      return;
    }
    const list = deriveAddressList(coldStorageWalletID);
    if (list.length === 0) {
      SimpleToast.show("Couldn't derive any Cold Storage addresses.", SimpleToast.LONG);
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
    void startExitWithAddress('Hot Vault', selectedAddr);
  };

  const confirmColdAddr = () => {
    if (!selectedAddr) return;
    if (!hardwareVerified) {
      SimpleToast.show("Confirm you've verified the address on your hardware device first.", SimpleToast.LONG);
      return;
    }
    void startExitWithAddress('Cold Storage vault', selectedAddr);
  };

  const handlePickExternal = () => {
    const t = externalAddrInput.trim();
    if (!looksLikeBitcoinAddress(t)) {
      SimpleToast.show("That doesn't look like a valid Bitcoin address.", SimpleToast.SHORT);
      return;
    }
    void startExitWithAddress('external Bitcoin address', t);
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
  const [keepSeedOnDevice, setKeepSeedOnDevice] = useState(true);

  const biometricLabel = Platform.OS === 'ios' ? 'Face ID' : 'Touch ID';

  const handleDeleteVault = () => {
    if (deleting) return;
    setKeepSeedOnDevice(true);
    setDeleteModalVisible(true);
  };

  const confirmDeleteVault = async () => {
    setDeleteModalVisible(false);
    setDeleting(true);
    try {
      await resetArkWalletState({ keepSeedInKeychain: keepSeedOnDevice });
      if (typeof clearArkAuth === 'function') {
        clearArkAuth();
      }
      SimpleToast.show(
        keepSeedOnDevice
          ? "Ark vault deleted. Seed kept on device for biometric recovery."
          : "Ark vault deleted from this device.",
        SimpleToast.LONG,
      );
      setTimeout(() => navigation.goBack(), 300);
    } catch (err: any) {
      console.warn('[Ark] Delete vault failed:', err);
      SimpleToast.show(
        `Delete failed: ${err?.message ?? "unknown error"}`,
        SimpleToast.LONG,
      );
      setDeleting(false);
    }
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={{ paddingBottom: 40 }}>
      <RNAnimated.View style={[styles.main, { paddingHorizontal: 24 }]}>
      {view === 'backup' && (<>
        <View style={{ marginTop: 24 }}>
          <Text bold style={{ fontSize: 16, color: colors.ark?.light ?? colors.pink.default, marginBottom: 8 }}>
            Seed Phrase (1/2)
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
              Write these 12 words on paper and store them somewhere safe. We cannot recover them for you.
            </Text>
            <Text bold style={{ fontSize: 13, color: '#FF7A68', marginBottom: 12 }}>
              You also need the Bark backup file (2/2) below to recover your funds. The seed alone is not enough.
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
                  <Text bold style={{ fontSize: 13, color: '#AAA' }}>Hide</Text>
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
                  <Text bold style={{ fontSize: 15, color: '#000' }}>Show seed phrase</Text>
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
            Bark backup file (2/2)
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
                - iCloud Drive is on — dismiss: auto-validates via the
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
                ⚠ Re-export backup after every receive
              </Text>
              <Text style={{ fontSize: 12, color: colors.white, lineHeight: 17 }}>
                When you created this wallet, you saved a one-time snapshot of the encrypted backup file. That file doesn't auto-update unless iCloud Drive is on for Cypher Box. Tap "Re-export now" after every Lightning receive — or enable iCloud Drive for Cypher Box and this reminder will go away.
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
                      Re-export now
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
                    How to enable iCloud Drive
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
                    iCloud Drive is on — dismiss
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
            You also need your seed phrase (1/2) above. The Bark backup file alone is not enough.
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
                <Text style={{ fontSize: 15, color: '#AAA' }}>Local copy (on-device)</Text>
                {localBackup === null ? (
                  <ActivityIndicator size="small" color="#888" />
                ) : localBackup === undefined ? (
                  <Text bold style={{ fontSize: 13, color: '#E85C5A' }}>Not yet</Text>
                ) : (
                  <Text bold style={{ fontSize: 13, color: colors.green }}>{formatAgo(localBackup.modifiedAt)}</Text>
                )}
              </View>
              {localBackup && (
                <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                  {`${formatSize(localBackup.sizeBytes)} · ark-backup.cbark`}
                </Text>
              )}
              <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                {Platform.OS === 'ios'
                  ? 'Files → On My iPhone → Cypher Box'
                  : 'Inside the app\'s private storage'}
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
                <Text style={{ fontSize: 15, color: '#AAA' }}>{Platform.OS === 'ios' ? 'iCloud Drive copy' : 'Google Drive copy'}</Text>
                {Platform.OS === 'ios' ? (
                  iCloudAvailable === null ? (
                    <ActivityIndicator size="small" color="#888" />
                  ) : !iCloudAvailable ? (
                    <Text bold style={{ fontSize: 13, color: '#888' }}>Off for Cypher Box</Text>
                  ) : iCloudBackup === null ? (
                    <ActivityIndicator size="small" color="#888" />
                  ) : iCloudBackup === undefined ? (
                    <Text bold style={{ fontSize: 13, color: '#E85C5A' }}>No copy yet</Text>
                  ) : (
                    <Text bold style={{ fontSize: 13, color: colors.green }}>{formatAgo(iCloudBackup.modifiedAt)}</Text>
                  )
                ) : driveConnected === null ? (
                  <ActivityIndicator size="small" color="#888" />
                ) : !driveConnected ? (
                  <Text bold style={{ fontSize: 13, color: '#888' }}>Not connected</Text>
                ) : driveBackup === null ? (
                  <ActivityIndicator size="small" color="#888" />
                ) : driveBackup === undefined ? (
                  <Text bold style={{ fontSize: 13, color: '#E85C5A' }}>No copy yet</Text>
                ) : (
                  <Text bold style={{ fontSize: 13, color: colors.green }}>{formatAgo(driveBackup.modifiedAt)}</Text>
                )}
              </View>
              {Platform.OS === 'ios' && iCloudBackup && (
                <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                  {`${formatSize(iCloudBackup.sizeBytes)} · ark-backup.cbark`}
                </Text>
              )}
              {Platform.OS === 'ios' && (
                <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                  Files → iCloud Drive → Cypher Box
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
                      {iCloudAvailable ? '✓ iCloud Drive enabled' : 'How to enable iCloud Drive'}
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
                      {driveConnected ? 'Disconnect' : 'Connect Google Drive'}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

          </View>
        </View>

      </>)}
      {view === 'actions' && (<>
        {/* Background VTXO refresh toggle + Emergency Exit + Delete Vault.
            Moved here from the Settings tab so day-to-day wallet operations
            sit next to the balance card. The Settings tab now only holds
            Seed Phrase + Ark backup file — true one-time setup. */}
        <View style={{ marginTop: 24 }}>
          <Text bold style={{ fontSize: 16, color: colors.ark?.light ?? colors.pink.default, marginBottom: 8 }}>
            Capsule expiry reminders
          </Text>
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
                Notify me before capsules expire
              </RNText>
              <Switch
                value={arkBgRefreshEnabled}
                onValueChange={handleToggleBgRefresh}
                disabled={togglingBgRefresh}
                trackColor={{ false: '#3a3a3a', true: colors.green }}
                thumbColor={colors.white}
              />
            </View>
            <Text
              style={{
                fontSize: 12,
                color: arkBgRefreshEnabled ? '#888' : colors.redLight,
                marginTop: 6,
                lineHeight: 16,
              }}
            >
              {arkBgRefreshEnabled
                ? 'Cypher Box sends 5 reminders before any capsule expires (4 days, 2 days, 24 hours, 12 hours, and 6 hours before). Tap a reminder to open Cypher Box and refresh automatically. Without a refresh, expired capsules cannot be recovered.'
                : '⚠ Reminders are OFF. You must open Cypher Box yourself and refresh capsules before they expire. Expired capsules cannot be recovered.'}
            </Text>

            {/* Battery-exemption banner. Shows on Android whenever the app is
                NOT battery-exempt (i.e. not set to Unrestricted), regardless of
                the auto-refresh toggle, because the battery setting also gates
                the scheduled expiry-warning notifications. Hidden once the
                probe reads "exempt" (Unrestricted). */}
            {batteryNotExempt === true && (
              <TouchableOpacity
                onPress={() => {
                  // Deep-link to this app's own settings page
                  // (Settings > Apps > Cypher Box), where the user reaches
                  // Battery > Unrestricted. Linking.openSettings() opens
                  // ACTION_APPLICATION_DETAILS_SETTINGS, which is universal
                  // across Android versions/OEMs. (The native
                  // openBatteryOptimizationSettings landed on the generic
                  // battery-optimisation allow-list, not this app's Battery
                  // screen, which is what we actually want the user on.)
                  Linking.openSettings().catch((err) => {
                    console.warn('[Ark bg refresh banner] open settings failed:', err);
                  });
                }}
                style={{
                  marginTop: 10,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor: 'rgba(251, 146, 60, 0.12)',
                  borderWidth: 1,
                  borderColor: 'rgba(251, 146, 60, 0.45)',
                }}
              >
                <Text bold style={{ fontSize: 12, color: '#FB923C', marginBottom: 3 }}>
                  ⚠ Set Cypher Box battery to Unrestricted
                </Text>
                <Text style={{ fontSize: 11, color: colors.white, lineHeight: 16 }}>
                  Auto-refresh and capsule expiry alerts may not run reliably while battery optimisation is on. Tap here to open Cypher Box settings, then choose Battery and set it to Unrestricted.
                </Text>
              </TouchableOpacity>
            )}

            {/* DEV-only: fire a synthetic expiry-warning notification 5s
                from now so the tap-refresh deep-link path can be exercised
                without waiting for a real alarm. The fake vtxoId doesn't
                need to map to a real VTXO; ArkCapsules' auto-effect
                recomputes the imminent set from arkVtxos on arrival, so the
                refresh runs against the user's real capsules. Stripped
                from production via __DEV__. */}
            {__DEV__ && (
              <TouchableOpacity
                onPress={async () => {
                  try {
                    // react-native-push-notification ships a CJS module.exports
                    // (no default export), so require() returns the module
                    // object directly. Don't tag `.default` here.
                    const PushNotification = require('react-native-push-notification');
                    const { ensureBgNotificationPermission } = require('@Cypher/services/ark');
                    await ensureBgNotificationPermission();
                    // Title/body deliberately mirror the live 24h warning so
                    // QA on this button reflects what production users see.
                    // The "1,234 sats" amount is illustrative; the tap-effect
                    // in ArkCapsules recomputes the imminent set from real
                    // VTXOs regardless of this string.
                    PushNotification.localNotificationSchedule({
                      id: '999999',
                      channelId: 'ark-bg-refresh',
                      title: '24 hours left to refresh 1,234 sats ⚠️',
                      message: 'Tap to refresh. Refresh takes up to an hour.',
                      date: new Date(Date.now() + 5000),
                      priority: 'high',
                      importance: 'high',
                      playSound: true,
                      soundName: 'default',
                      userInfo: { source: 'ark-vtxo-expiry-warn24h', vtxoId: '__test__' },
                      allowWhileIdle: true,
                    });
                    SimpleToast.show('Test notification scheduled (5s). Lock screen or background app to see it.', SimpleToast.LONG);
                  } catch (err: any) {
                    SimpleToast.show(`Test notification failed: ${err?.message ?? err}`, SimpleToast.LONG);
                  }
                }}
                style={{
                  marginTop: 10,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor: 'rgba(96, 165, 250, 0.15)',
                  borderWidth: 1,
                  borderColor: 'rgba(96, 165, 250, 0.45)',
                  alignSelf: 'flex-start',
                }}
              >
                <Text style={{ fontSize: 12, color: '#60a5fa' }}>
                  [DEV] Fire test notification in 5s
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Exit-in-progress status panel replaces both action buttons.
            Shows a single source of truth for what's happening + the
            destination the user picked. Auto-claim + auto-delete run from
            useArkSync, so there's nothing for the user to tap here. */}
        {arkExitInProgress ? (
          <View style={{ marginTop: 30, alignSelf: 'center', width: widths * 0.85, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: colors.redLight }}>
            <Text bold style={{ fontSize: 15, color: colors.redLight, marginBottom: 8 }}>
              Emergency exit in progress
            </Text>
            <Text style={{ fontSize: 13, color: '#DDD', marginBottom: 6 }}>
              {pendingExitSats == null
                ? 'Broadcasting exit transactions…'
                : `${pendingExitSats.toLocaleString()} sats pending exit. Funds sweep automatically once the ~24h CSV timelock expires.`}
            </Text>
            {arkExitDestinationAddress && (
              <Text style={{ fontSize: 12, color: '#888' }} numberOfLines={1}>
                → {arkExitDestinationAddress}
              </Text>
            )}
            {arkExitStartedAt && (
              <Text style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                Started {new Date(arkExitStartedAt).toLocaleString()}. This vault auto-deletes when the sweep completes.
              </Text>
            )}
          </View>
        ) : (
          <>
            {/* Emergency Exit — sits ABOVE Delete Ark vault. Yellow text
                rather than red so users don't conflate it with the
                irreversible "Delete vault" path; the Alert in
                startExitWithAddress carries the full warning. */}
            <GradientView
              style={{ marginTop: 30, alignSelf: 'center', height: 38, width: widths * 0.5, shadowColor: '#040404', shadowOffset: { width: 8, height: 8 }, shadowOpacity: 0.8, shadowRadius: 16, elevation: 8 }}
              linearGradientStyle={{ shadowColor: '#27272C', shadowOffset: { width: -8, height: -8 }, shadowOpacity: 0.48, shadowRadius: 12, elevation: 8 }}
              topShadowStyle={{ shadowOffset: { width: 2, height: 2 }, shadowRadius: 2, shadowColor: colors.ark?.shadowTopNew ?? '#E85C5A', borderRadius: 24, height: 38, width: widths * 0.5, justifyContent: 'center', alignItems: 'center' }}
              bottomShadowStyle={{ shadowOffset: { width: -2, height: -2 }, shadowRadius: 2, shadowOpacity: 1, shadowColor: '#030303', borderRadius: 24, height: 38, width: widths * 0.5, justifyContent: 'center', position: 'absolute' }}
              linearGradientStyleMain={{ borderRadius: 24, height: 38, width: widths * 0.5, justifyContent: 'center', alignItems: 'center' }}
              onPress={exitStarting ? undefined : () => setExitPickerOpen(true)}
            >
              <Text h3 bold center style={{ color: colors.ark?.light ?? colors.pink.default }}>
                {exitStarting ? 'Starting exit…' : 'Emergency Exit'}
              </Text>
            </GradientView>

            {/* Caption row: short summary + circular "?" toggle that
                expands an inline note explaining all the cases where
                Emergency Exit is the right tool (server down, censored,
                shutdown, compromise). Matches the ?-button pattern used
                on the vault Capsules screen (HotStorageVault/Capsules.tsx). */}
            <View style={{ marginTop: 8, paddingHorizontal: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 11, color: '#888', textAlign: 'center', flexShrink: 1 }}>
                  Eject from Ark: sweep your Ark balance back on-chain without ASP cooperation.
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
                      When to use Emergency Exit
                    </Text>
                    {'\n\n'}
                    Normal sends, swaps and refreshes all go through the Ark server (Second.tech). Emergency Exit is the trustless fallback that doesn't need the server — it broadcasts pre-signed exit transactions directly to the Bitcoin chain.
                    {'\n\n'}
                    Use it when:
                    {'\n'}
                    • The Ark server is down or unreachable for an extended period
                    {'\n'}
                    • The server refuses your transactions (regulatory pressure, censorship, or a server-side bug blocking specific capsules)
                    {'\n'}
                    • The server is going out of business or has shut down
                    {'\n'}
                    • News breaks of a server-side compromise and you want out fast without waiting for cooperative paths
                    {'\n\n'}
                    Emergency Exit moves funds on-chain (slower, higher fee) so it's the break-glass option, not the everyday one. In normal use prefer swap or refresh — same destinations, faster, cheaper.
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
              onPress={deleting ? undefined : handleDeleteVault}
            >
              <Text h3 bold center style={{ color: colors.redLight }}>
                {deleting ? 'Deleting…' : 'Delete Ark vault'}
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
                    ← Back
                  </Text>
                </TouchableOpacity>
              )}

              {pickerStep === 'category' && (
                <>
                  <Text bold style={{ fontSize: 17, color: '#FFF', marginBottom: 6 }}>
                    Where should funds go?
                  </Text>
                  <Text style={{ fontSize: 13, color: '#AAA', marginBottom: 14 }}>
                    Pick a destination for your on-chain payout. The exit takes
                    ~24h to clear the protocol timelock — the address can't be
                    changed after you start.
                  </Text>

                  <TouchableOpacity
                    onPress={enterHotAddrStep}
                    disabled={!walletID}
                    style={{ paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: '#333', opacity: walletID ? 1 : 0.5 }}
                  >
                    <Text bold style={{ fontSize: 15, color: '#FFF' }}>Hot Vault</Text>
                    <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                      {walletID
                        ? 'Pick a default or specific Hot Vault address.'
                        : 'No Hot Vault connected.'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={enterColdAddrStep}
                    disabled={!coldStorageWalletID}
                    style={{ paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: '#333', opacity: coldStorageWalletID ? 1 : 0.5 }}
                  >
                    <Text bold style={{ fontSize: 15, color: '#FFF' }}>Cold Storage vault</Text>
                    <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                      {coldStorageWalletID
                        ? 'Pick a default or specific Cold Storage address (hardware verification required).'
                        : 'No Cold Storage wallet connected.'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setPickerStep('external')}
                    style={{ paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: '#333' }}
                  >
                    <Text bold style={{ fontSize: 15, color: '#FFF' }}>External Bitcoin address</Text>
                    <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                      Paste any Bitcoin address.
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {(pickerStep === 'hot-addr' || pickerStep === 'cold-addr') && (
                <>
                  <Text bold style={{ fontSize: 17, color: '#FFF', marginBottom: 10 }}>
                    {pickerStep === 'hot-addr'
                      ? (addrListOpen ? 'Pick a Hot Vault address' : 'Hot Vault — destination')
                      : (addrListOpen ? 'Pick a Cold Storage address' : 'Cold Storage — destination')}
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
                            SimpleToast.show('Address copied', SimpleToast.SHORT);
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
                          Choose another address
                        </Text>
                      </TouchableOpacity>

                      {pickerStep === 'cold-addr' && (
                        <View style={{ padding: 10, borderRadius: 8, backgroundColor: 'rgba(232, 92, 90, 0.08)', borderWidth: 1, borderColor: colors.redLight, marginBottom: 4 }}>
                          <Text style={{ fontSize: 12, color: '#FFF', marginBottom: 8 }}>
                            ⚠️ DO NOT proceed without verifying the selected
                            address on your hardware device. Confirm
                            character-by-character that the address above
                            matches what your device displays.
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
                              I have verified this address on my hardware device.
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
                          Send to this address
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
                        Default (top) is a fresh address. Earlier addresses are
                        listed below in case you want to send to one you've
                        used before.
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
                                {idx === 0 ? 'Default (new address)' : `Previously derived #${idx}`}
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
                          ← Back to selected address
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </>
              )}

              {pickerStep === 'external' && (
                <>
                  <Text bold style={{ fontSize: 17, color: '#FFF', marginBottom: 6 }}>
                    External Bitcoin address
                  </Text>
                  <Text style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
                    Paste any Bitcoin address. The CSV timelock can't be undone,
                    so triple-check before you start.
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
                      Send to this address
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity
                onPress={() => setExitPickerOpen(false)}
                style={{ marginTop: 14, paddingVertical: 10, alignItems: 'center' }}
              >
                <Text bold style={{ fontSize: 14, color: '#AAA' }}>Cancel</Text>
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
                Delete Ark vault?
              </Text>
              <Text style={{ fontSize: 13, color: '#CCC', lineHeight: 19, marginBottom: 16 }}>
                This wipes your Ark wallet from this device — the local
                database with your VTXO capsules. To restore funds you'll
                still need your{' '}
                <Text bold style={{ color: '#FFF' }}>ark-backup file</Text>.
              </Text>

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
                  Keep seedphrase stored on device for future {biometricLabel} recovery
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
                    ⚠ Make sure you have your 12-word seed phrase
                  </Text>
                  <Text style={{ color: '#FF9A9A', fontSize: 12, lineHeight: 16 }}>
                    Without the seed AND your ark-backup file, this wallet's funds become unrecoverable.
                  </Text>
                </View>
              )}

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18, gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setDeleteModalVisible(false)}
                  style={{ paddingVertical: 10, paddingHorizontal: 16 }}
                >
                  <Text bold style={{ fontSize: 14, color: '#AAA' }}>Cancel</Text>
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
                  <Text bold style={{ fontSize: 14, color: '#FFB0B0' }}>Delete vault</Text>
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
