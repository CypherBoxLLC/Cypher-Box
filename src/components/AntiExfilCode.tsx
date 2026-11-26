import React from "react";

/**
 * One hop of verified signing (anti-exfil) as an animated BBQr code, the format the Cold Vault already shows its
 * unsigned transactions in. The hop is a text container (helpers/antiExfilTransport); BBQr carries it as Unicode
 * text, so the other phone's scanner hands it back as the same string, however many frames it took.
 *
 * The BBQr component is loaded when the code is first drawn, not when this file is: the `bbqr` package is ESM-only,
 * which the unit tests' CommonJS runtime can't load, and the signing screen imports this file for every signature,
 * verified or not. Tests that reach a verified hop stand this component in.
 */
export default function AntiExfilCode({ value }: { value: string }) {
    const { BBQrDynamicQRCode } = require('../../components/BBQrDynamicQRCode');
    return <BBQrDynamicQRCode value={Buffer.from(value, 'utf8').toString('hex')} fileType="U" />;
}
