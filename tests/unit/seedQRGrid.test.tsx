/**
 * The SeedQR to copy by hand: four zoomed parts that meet on the template's heavier line at 15, don't overlap, cover
 * every square once at one size, and two green lines where they meet. Grids from public BIP39 test phrases only.
 */

import React from 'react';
import { Text as RNText, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import SeedQRGrid, { seedQRSplit } from '../../src/components/SeedQRGrid';
import { mnemonicToSeedQR, seedQRGrid } from '../../src/helpers/seedQR';
import { colors } from '../../src/style-guide';

jest.mock('@Cypher/component-library', () => {
    const { Text } = require('react-native');
    return { Text };
});
// drawn as plain elements, so the test can read every square and line
jest.mock('react-native-svg', () => {
    const { createElement } = require('react');
    const element = (name: string) => (props: any) => createElement(name, props, props.children);
    return { __esModule: true, default: element('Svg'), Rect: element('Rect'), Line: element('Line') };
});

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ZOO_24 = `${'zoo '.repeat(23)}vote`;
const WIDTH = 345;

const textOf = (node: renderer.ReactTestInstance) =>
    node.findAllByType(RNText).map(t => [].concat(t.props.children).filter(c => typeof c === 'string' || typeof c === 'number').join('')).join('|');

const render = (mnemonic: string, zoomable = true) => {
    const grid = seedQRGrid(mnemonicToSeedQR(mnemonic));
    let tree: renderer.ReactTestRenderer;
    act(() => {
        tree = renderer.create(<SeedQRGrid grid={grid} width={WIDTH} zoomable={zoomable} />);
    });
    return { grid, root: tree!.root };
};

const zoomTo = (root: renderer.ReactTestInstance, label: string) => {
    const button = root.findAllByType(TouchableOpacity).find(b => textOf(b) === label);
    if (!button) throw new Error(`no zoom ${label}`);
    act(() => button.props.onPress());
};

const drawing = (root: renderer.ReactTestInstance) => {
    const svg = root.findByType('Svg' as any);
    const squares = root.findAllByType('Rect' as any).filter(r => r.props.fill === '#000');
    const lines = root.findAllByType('Line' as any).map(l => l.props);
    return { svg: svg.props, squares, lines, green: lines.filter(l => l.stroke === colors.green) };
};

const PARTS = [
    { label: 'Top left', rows: 'top', cols: 'left' },
    { label: 'Top right', rows: 'top', cols: 'right' },
    { label: 'Bottom left', rows: 'bottom', cols: 'left' },
    { label: 'Bottom right', rows: 'bottom', cols: 'right' },
] as const;

describe('seedQRSplit', () => {
    it("is the template's heavier line at 15 for both SeedQR sizes", () => {
        expect(seedQRSplit(25)).toBe(15);
        expect(seedQRSplit(29)).toBe(15);
        expect(seedQRSplit(21)).toBe(10);
    });
});

describe.each([
    ['12 words', ABANDON, 25],
    ['24 words', ZOO_24, 29],
])('SeedQRGrid, %s', (_name, mnemonic, size) => {
    it(`is ${size} squares a side, with green lines on line 15 across the whole grid`, () => {
        const { grid, root } = render(mnemonic);
        expect(grid.size).toBe(size);
        const { svg, squares, green } = drawing(root);
        const cell = Math.floor((WIDTH - 18) / size);
        expect(svg.width).toBe(cell * size);
        expect(squares).toHaveLength(grid.filled.filter(Boolean).length);
        expect(green).toEqual(expect.arrayContaining([
            expect.objectContaining({ x1: 0, y1: 15 * cell, x2: cell * size, y2: 15 * cell }),
            expect.objectContaining({ x1: 15 * cell, y1: 0, x2: 15 * cell, y2: cell * size }),
        ]));
        expect(green).toHaveLength(2);
    });

    it('splits into four parts that cover every square once, at one square size', () => {
        const { grid, root } = render(mnemonic);
        const seen = new Map<string, number>();
        const cells = new Set<number>();
        for (const part of PARTS) {
            zoomTo(root, part.label);
            const { squares } = drawing(root);
            const r0 = part.rows === 'top' ? 0 : 15;
            const c0 = part.cols === 'left' ? 0 : 15;
            const r1 = part.rows === 'top' ? 15 : size;
            const c1 = part.cols === 'left' ? 15 : size;
            const cell = squares[0].props.width;
            cells.add(cell);
            for (const s of squares) {
                const r = r0 + s.props.y / cell;
                const c = c0 + s.props.x / cell;
                expect(r).toBeGreaterThanOrEqual(r0);
                expect(r).toBeLessThan(r1);
                expect(c).toBeGreaterThanOrEqual(c0);
                expect(c).toBeLessThan(c1);
                expect(grid.filled[r * size + c]).toBe(true);
                seen.set(`${r},${c}`, (seen.get(`${r},${c}`) ?? 0) + 1);
            }
        }
        // every filled square, each in exactly one part
        expect(seen.size).toBe(grid.filled.filter(Boolean).length);
        expect([...seen.values()].every(n => n === 1)).toBe(true);
        // the biggest part, 15 squares, fills the width; the others are drawn at its scale
        expect([...cells]).toEqual([Math.floor((WIDTH - 18) / 15)]);
    });

    it('numbers a part as the template does, keeps its heavier lines on the 5s, and draws the green lines on its inner edges', () => {
        const { root } = render(mnemonic);
        zoomTo(root, 'Bottom right');
        const { svg, lines, green } = drawing(root);
        const cell = Math.floor((WIDTH - 18) / 15);
        const count = size - 15;
        expect(svg.width).toBe(cell * count);
        expect(svg.height).toBe(cell * count);
        const numbers = Array.from({ length: count }, (_, i) => String(16 + i));
        expect(textOf(root)).toContain(numbers.join('|'));
        // the template's heavier lines (the green ones, where the parts meet, are wider still)
        const heavy = lines.filter(l => l.strokeWidth === 1.5 && l.y1 === l.y2).map(l => l.y1 / cell + 15);
        expect(heavy).toEqual([15, 20, 25].filter(n => n <= size));
        // the top and left edges, where this part meets the others
        expect(green).toEqual(expect.arrayContaining([
            expect.objectContaining({ y1: 1.5, y2: 1.5 }),
            expect.objectContaining({ x1: 1.5, x2: 1.5 }),
        ]));

        zoomTo(root, 'Top left');
        const topLeft = drawing(root);
        expect(topLeft.svg.width).toBe(cell * 15);
        expect(topLeft.green).toEqual(expect.arrayContaining([
            expect.objectContaining({ y1: cell * 15 - 1.5 }),
            expect.objectContaining({ x1: cell * 15 - 1.5 }),
        ]));
    });

    it('has no zoom and no green lines as a preview', () => {
        const { root } = render(mnemonic, false);
        expect(root.findAllByType(TouchableOpacity)).toHaveLength(0);
        expect(drawing(root).green).toHaveLength(0);
    });
});
