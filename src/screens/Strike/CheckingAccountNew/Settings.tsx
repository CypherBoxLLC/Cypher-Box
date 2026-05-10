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
  Image,
  Linking,
  Modal,
  Platform,
  Animated as RNAnimated,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import SimpleToast from "react-native-simple-toast";
import styles from "./styles";
import { getStrikeProfile, getStrikeLimits, getBankPaymentMethods } from "@Cypher/api/strikeAPIs";
import {
  AUTO_BACKUP_PATH,
  connectGoogleDrive,
  disconnectGoogleDrive,
  fetchPendingExitsTotalSats,
  getAutoBackupPath,
  getCachedArkBackupFingerprint,
  getDriveBackupInfo,
  isGoogleDriveConnected,
  readArkSeedPhrase,
  resetArkWalletState,
  startArkEmergencyExit,
  writeArkBackupToTempFile,
} from "@Cypher/services/ark";
import RNFS from "react-native-fs";
import Share from "react-native-share";
import { BlueStorageContext } from "../../../../blue_modules/storage-context";

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
function ArkSettingsBody() {
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
  const { wallets } = useContext(BlueStorageContext) as any;
  const navigation = useNavigation();
  const [words, setWords] = useState<string[] | null>(null);
  const [revealing, setRevealing] = useState(false);

  // Backup status — surfaced in the Settings panel so users can verify
  // both rails (local on-device file + Google Drive copy) are healthy
  // without opening a file manager. `null` = unknown, `undefined` = no
  // backup. Errors are swallowed; UI shows "—" for unreachable values.
  type BackupInfo = { modifiedAt: number; sizeBytes: number };
  const [localBackup, setLocalBackup] = useState<BackupInfo | null | undefined>(null);
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [driveBackup, setDriveBackup] = useState<BackupInfo | null | undefined>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // One status read. Returns whether the fingerprint cache was warm —
    // caller uses that to decide whether to keep polling.
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
      } catch (_) {
        if (!cancelled) setLocalBackup(undefined);
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
        <View style={{ marginTop: 24 }}>
          <Text bold style={{ fontSize: 16, color: colors.ark?.light ?? colors.pink.default, marginBottom: 8 }}>
            Seed Phrase
          </Text>
          <View style={{ backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14 }}>
            <Text style={{ fontSize: 13, color: '#AAA', marginBottom: 12 }}>
              The 12 words below are the only way to recover your Ark Vault if
              you lose access to this phone. Write them on paper and store them
              somewhere safe — we cannot recover them for you.
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
                      <Text style={{ fontSize: 14, color: '#FFF', textAlign: 'center' }}>
                        {`${i + 1}. ${word}`}
                      </Text>
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
            Ark Backup
          </Text>
          <Text style={{ fontSize: 12, color: '#888', marginBottom: 10, lineHeight: 17 }}>
            If you lose this phone, you'll need BOTH your 12-word seed phrase AND your Ark backup file to recover your wallet.
          </Text>
          <View style={{ backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
            {/* Local file row */}
            <View style={{ paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#333' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, color: '#AAA' }}>Local (on-device)</Text>
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
            </View>

            {/* Cloud row — Google Drive on Android, iCloud Drive on iOS.
                On iOS the local Documents file IS the iCloud copy when
                the user enables iCloud Drive sync for Cypher Box, so
                "connect" opens iOS Settings rather than calling an
                in-app SDK. */}
            <View style={{ paddingVertical: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, color: '#AAA' }}>{Platform.OS === 'ios' ? 'iCloud Drive' : 'Google Drive'}</Text>
                {Platform.OS === 'ios' ? (
                  <Text bold style={{ fontSize: 13, color: '#888' }}>System-managed</Text>
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
              {driveBackup && (
                <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                  {`${formatSize(driveBackup.sizeBytes)} · appDataFolder`}
                </Text>
              )}
              {driveError && (
                <Text style={{ fontSize: 11, color: '#E85C5A', marginTop: 2 }}>
                  {driveError}
                </Text>
              )}
              {/* Connect / Disconnect / iCloud-hint CTA. Inline pill so
                  the action is one tap away — backup status is the kind
                  of thing you only check when something feels off, and
                  bouncing through a separate screen would defeat the
                  point. */}
              <TouchableOpacity
                onPress={
                  Platform.OS === 'ios'
                    ? handleICloudHint
                    : driveConnected
                      ? handleDriveDisconnect
                      : handleDriveConnect
                }
                disabled={driveBusy}
                activeOpacity={0.7}
                style={{
                  marginTop: 10,
                  alignSelf: 'flex-start',
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: Platform.OS === 'ios'
                    ? '#444'
                    : driveConnected ? '#E85C5A' : (colors.ark?.light ?? colors.green),
                  backgroundColor: '#0F0F0F',
                  opacity: driveBusy ? 0.5 : 1,
                }}
              >
                {driveBusy ? (
                  <ActivityIndicator size="small" color="#888" />
                ) : (
                  <Text bold style={{
                    fontSize: 13,
                    color: Platform.OS === 'ios'
                      ? '#AAA'
                      : driveConnected ? '#E85C5A' : (colors.ark?.light ?? colors.green),
                  }}>
                    {Platform.OS === 'ios'
                      ? 'How to enable iCloud Drive'
                      : driveConnected
                        ? 'Disconnect'
                        : 'Connect Google Drive'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Manual export — one-shot snapshot to share sheet. Lives
                here rather than in the create flow because it's a
                snapshot, not a backup channel: the file you export now
                doesn't update on later VTXO changes. Useful for users
                who want a redundant copy in a different cloud (different
                Google account, OneDrive, email-to-self) or a manual
                "Save to Files" target on iOS that's outside Documents. */}
            <View style={{ paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: '#333', marginTop: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, color: '#AAA' }}>Manual export</Text>
                <Text style={{ fontSize: 11, color: '#666' }}>snapshot</Text>
              </View>
              <Text style={{ fontSize: 11, color: '#666', marginTop: 2, lineHeight: 16 }}>
                Save the current encrypted backup file anywhere via the share sheet — email, another Drive account, OneDrive, etc. Doesn't auto-update; export again after big changes.
              </Text>
              <TouchableOpacity
                onPress={handleManualExport}
                disabled={manualExportBusy}
                activeOpacity={0.7}
                style={{
                  marginTop: 10,
                  alignSelf: 'flex-start',
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: '#444',
                  backgroundColor: '#0F0F0F',
                  opacity: manualExportBusy ? 0.5 : 1,
                }}
              >
                {manualExportBusy ? (
                  <ActivityIndicator size="small" color="#888" />
                ) : (
                  <Text bold style={{ fontSize: 13, color: '#AAA' }}>
                    Save backup file
                  </Text>
                )}
              </TouchableOpacity>
            </View>
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

            <Text style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 8, paddingHorizontal: 24 }}>
              Eject from Ark: sweep your Ark balance back on-chain without ASP cooperation. Use only if you no longer trust the Ark server.
            </Text>

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
      </RNAnimated.View>
    </ScrollView>
  );
}
