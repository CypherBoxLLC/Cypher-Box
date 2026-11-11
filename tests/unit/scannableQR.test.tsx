/**
 * The signer's key QRs, made for a laptop webcam as much as a phone: lowest error correction (biggest squares), a
 * white quiet zone of at least 4 squares, a green frame. Values are the public "abandon … about" keys.
 */

import React from 'react';
import { View } from 'react-native';
import renderer, { act } from 'react-test-renderer';
// @ts-ignore: qrcode ships no type definitions
import QRCode from 'qrcode';

import ScannableQR from '../../src/components/ScannableQR';
import { colors } from '../../src/style-guide';

jest.mock('react-native-qrcode-svg', () => {
    const { View: MockView } = require('react-native');
    return (props: any) => <MockView testID="qr-svg" {...props} />;
});

const MULTISIG_KEY =
    '[73c5da0a/48h/0h/0h/2h]xpub6DkFAXWQ2dHxq2vatrt9qyA3bXYU4ToWQwCHbf5XB2mSTexcHZCeKS1VZYcPoBd5X8yVcbXFHJR9R8UCVpt82VX1VhR28mCyxUFL4r6KFrf';
const ZPUB_KEY =
    '[73c5da0a/84h/0h/0h]zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

const render = (value: string, width: number) => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
        tree = renderer.create(<ScannableQR value={value} width={width} />);
    });
    const root = tree!.root;
    const qr = root.findAll(n => n.props.testID === 'qr-svg' && typeof n.type !== 'string')[0].props;
    const frame = root.findAll(n => n.props.testID === 'ScannableQR' && n.type === View)[0];
    return { qr, frame: Object.assign({}, ...[].concat(frame.props.style)) };
};

describe('ScannableQR', () => {
    it.each([
        ['multisig key', MULTISIG_KEY],
        ['single-key key', ZPUB_KEY],
    ])('draws the %s at the lowest error correction, 41 squares a side instead of 61', (_name, value) => {
        const { qr } = render(value, 363);
        expect(qr.value).toBe(value);
        expect(qr.ecl).toBe('L');
        expect(qr.quietZone).toBe(0);
        expect(QRCode.create(value, { errorCorrectionLevel: 'L' }).modules.size).toBe(41);
        expect(QRCode.create(value, { errorCorrectionLevel: 'H' }).modules.size).toBe(61);
    });

    it.each([363, 320, 280])('keeps a white quiet zone of at least 4 squares inside the green frame, %i points wide', width => {
        const { qr, frame } = render(MULTISIG_KEY, width);
        const square = qr.size / 41;
        expect(Number.isInteger(square)).toBe(true);
        expect(frame.width).toBe(width);
        expect(frame.borderWidth).toBe(6);
        expect(frame.borderColor).toBe(colors.green);
        expect(frame.backgroundColor).toBe('#FFFFFF');
        // the padding is the white around the code, on each side
        expect(frame.padding).toBeGreaterThanOrEqual(4 * square);
        expect(qr.size + 2 * frame.padding + 2 * frame.borderWidth).toBe(width);
    });
});
