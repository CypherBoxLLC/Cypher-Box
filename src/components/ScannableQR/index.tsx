import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import QRCodeSvg from "react-native-qrcode-svg";
// @ts-ignore: qrcode ships no type definitions (react-native-qrcode-svg draws with the same library)
import QRCode from "qrcode";

import { colors } from "@Cypher/style-guide";

// squares of white the QR standard asks for on every side; without them a webcam doesn't find the code against a
// dark screen
const QUIET_ZONE = 4;
const FRAME = 6;

/**
 * A QR made to be read by another device's camera, a laptop webcam included: the lowest error-correction level, so
 * the squares are as big as they can be (screens don't get scratched, and there's no logo over the middle), a white
 * quiet zone of 4 squares, and a thick green frame around it so it stands out on the dark screen. `width` is the
 * whole thing, frame included.
 */
export default function ScannableQR({ value, width }: { value: string; width: number }) {
    const modules = useMemo(() => QRCode.create(value, { errorCorrectionLevel: 'L' }).modules.size as number, [value]);
    const inner = width - 2 * FRAME;
    // whole points per square keep the edges crisp
    const square = Math.max(1, Math.floor(inner / (modules + 2 * QUIET_ZONE)));
    const size = square * modules;
    return (
        <View style={[styles.frame, { width, height: width, padding: (inner - size) / 2 }]} testID="ScannableQR">
            <QRCodeSvg value={value} size={size} ecl="L" quietZone={0} color="#000000" backgroundColor="#FFFFFF" />
        </View>
    );
}

const styles = StyleSheet.create({
    frame: {
        borderWidth: FRAME,
        borderColor: colors.green,
        borderRadius: 14,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
