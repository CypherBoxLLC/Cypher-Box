import { useEffect } from 'react';

import Privacy from '../../blue_modules/Privacy';

/**
 * Protects a screen while it shows a recovery phrase, the dice entropy behind one, a SeedQR or a key made from one:
 * the app-switcher preview is hidden, and on Android screenshots are blocked. Applies whatever the privacy setting says, and is released when the
 * screen closes or `active` turns false.
 */
export default function useProtectSecret(active = true) {
    useEffect(() => {
        if (!active) return;
        Privacy.protectSecret();
        return () => Privacy.releaseSecret();
    }, [active]);
}
