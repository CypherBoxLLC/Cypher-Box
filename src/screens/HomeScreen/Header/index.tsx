import React, { useCallback, useState } from "react";
import { Image, Text as RNText, TouchableOpacity, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import SimpleToast from "react-native-simple-toast";
import Ionicons from "react-native-vector-icons/Ionicons";

import { Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { requestCameraAuthorization } from "../../../../helpers/scan-qr";
import { BlueStorageContext } from "../../../../blue_modules/storage-context";

import styles from "../styles";
import ScanWithPicker, { ScanTargetKey } from "./ScanWithPicker";

interface Props {
    /** Routing context — propagated to whichever send screen we open. */
    matchedRate?: number | string;
    matchedRateBTC?: number;
    currency?: string;
    /** Hot Vault BlueWallet wallet object (for on-chain UTXO load + send). */
    wallet?: any;
    /** Cold Vault BlueWallet wallet object (same shape, different keys). */
    coldStorageWallet?: any;
    /**
     * Optional fallback for the legacy single-callback scan API. When the
     * user picks a wallet without a routing handler, we fall back to this
     * so a scan from a brand-new install still produces *some* UI.
     */
    onBarScanned?: (value: any) => void;
}

/**
 * Home header — left-side scan icon → "Scan with" wallet picker → camera.
 *
 * Why two-step (pick wallet, then scan): a scanned Bitcoin address could be
 * paid from any of three on-chain rails (Hot Vault / Cold Vault / Ark
 * on-chain) and a Lightning invoice could be paid from any of three LN
 * rails (Strike / CoinOS / Ark Lightning). Auto-routing by URI scheme
 * alone hides the user's intent. Asking up-front keeps both the scanned
 * destination AND the spending wallet explicit.
 *
 * Vault edge case: this is the ONE flow where we send from a vault without
 * the manual capsule picker. Bam's call: "if user scans an on-chain address
 * with a vault, just construct the tx automatically — like BlueWallet's
 * default coin selection — but with our UI." We do that by passing
 * `capsulesData = ALL UTXOs` to EditAmount, so the downstream flow uses
 * BlueWallet's `createTransaction` to pick the actual inputs. The capsule
 * grid never appears.
 */
export default React.memo(function Header({
    matchedRate,
    matchedRateBTC = 0,
    currency = 'USD',
    wallet,
    coldStorageWallet,
    onBarScanned,
}: Props) {
    const navigation = useNavigation<any>();
    const routeName = useRoute().name;
    const { sleep } = React.useContext(BlueStorageContext);

    const { isAuth, isStrikeAuth, isArkAuth, walletID, coldStorageWalletID } = useAuthStore();

    const [pickerVisible, setPickerVisible] = useState(false);

    const navigateToSettings = () => {
        dispatchNavigate("Settings");
    };

    const navigateToActivity = () => {
        dispatchNavigate("Activity");
    };

    /**
     * Open the camera scanner and resolve with the raw scanned string.
     * Wraps the existing `ScanQRCodeRoot` route so we can `await` the
     * result inside per-wallet handlers below — cleaner than nested
     * callbacks. Resolves to null if the user backs out.
     */
    const openScanner = useCallback((): Promise<string | null> => {
        return new Promise((resolve) => {
            requestCameraAuthorization()
                .then(() => {
                    let resolved = false;
                    navigation.navigate('ScanQRCodeRoot', {
                        screen: 'ScanQRCode',
                        params: {
                            showFileImportButton: false,
                            onBarScanned: (ret: any) => {
                                if (resolved) return;
                                resolved = true;
                                // Pop the modal stack so we land back on
                                // home before per-wallet routing runs.
                                navigation.getParent()?.pop();
                                const raw = typeof ret === 'string'
                                    ? ret
                                    : (ret?.data ?? '');
                                resolve(raw ? raw.trim() : null);
                            },
                        },
                    });
                })
                .catch((err: any) => {
                    console.warn('[Home/scan] camera authorization failed:', err?.message ?? err);
                    SimpleToast.show('Camera permission needed to scan', SimpleToast.SHORT);
                    resolve(null);
                });
        });
    }, [navigation]);

    /**
     * Vault auto-coin-control path. Loads ALL spendable UTXOs (with a
     * 10s ceiling on the network fetch — same guard SendListNew uses)
     * and hands them to `EditAmount` as the capsule set. Downstream
     * createTransaction call selects the actual inputs from that pool
     * via BlueWallet's default algorithm. User never sees the capsule
     * picker; their experience is "scan address → enter amount →
     * confirm" identical to BlueWallet's default send flow.
     */
    const navigateVaultSend = useCallback(async (
        scannedAddress: string,
        which: 'hot' | 'cold',
    ) => {
        const vaultWallet = which === 'hot' ? wallet : coldStorageWallet;
        if (!vaultWallet) {
            SimpleToast.show(
                which === 'hot'
                    ? 'Hot Vault not ready — open the vault once and try again.'
                    : 'Cold Vault not ready — open the vault once and try again.',
                SimpleToast.LONG,
            );
            return;
        }
        try {
            await Promise.race([vaultWallet.fetchUtxo(), sleep(10000)]);
        } catch (e) {
            if (__DEV__) console.log('[Home/scan] vault fetchUtxo failed', e);
        }
        const utxoList = vaultWallet.getUtxo(true).sort(
            (a: any, b: any) => a.height - b.height || a.txid.localeCompare(b.txid) || a.vout - b.vout,
        );
        if (!utxoList || utxoList.length === 0) {
            SimpleToast.show('No spendable capsules in this vault', SimpleToast.LONG);
            return;
        }
        const capsulesData = utxoList.map((u: any) => ({
            id: `${u.txid}:${u.vout}`,
            value: u.value,
            address: u.address,
        }));
        const capsuleTotal = capsulesData.reduce((acc: number, c: any) => acc + (c.value || 0), 0);
        // Pre-select all UTXO ids so EditAmount's downstream sum reflects
        // the full vault balance and createTransaction has the full input
        // set to choose from.
        const allIds = capsulesData.map((c: any) => c.id);
        const isVault = which === 'cold';
        // matchedRateBTC is BTC-per-fiat (dollar/BTC); the vault flow
        // uses it directly. `total` and `inUSD` shapes mirror the values
        // SendListNew.handleSend passes when the user picks capsules
        // manually — keeping them identical lets the rest of the pipe
        // (EditAmount → ColdStorage) work without a special-case branch.
        dispatchNavigate('EditAmount', {
            isEdit: false,
            currency,
            vaultTab: isVault,
            wallet: vaultWallet,
            utxo: utxoList,
            ids: allIds,
            // Pre-fill the recipient from the QR scan. EditAmount reads
            // params.to and forwards it through the rest of the pipeline.
            to: scannedAddress,
            // No fiat conversion at the entry point — let EditAmount
            // compute it once it has matchedRate. We pass 0/'' rather
            // than guessing, same as the manual flow when no capsule
            // is selected yet.
            maxUSD: '',
            inUSD: '',
            total: '',
            matchedRate: matchedRateBTC,
            capsulesData,
            capsuleTotal,
        });
    }, [wallet, coldStorageWallet, sleep, currency, matchedRateBTC]);

    /**
     * Per-wallet routing after scan. Each branch hands the raw scanned
     * string to the destination screen via the param name that screen
     * expects — Strike's SendScreen reads `to`, ArkSendScreen reads
     * `initialDestination`. Mismatches show up as an empty input on
     * landing, not a hard crash, but they're worth keeping in sync.
     */
    const handleWalletPicked = useCallback(async (key: ScanTargetKey) => {
        const scanned = await openScanner();
        if (!scanned) return;
        switch (key) {
            case 'strike':
                dispatchNavigate('SendScreen', {
                    matchedRate,
                    currency,
                    receiveType: false,
                    to: scanned,
                });
                break;
            case 'coinos':
                dispatchNavigate('SendScreen', {
                    matchedRate,
                    currency,
                    receiveType: true,
                    to: scanned,
                });
                break;
            case 'ark':
                dispatchNavigate('ArkSendScreen', {
                    matchedRate,
                    currency,
                    initialDestination: scanned,
                });
                break;
            case 'hotVault':
                await navigateVaultSend(scanned, 'hot');
                break;
            case 'coldVault':
                await navigateVaultSend(scanned, 'cold');
                break;
            default:
                // Fallback to the legacy onBarScanned handler if the
                // parent provided one — keeps backward compat with
                // anything that still listens at the home-screen level.
                if (onBarScanned) onBarScanned(scanned);
        }
    }, [openScanner, matchedRate, currency, navigateVaultSend, onBarScanned]);

    return (
        <>
            <View style={[styles.title, { transform: [{ translateY: -34 }] }]}>
                {/* RNText (built-in) here, not the @Cypher Text wrapper:
                    the wrapper hardcodes adjustsFontSizeToFit, which
                    under Fabric (RN 0.76 New Arch) shrinks the
                    "Total Assets" header to fit the row's available
                    width when the right-side action icons (settings
                    + scan) are present. Built-in Text honors the
                    declared subHeader fontSize literally. The
                    `subHeader` prop on @Cypher Text resolves to
                    fontSize 22 / lineHeight ~28 / Lato-Bold; we
                    replicate inline so visual weight is preserved. */}
                <RNText style={{ fontSize: 22, fontFamily: 'Lato-Bold', color: '#FFF' }}>
                    Total Assets
                </RNText>
                {/*
                  Right-side action row — scan first, then settings. Bam's
                  call: scan icon belongs in the right corner, immediately
                  next to settings, mirroring the layout the previous
                  (commented-out) version had.
                */}
                <View style={styles.row}>
                    <TouchableOpacity
                        activeOpacity={0.6}
                        style={styles.imageView}
                        onPress={navigateToActivity}
                        accessibilityLabel="Activity"
                    >
                        <Ionicons name="notifications-outline" size={28} color="#FFFFFF" />
                    </TouchableOpacity>
                    <TouchableOpacity
                        activeOpacity={0.6}
                        style={styles.imageView}
                        onPress={navigateToSettings}
                    >
                        {/* Modern thin-stroke gear (Ionicons
                            settings-outline) — keeps the classic gear
                            silhouette but with cleaner strokes than the
                            old PNG. */}
                        <Ionicons name="settings-outline" size={28} color="#FFFFFF" />
                    </TouchableOpacity>
                    <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => setPickerVisible(true)}
                        style={{
                            width: 42,
                            height: 42,
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Image
                            style={{ width: 36, height: 36 }}
                            resizeMode="contain"
                            source={require("../../../../img/scan-new@3x2.png")}
                        />
                    </TouchableOpacity>
                </View>
            </View>

            <ScanWithPicker
                visible={pickerVisible}
                onClose={() => setPickerVisible(false)}
                onSelect={handleWalletPicked}
                available={{
                    strike: !!isStrikeAuth,
                    // CoinOS shares the legacy `isAuth` flag in this app.
                    coinos: !!isAuth,
                    hotVault: !!walletID && !!wallet,
                    coldVault: !!coldStorageWalletID && !!coldStorageWallet,
                    ark: !!isArkAuth,
                }}
            />
        </>
    );
});
