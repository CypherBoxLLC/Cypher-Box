import { Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";

import {
    ImportedTransaction,
    parseImportedTransaction,
    resumeParams,
    signedTxMatchesPending,
    spendsPendingInputs,
} from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import loc from "../../../loc";
import { WatchOnlyWallet } from "../../../class";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";

const fs = require('../../../blue_modules/fs');

/**
 * Import Transaction for a watch-only (cold) vault, from a file or a QR code. Used by the broadcast button on the
 * vault tab and by Settings, so both behave the same. `memo` is a label from an opened bitcoin: link, if any.
 *
 * What comes in is sorted by content, not by file name: a finished transaction (raw hex, or a PSBT with every
 * signature in) opens on the broadcast screen, which lists its outputs; a PSBT still missing signatures opens on
 * the signing screen. The QR path used to drop raw hex silently and the file path only finished PSBTs named
 * "-signed.psbt", which is why both now go through parseImportedTransaction.
 *
 * When this vault has a transaction waiting for signature, a finished one that is exactly it goes to the same
 * confirm screen the signing flow ends on, checked against what was reviewed. One that spends the same capsules
 * any other way is stopped with a warning: that is what a swapped transaction looks like.
 */
export default function useImportTransaction(wallet: any, memo = '') {
    const navigation: any = useNavigation();

    const isWatchOnly = () => {
        if (wallet?.type === WatchOnlyWallet.type) return true;
        Alert.alert(loc.errors.error, 'Importing transaction in non-watchonly wallet (this should never happen)');
        return false;
    };

    const openImported = (imported: ImportedTransaction) => {
        navigation.navigate('SendDetailsRoot', {
            screen: 'PsbtWithHardwareWallet',
            params: { memo, fromWallet: wallet, ...imported },
        });
    };

    const open = (data: string) => {
        let imported: ImportedTransaction;
        try {
            imported = parseImportedTransaction(data);
        } catch (e: any) {
            Alert.alert(loc.errors.error, e.message);
            return;
        }
        const pending = useAuthStore.getState().pendingSignatures?.[wallet?.getID?.()];
        if (!pending || !('txhex' in imported)) {
            openImported(imported);
            return;
        }
        if (signedTxMatchesPending(imported.txhex, pending)) {
            navigation.navigate('ConfirmHardwareTransaction', { ...resumeParams(pending, wallet), txHex: imported.txhex });
            return;
        }
        if (spendsPendingInputs(imported.txhex, pending)) {
            Alert.alert(
                loc.cypherbox.vault.storage_vault.import.mismatch_title,
                loc.cypherbox.vault.storage_vault.import.mismatch_body_1 +
                    loc.cypherbox.vault.storage_vault.import.mismatch_body_2,
                [
                    { text: loc._.cancel, style: 'cancel' },
                    { text: loc.cypherbox.vault.storage_vault.import.review_anyway, style: 'destructive', onPress: () => openImported(imported) },
                ],
            );
            return;
        }
        Alert.alert(
            loc.cypherbox.vault.storage_vault.import.different_title,
            loc.cypherbox.vault.storage_vault.import.different_body,
            [
                { text: loc._.cancel, style: 'cancel' },
                { text: loc.cypherbox.vault.storage_vault.import.open_it, onPress: () => openImported(imported) },
            ],
        );
    };

    const importFromFile = async () => {
        if (!isWatchOnly()) return;
        // the shared reader handles binary .psbt files and file names with spaces, and alerts on failure itself
        const data = await fs.openSignedTransaction();
        if (data) open(data);
    };

    const onScanned = (ret: any) => {
        // opened without launchedBy, the scanner does not close itself
        navigation.getParent()?.pop();
        const data = typeof ret === 'string' ? ret : ret?.data;
        if (!data) return;
        if (data.toUpperCase().startsWith('UR')) {
            Alert.alert(loc.errors.error, 'BC-UR not decoded. This should never happen');
            return;
        }
        open(data);
    };

    const importFromQr = () => {
        if (!isWatchOnly()) return;
        requestCameraAuthorization().then(() => {
            navigation.navigate('ScanQRCodeRoot', {
                screen: 'ScanQRCode',
                params: { onBarScanned: onScanned, showFileImportButton: false },
            });
        });
    };

    return { importFromFile, importFromQr };
}
