import { useEffect, useState } from 'react';

const BlueElectrum = require('../../blue_modules/BlueElectrum');

export type ElectrumConnection = 'checking' | 'connected' | 'no-answer';

/**
 * Whether this phone reaches the app's Electrum server, checked when the screen comes up and again every few seconds
 * while it stays up. 'connected' proves the phone is online. 'no-answer' doesn't prove it's offline (the server may be
 * down), and it needs two misses in a row: right after launch the app may still be connecting, and a single miss would
 * flash a "not connected" state on a phone that is online. Each check tries a fresh connection when the app's own is
 * down, so a phone that comes back online shows as 'connected' within a check or two, without restarting the app.
 * With the app's network turned off it stays 'checking': switching the app's connection off proves nothing about the
 * phone, so it mustn't unlock anything.
 */
export default function useElectrumConnection(enabled: boolean, networkOff = false): ElectrumConnection {
    const [state, setState] = useState<ElectrumConnection>('checking');

    useEffect(() => {
        if (!enabled) return;
        if (networkOff) {
            setState('checking');
            return;
        }
        let cancelled = false;
        let misses = 0;
        let timer: ReturnType<typeof setTimeout>;
        const check = () => {
            BlueElectrum.serverAnswers()
                .then((answered: boolean) => {
                    if (cancelled) return;
                    misses = answered ? 0 : misses + 1;
                    if (answered) setState('connected');
                    else if (misses >= 2) setState('no-answer');
                    // the second look comes soon, so an offline phone doesn't wait long for its answer
                    timer = setTimeout(check, misses === 1 ? 3000 : 10000);
                })
                .catch(() => {});
        };
        check();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [enabled, networkOff]);

    return state;
}
