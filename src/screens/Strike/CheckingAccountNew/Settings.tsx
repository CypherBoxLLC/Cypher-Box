import Clipboard from "@react-native-clipboard/clipboard";
import QRCode from "react-native-qrcode-svg";

import { Copy, StrikeFull } from "@Cypher/assets/images";
import { GradientSwitch, Text } from "@Cypher/component-library";
import { ExitFundingSourceList, GradientView } from "@Cypher/components";
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
import { getStrikeProfile, getStrikeLimits, getBankPaymentMethods, revokeStrikeToken } from "@Cypher/api/strikeAPIs";
import {
  AUTO_BACKUP_PATH,
  computeArkExitPlan,
  computeExitFeeReserveSats,
  resolveExitReserveTarget,
  connectGoogleDrive,
  convertToExitFees,
  disconnectGoogleDrive,
  describeExitExclusion,
  estimateExitFeeConvert,
  estimateArkOnchainRecover,
  recoverArkOnchainBoard,
  fetchArkExitVtxos,
  fetchPendingExitsTotalSats,
  findAutoBackupForRecovery,
  getArkOnchainAddress,
  getAutoBackupPath,
  getCachedArkBackupFingerprint,
  getDriveBackupInfo,
  getICloudBackupPath,
  getICloudBackupPathForFingerprint,
  getLastLocalBackupNote,
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
import type { ExitFeeConvertEstimate, ExitTriageResult } from "@Cypher/services/ark";
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
          {renderSection('Account', <>
            {renderRow('Lightning Address', strikeMe?.handle ? `${strikeMe.handle}@coinos.io` : 'N/A')}
          </>)}
          <GradientView
            style={{ marginTop: 40, alignSelf: 'center', height: 38, width: widths * 0.26, shadowColor: '#040404', shadowOffset: { width: 8, height: 8 }, shadowOpacity: 0.8, shadowRadius: 16, elevation: 8 }}
            linearGradientStyle={{ shadowColor: '#27272C', shadowOffset: { width: -8, height: -8 }, shadowOpacity: 0.48, shadowRadius: 12, elevation: 8 }}
            topShadowStyle={{ shadowOffset: { width: 2, height: 2 }, shadowRadius: 2, shadowColor: '#E85C5A', borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', alignItems: 'center' }}
            bottomShadowStyle={{ shadowOffset: { width: -2, height: -2 }, shadowRadius: 2, shadowOpacity: 1, shadowColor: '#030303', borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', position: 'absolute' }}
            linearGradientStyleMain={{ borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', alignItems: 'center' }}
            onPress={handleCoinosLogout}
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
    isAuth,
    isStrikeAuth,
    walletID,
    coldStorageWalletID,
    arkBalanceDetail,
    arkExitInProgress,
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
        SimpleToast.show("Reminders enabled", SimpleToast.SHORT);
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
  const [exitFundingOpen, setExitFundingOpen] = useState(false);
  const [fundingTab, setFundingTab] = useState<'receive' | 'wallet' | 'convert'>('receive');
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
  const exitFeeShortfallSats = Math.max(0, reserveTargetSats - onchainReserveSats);
  // The user armed a target below the recommended safe amount (warn them).
  const reserveBelowRecommended =
    (arkExitFeeReserveSats ?? 0) > 0 &&
    (recommendedReserveSats ?? 0) > 0 &&
    arkExitFeeReserveSats < (recommendedReserveSats ?? 0);

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
        const activeSats = vtxos
          .filter((v) => isActiveExit(v))
          .reduce((acc, v) => acc + Number(v.amountSats), 0);
        if (!cancelled) setPendingExitSats(Math.max(activeSats, pendingTotal));
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

  // Convert is unavailable mid-exit (cooperative offboard, ASP-gated), and its
  // tab button disappears. If that was the selected tab the sheet would render
  // nothing at all, so fall back to the path that always works.
  useEffect(() => {
    if (arkExitInProgress && fundingTab === 'convert') setFundingTab('receive');
  }, [arkExitInProgress, fundingTab]);

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
    setFundingTab('receive');
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
      Alert.alert('No Hot Vault found', 'Open or create your Hot Vault first, then try again.');
      return;
    }
    let est;
    try {
      est = await estimateArkOnchainRecover(onchainReserveSats);
    } catch {
      Alert.alert('Release unavailable', 'Could not read the on-chain balance right now. Check your connection and try again.');
      return;
    }
    if (est.confirmedSats <= 0) {
      SimpleToast.show('Nothing to release right now.', SimpleToast.SHORT);
      return;
    }
    if (!est.economical) {
      Alert.alert('Too small to release', 'The network fee would be larger than the amount, so recovering it on-chain would cost more than it returns.');
      return;
    }
    let destAddress: string;
    try {
      destAddress = hotVault._getInternalAddressByIndex(hotVault.getNextFreeChangeAddressIndex());
    } catch {
      Alert.alert('No Hot Vault address', 'Could not derive a Hot Vault address to release to.');
      return;
    }
    if (!destAddress) {
      Alert.alert('No Hot Vault address', 'Could not derive a Hot Vault address to release to.');
      return;
    }
    Alert.alert(
      'Release on-chain funds',
      `Send ${est.recoverableSats.toLocaleString()} sats back to your Hot Vault? This is an on-chain transaction; the network fee is about ${est.feeSats.toLocaleString()} sats.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Release',
          onPress: async () => {
            try {
              const res = await recoverArkOnchainBoard(destAddress, est.confirmedSats, est.feeRateSatPerVb);
              setArkExitFeeReserveSats(0);
              if (res.status === 'already-cleared') {
                Alert.alert('Nothing to release', 'These funds already cleared.');
              } else {
                Alert.alert('Release sent', `${res.sentSats.toLocaleString()} sats are on the way to your Hot Vault. They will appear there as a pending transaction.`);
              }
            } catch (e: any) {
              Alert.alert('Release failed', String(e?.message || '') || 'The transaction could not be sent. Your funds are unchanged.');
            }
          },
        },
      ],
    );
  };

  const doConvertToExitFees = async () => {
    const amt = parseInt(convertAmount, 10);
    if (!Number.isFinite(amt) || amt <= 0) {
      SimpleToast.show('Enter an amount to convert.', SimpleToast.SHORT);
      return;
    }
    if (aspReachable === false) {
      SimpleToast.show('Ark server unreachable. Use Receive Bitcoin instead.', SimpleToast.LONG);
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
        'Converting to on-chain fee funds. Emergency Exit unlocks once it confirms.',
        SimpleToast.LONG,
      );
    } catch (e: any) {
      Alert.alert(
        'Could not convert',
        String(e?.message || '') || 'The offboard failed. Your Ark funds are unchanged.',
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

  const startExitWithAddress = async (destLabel: string, address: string) => {
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
      plan = await computeArkExitPlan();
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
        'Emergency Exit',
        "Couldn't read your capsules just now, so the exit wasn't started. Try again in a moment.",
      );
      return;
    }

    // Nothing survived triage. Say why rather than starting an exit that would
    // spend the reserve and return nothing.
    if (plan.selectedIds.length === 0) {
      setExitStarting(false);
      Alert.alert(
        'Emergency Exit',
        plan.excluded.length === 0
          ? 'There are no capsules to exit.'
          : `None of your ${plan.excluded.length} capsule${plan.excluded.length === 1 ? '' : 's'} can be recovered by an emergency exit right now:\n\n` +
            plan.excluded
              .map(
                (e) =>
                  `${e.sats.toLocaleString()} sats: ${describeExitExclusion(e.reason)}`,
              )
              .join('\n') +
            '\n\nThey stay in your vault and stay spendable.',
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
        ? `${plan.excluded.length} capsule${plan.excluded.length === 1 ? '' : 's'} holding ${plan.excludedSats.toLocaleString()} sats will NOT be exited:\n` +
          plan.excluded
            .map(
              (e) =>
                `  ${e.sats.toLocaleString()} sats: ${describeExitExclusion(e.reason)}`,
            )
            .join('\n') +
          '\n\nThey stay in your vault and stay spendable. Sending them, or combining them, recovers more than an exit would.\n\n'
        : '';

    // Principle: never silently spend more than the funds are worth. The
    // reserve sits next to what comes back, so a reserve larger than the value
    // is impossible to miss.
    const costNotice = `Exiting ${plan.selected.length} capsule${plan.selected.length === 1 ? '' : 's'} holding ${plan.selectedSats.toLocaleString()} sats. About ${plan.netRecoverableSats.toLocaleString()} sats reach your address, and it needs about ${plan.reserveSats.toLocaleString()} sats of on-chain miner fees to get there.\n\n`;

    const shortfall = Math.max(0, freshRecommended - onchainReserveSats);
    const underfunded = freshRecommended > 0 && shortfall > 0;
    const underfundedPrefix = underfunded
      ? `Your on-chain fee wallet holds ${onchainReserveSats.toLocaleString()} sats of about ${freshRecommended.toLocaleString()} needed for miner fees. Add about ${shortfall.toLocaleString()} sats more, or the exit may stall until you top up during the wait.\n\n`
      : '';
    try {
      Alert.alert(
        'Emergency Exit',
        exclusionNotice +
          costNotice +
          underfundedPrefix +
          `Forces your VTXO capsules onto the Bitcoin chain. Funds arrive at your ${destLabel} after a ~24-hour wait set by Bitcoin. Once you start, this can't be cancelled.\n\n` +
          'Only start this if your soonest capsule is at least 1 day from expiry. The exit txs must confirm on-chain before then, so it is not a last-minute rescue.\n\n' +
          `${address}\n\n` +
          'Cypher Box keeps the exit running in the background and sweeps the funds to this address when the timelock expires. The vault stays afterwards.',
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
                await startArkEmergencyExit(exitPlan.selectedIds);
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
                  'Emergency exit started — broadcasting on-chain. Funds will sweep automatically once the timelock expires.',
                  SimpleToast.LONG,
                );
              } catch (err: any) {
                console.warn('[Ark exit] start failed:', 'tag=', err?.tag, 'inner=', err?.inner?.errorMessage ?? err?.inner?.message, 'message=', err?.message ?? String(err));
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
          "Couldn't read your seed to back up first, so delete was cancelled. Your funds are untouched.",
          SimpleToast.LONG,
        );
        setDeleting(false);
        return;
      }
      try {
        const verified = await writeAndVerifyArkBackup(mnemonic);
        if (!verified.local.ok) {
          SimpleToast.show(
            `Couldn't write a verified backup (${verified.local.error}), so delete was cancelled. Your funds are untouched.`,
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
          `Couldn't create a backup to protect your funds, so delete was cancelled: ${backupErr?.message ?? "unknown error"}`,
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
          ? "Backup verified. Ark vault deleted. Seed kept on device for biometric recovery."
          : "Backup verified. Ark vault deleted from this device.",
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
                  {`${formatSize(localBackup.sizeBytes)} · ${localBackup.filename ?? 'ark-backup.cbark'}`}
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
                  {`${formatSize(iCloudBackup.sizeBytes)} · ${iCloudBackup.filename ?? 'ark-backup.cbark'}`}
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
                ? 'Cypher Box sends 5 reminders before any capsule expires (4 days, 2 days, 24 hours, 12 hours, and 6 hours before). Without a refresh, recovery is not guaranteed once a capsule expires.'
                : '⚠ Reminders are OFF. You must open Cypher Box yourself and refresh capsules before they expire. Once a capsule expires, recovery is not guaranteed.'}
            </Text>

          </View>
        </View>

        {/* Exit-in-progress status panel replaces both action buttons.
            Shows a single source of truth for what's happening + the
            destination the user picked. Auto-claim runs from useArkSync,
            so there's nothing for the user to tap here. */}
        {arkExitInProgress ? (
          <View style={{ marginTop: 30, alignSelf: 'center', width: widths * 0.85, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: colors.redLight }}>
            <Text bold style={{ fontSize: 15, color: colors.redLight, marginBottom: 8 }}>
              Emergency exit in progress
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
                return shownSats == null || shownSats <= 0
                  ? 'Broadcasting exit transactions…'
                  : `${shownSats.toLocaleString()} sats pending exit. Funds sweep automatically once the ~24h CSV timelock expires.`;
              })()}
            </Text>
            {arkExitDestinationAddress && (
              <Text style={{ fontSize: 12, color: '#888' }} numberOfLines={1}>
                → {arkExitDestinationAddress}
              </Text>
            )}
            {arkExitStartedAt && (
              <Text style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                Started {new Date(arkExitStartedAt).toLocaleString()}. Funds sweep to the destination when the timelock expires; the vault stays afterwards.
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
                <Text style={{ fontSize: 12, color: '#AAA' }}>Fee reserve on-chain</Text>
                <Text bold style={{ fontSize: 13, color: onchainReserveSats > 0 ? colors.green : '#FFD54F' }}>
                  {onchainReserveSats.toLocaleString()} sats
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: '#777', marginTop: 6, lineHeight: 15 }}>
                Pays the miner fees for each capsule's exit and claim. If it runs
                out, the remaining capsules wait until you top it up.
              </Text>
              <TouchableOpacity
                onPress={() => setExitFundingOpen(true)}
                activeOpacity={0.7}
                style={{ marginTop: 10, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)' }}
              >
                <Text bold style={{ fontSize: 13, color: '#FFF' }}>Top up exit fees</Text>
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
              style={{ marginTop: 30, alignSelf: 'center', height: 38, width: widths * 0.5, shadowColor: '#040404', shadowOffset: { width: 8, height: 8 }, shadowOpacity: 0.8, shadowRadius: 16, elevation: 8, opacity: (exitStarting || recommendedReserveSats === null || exitFeeGated) ? 0.45 : 1 }}
              linearGradientStyle={{ shadowColor: '#27272C', shadowOffset: { width: -8, height: -8 }, shadowOpacity: 0.48, shadowRadius: 12, elevation: 8 }}
              topShadowStyle={{ shadowOffset: { width: 2, height: 2 }, shadowRadius: 2, shadowColor: colors.ark?.shadowTopNew ?? '#E85C5A', borderRadius: 24, height: 38, width: widths * 0.5, justifyContent: 'center', alignItems: 'center' }}
              bottomShadowStyle={{ shadowOffset: { width: -2, height: -2 }, shadowRadius: 2, shadowOpacity: 1, shadowColor: '#030303', borderRadius: 24, height: 38, width: widths * 0.5, justifyContent: 'center', position: 'absolute' }}
              linearGradientStyleMain={{ borderRadius: 24, height: 38, width: widths * 0.5, justifyContent: 'center', alignItems: 'center' }}
              onPress={(exitStarting || recommendedReserveSats === null || exitFeeGated) ? undefined : () => setExitPickerOpen(true)}
            >
              <Text h3 bold center style={{ color: colors.ark?.light ?? colors.pink.default }}>
                {exitStarting
                  ? 'Starting exit…'
                  : recommendedReserveSats === null
                    ? 'Checking exit fees…'
                    : 'Emergency Exit'}
              </Text>
            </GradientView>

            {/* Fee-funding gate: on-chain fee wallet is short. Explain, offer
                "Fund exit fees", and a low-emphasis break-glass to start anyway
                (progressExits resumes once fees are added). */}
            {exitFeeGated && onchainReserveSats <= 0 && (
              <View style={{ marginTop: 12, marginHorizontal: 24, padding: 12, borderRadius: 10, backgroundColor: 'rgba(255, 200, 80, 0.06)', borderWidth: 1, borderColor: 'rgba(255, 200, 80, 0.30)' }}>
                <Text bold style={{ fontSize: 13, color: '#FFD54F', marginBottom: 6 }}>
                  Fund exit fees first
                </Text>
                <Text style={{ fontSize: 12, color: '#CCC', lineHeight: 17 }}>
                  Emergency Exit pays Bitcoin miner fees from a separate on-chain wallet that holds {onchainReserveSats.toLocaleString()} sats. Add about {exitFeeShortfallSats.toLocaleString()} sats more so the exit can broadcast and confirm. Without it the exit will stall.
                </Text>
                <TouchableOpacity
                  onPress={openExitFunding}
                  style={{ marginTop: 10, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#FFD54F' }}
                >
                  <Text bold style={{ fontSize: 13, color: '#1C1C1C' }}>
                    Fund exit fees
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
                      Start exit anyway
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
                  {(arkExitFeeReserveSats ?? 0) > 0 ? 'Exit fees ready' : 'On-chain funds'}
                </Text>
                <Text style={{ fontSize: 12, color: '#CCC', lineHeight: 17 }}>
                  {(arkExitFeeReserveSats ?? 0) > 0
                    ? `${onchainReserveSats.toLocaleString()} sats are reserved on-chain to pay Emergency Exit fees. Start the exit at least 1 day before your soonest capsule expires. It unrolls on-chain and needs time to confirm, so it is not a last-minute rescue.`
                    : `${onchainReserveSats.toLocaleString()} sats are sitting in your on-chain wallet. Reserve them to pay Emergency Exit fees, add more, or release them back to your Hot Vault.`}
                </Text>
                {(arkExitFeeReserveSats ?? 0) > 0 && reserveBelowRecommended && (
                  <Text style={{ fontSize: 11, color: '#FFD54F', marginTop: 8, lineHeight: 15 }}>
                    You reserved less than the recommended {(recommendedReserveSats ?? 0).toLocaleString()} sats. A fee spike could stall the exit.
                  </Text>
                )}
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                  {(arkExitFeeReserveSats ?? 0) <= 0 && (
                    <TouchableOpacity
                      onPress={() => { setArkExitFeeReserveSats(onchainReserveSats); SimpleToast.show('Reserved for exit fees.', SimpleToast.SHORT); }}
                      style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', backgroundColor: '#FFD54F', marginRight: 8 }}
                    >
                      <Text bold style={{ fontSize: 12, color: '#1C1C1C' }}>Reserve as exit fee</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={openExitFunding}
                    style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.green, marginRight: 8 }}
                  >
                    <Text bold style={{ fontSize: 12, color: colors.green }}>Add more</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={doRecoverOnchain}
                    style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#888' }}
                  >
                    <Text bold style={{ fontSize: 12, color: '#AAA' }}>Release</Text>
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
                      Start exit anyway
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

        {/* Fund-exit-fees modal. Tops up the on-chain (BDK) wallet that pays
            the unilateral-exit CPFP fees. Two paths:
              Receive Bitcoin (primary, ASP-independent): deposit external BTC
                to the on-chain address; the armed reserve keeps it on-chain
                (sync.ts won't board it away) and the gate unlocks on confirm.
              Convert from balance (secondary, precautionary): cooperative
                offboard from Ark. Needs the ASP, so disabled when unreachable;
                do it ahead of time, not as an at-outage rescue. */}
        <Modal
          visible={exitFundingOpen}
          transparent
          animationType="fade"
          onRequestClose={() => !fundingBusy && setExitFundingOpen(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 24 }}>
            <View style={{ backgroundColor: '#1a1a1a', borderRadius: 14, padding: 18, borderWidth: 1, borderColor: colors.ark?.light ?? colors.pink.default }}>
              <Text bold style={{ fontSize: 17, color: '#FFF', marginBottom: 4 }}>
                Fund exit fees
              </Text>
              <Text style={{ fontSize: 12, color: '#AAA', marginBottom: 12, lineHeight: 17 }}>
                Emergency Exit needs on-chain sats to pay Bitcoin miner fees. On-chain now: {onchainReserveSats.toLocaleString()} of {reserveTargetSats.toLocaleString()} sats reserved.
              </Text>

              {/* Editable reserve target: hold more (bigger fee-spike buffer) or
                  less. Applied on blur; auto-board keeps exactly this much
                  on-chain and boards any surplus into the Ark balance. */}
              <Text style={{ fontSize: 12, color: '#FFF', marginBottom: 6 }}>Reserve for fees (sats)</Text>
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
                Recommended {(recommendedReserveSats ?? 0).toLocaleString()} sats. We keep this much on-chain; anything above it boards into your Ark balance.
              </Text>

              {/* Tab switch */}
              <View style={{ flexDirection: 'row', marginBottom: 14, borderRadius: 10, backgroundColor: '#222', padding: 3 }}>
                {((arkExitInProgress
                  ? (['receive', 'wallet'] as const)
                  : (['receive', 'wallet', 'convert'] as const)) as readonly ('receive' | 'wallet' | 'convert')[]).map((tab) => {
                  const active = fundingTab === tab;
                  return (
                    <TouchableOpacity
                      key={tab}
                      onPress={() => setFundingTab(tab)}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: active ? (colors.ark?.light ?? colors.pink.default) : 'transparent' }}
                    >
                      <Text bold style={{ fontSize: 12, color: active ? '#1C1C1C' : '#AAA' }}>
                        {tab === 'receive'
                          ? 'Receive Bitcoin'
                          : tab === 'wallet'
                            ? 'From a wallet'
                            : 'Convert from balance'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {fundingTab === 'receive' && (
                <>
                  <Text style={{ fontSize: 12, color: '#CCC', marginBottom: 12, lineHeight: 17 }}>
                    Send at least {exitFeeShortfallSats.toLocaleString()} sats to this address. It stays on-chain to pay exit fees (it will not be moved into Ark).
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
                            SimpleToast.show('Address copied', SimpleToast.SHORT);
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
                        Emergency Exit unlocks automatically once the deposit confirms on-chain.
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
                    Send {exitFeeShortfallSats.toLocaleString()} sats on-chain from one of your
                    wallets. The address is filled in for you.
                  </Text>
                  {/* Sources that cannot be used are listed too, dimmed and with
                      a reason. Hiding them makes the feature look broken to
                      someone expecting their wallet to appear. */}
                  <ExitFundingSourceList
                    shortfallSats={exitFeeShortfallSats}
                    sources={buildExitFundingSources({
                      coinos: { connected: !!isAuth },
                      strike: { connected: !!isStrikeAuth },
                      hotVault: { walletID: walletID ?? null },
                      coldVault: { walletID: coldStorageWalletID ?? null },
                      shortfallSats: exitFeeShortfallSats,
                    })}
                    onSelect={(id) => {
                      // Only CoinOS has a provider today. The others stay in the
                      // list so the roadmap is visible, but must not pretend to
                      // work.
                      if (id !== 'coinos') {
                        SimpleToast.show('Coming soon for this wallet', SimpleToast.SHORT);
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
                    Move sats from your Ark balance to the on-chain fee wallet. This uses the Ark server, so do it ahead of time. It will not work if the server is down.
                  </Text>
                  {aspReachable === false && (
                    <View style={{ padding: 10, borderRadius: 8, backgroundColor: 'rgba(232, 92, 90, 0.08)', borderWidth: 1, borderColor: colors.redLight, marginBottom: 10 }}>
                      <Text style={{ fontSize: 12, color: '#FFF' }}>
                        Ark server unreachable. Use Receive Bitcoin instead.
                      </Text>
                    </View>
                  )}
                  <Text style={{ fontSize: 12, color: '#FFF', marginBottom: 6 }}>Amount (sats)</Text>
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
                      About {convertEst.netLandingSats.toLocaleString()} sats will land on-chain after a {convertEst.feeSats.toLocaleString()} sat fee.
                    </Text>
                  )}
                  <TouchableOpacity
                    onPress={doConvertToExitFees}
                    disabled={fundingBusy || aspReachable === false || !convertEst}
                    style={{ marginTop: 14, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: (fundingBusy || aspReachable === false || !convertEst) ? '#222' : (colors.ark?.light ?? colors.pink.default) }}
                  >
                    <Text bold style={{ fontSize: 13, color: (fundingBusy || aspReachable === false || !convertEst) ? '#666' : '#000' }}>
                      {fundingBusy ? 'Converting…' : 'Convert to exit fees'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity
                onPress={() => !fundingBusy && setExitFundingOpen(false)}
                style={{ marginTop: 14, paddingVertical: 10, alignItems: 'center' }}
              >
                <Text bold style={{ fontSize: 13, color: '#AAA' }}>
                  Close
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
