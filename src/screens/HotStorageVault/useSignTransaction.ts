import { Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { SIGN_VAULT_MISMATCH, assertKeyOwns, parseUnsignedPsbt, signingKeyForWallet } from "@Cypher/helpers";
import loc from "../../../loc";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";
import { afterSigningGuide, startSigning } from "../SignOnce/start";
import signErrorText from "../SignOnce/errorText";

const fs = require('../../../blue_modules/fs');

/**
 * "Sign a transaction" on the Hot Vault tab: the wide side of the button opens the file picker and the QR side the
 * scanner, straight away, like the Cold Vault's broadcast button. What comes back is checked against this vault
 * first, so the signing screen opens at the review; anything it can't sign is refused with an alert and the tab
 * stays as it was. The one-time "Signing safely" guide still comes before the picker on a phone that hasn't seen it.
 */
export default function useSignTransaction(wallet: any) {
    const navigation: any = useNavigation();

    const open = (data: string) => {
        try {
            // by fingerprint, or by public key for a Cold Vault set up from this vault's bare xpub (it writes 00000000)
            assertKeyOwns(parseUnsignedPsbt(data), signingKeyForWallet(wallet), SIGN_VAULT_MISMATCH);
        } catch (e: any) {
            Alert.alert(loc.errors.error, signErrorText(e.message));
            return;
        }
        startSigning({ psbt: data, mode: 'vault' });
    };

    const signFromFile = () =>
        afterSigningGuide(async () => {
            // the shared reader handles binary .psbt files and file names with spaces, and alerts on failure itself
            const data = await fs.openSignedTransaction();
            if (data) open(data);
        });

    const signFromQr = () =>
        afterSigningGuide(() => {
            requestCameraAuthorization().then(() => {
                let done = false;
                navigation.navigate('ScanQRCodeRoot', {
                    screen: 'ScanQRCode',
                    params: {
                        showFileImportButton: false,
                        onBarScanned: (ret: any) => {
                            if (done) return;
                            done = true;
                            // opened without launchedBy, the scanner does not close itself
                            navigation.getParent()?.pop();
                            const data = typeof ret === 'string' ? ret : ret?.data;
                            if (data) open(String(data));
                        },
                    },
                });
            });
        });

    return { signFromFile, signFromQr };
}
