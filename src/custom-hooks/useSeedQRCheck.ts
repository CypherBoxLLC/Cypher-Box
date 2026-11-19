import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';

import { seedQRMatches } from '@Cypher/helpers/seedQR';
import { requestCameraAuthorization } from '../../helpers/scan-qr';

export type SeedQRCheck = 'idle' | 'ok' | 'mismatch';

/**
 * Scan a hand-copied SeedQR and say whether it gives back this recovery phrase. A copy that scans as other digits or
 * breaks the phrase's checksum comes back as 'mismatch' (one that doesn't scan at all leaves the scanner open). A few
 * wrong squares can still come back 'ok': the scanner repairs them with the code's error correction and doesn't say so.
 */
export default function useSeedQRCheck(mnemonic: string) {
    const navigation: any = useNavigation();
    const [result, setResult] = useState<SeedQRCheck>('idle');

    const scan = () => {
        setResult('idle');
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
                        setResult(data && seedQRMatches(String(data), mnemonic) ? 'ok' : 'mismatch');
                    },
                },
            });
        });
    };

    return { result, scan };
}
