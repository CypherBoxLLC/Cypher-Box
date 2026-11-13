import React, { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";

import { Text } from "@Cypher/component-library";
import type { SeedQRGrid as Grid } from "@Cypher/helpers/seedQR";
import { colors } from "@Cypher/style-guide";
import loc from "../../../loc";

type Zoom = 'all' | 0 | 1 | 2 | 3;

const ZOOMS: Zoom[] = ['all', 0, 1, 2, 3];

// read when drawn: this file loads before the saved language is applied
const zoomLabel = (zoom: Zoom) => {
    const labels = loc.cypherbox.components.seedqr_grid;
    return zoom === 'all' ? labels.all : [labels.top_left, labels.top_right, labels.bottom_left, labels.bottom_right][zoom];
};

const LABEL = 18;
// squares between the heavier lines, as on the templates
const BLOCK = 5;
const SPLIT_LINE = 3;
// the templates' heavier line every 5 squares
const HEAVY_LINE = '#555555';

/**
 * Where the four zoomed parts meet, on each axis: the heavier line nearest the middle, so every part is whole 5×5
 * blocks of the template. 15 for both sizes a SeedQR comes in (25 and 29 squares a side). An exact half isn't a line
 * between squares (25 is odd), and parts cut there overlapped by a row and a column and split the middle block.
 */
export const seedQRSplit = (size: number) =>
    Math.min(size - BLOCK, Math.max(BLOCK, BLOCK * Math.round(size / (2 * BLOCK))));

/**
 * A SeedQR drawn as a numbered grid to copy by hand, the way SeedSigner's paper and steel templates are laid out:
 * rows and columns numbered, a heavier line every 5 squares, and four parts to zoom into so the squares are big
 * enough to copy. Two green lines show where the parts meet, on the whole grid and along each part's inner edges; the
 * parts don't overlap, and their squares are all drawn at one size. Shared by the Hot Vault's backup screens (as a
 * preview, `zoomable` off, without the green lines) and Settings > Make a SeedQR backup.
 */
export default function SeedQRGrid({ grid, width, zoomable = true }: { grid: Grid; width: number; zoomable?: boolean }) {
    const [zoom, setZoom] = useState<Zoom>('all');

    const split = seedQRSplit(grid.size);
    const rows = zoom === 'all' ? [0, grid.size] : zoom < 2 ? [0, split] : [split, grid.size];
    const cols = zoom === 'all' ? [0, grid.size] : zoom % 2 === 0 ? [0, split] : [split, grid.size];
    const rowCount = rows[1] - rows[0];
    const colCount = cols[1] - cols[0];
    // the biggest part fills the width, and the others are drawn at its scale
    const fit = zoom === 'all' ? grid.size : Math.max(split, grid.size - split);
    const cell = Math.floor((width - LABEL) / fit);
    const sideW = cell * colCount;
    const sideH = cell * rowCount;
    const labelEvery = Math.max(rowCount, colCount) > 15 ? 5 : 1;

    const squares: React.ReactNode[] = [];
    for (let r = rows[0]; r < rows[1]; r++) {
        for (let c = cols[0]; c < cols[1]; c++) {
            if (grid.filled[r * grid.size + c]) {
                squares.push(
                    <Rect key={`${r}-${c}`} x={(c - cols[0]) * cell} y={(r - rows[0]) * cell} width={cell} height={cell} fill="#000" />,
                );
            }
        }
    }
    const lines: React.ReactNode[] = [];
    // a heavier line every 5 squares, counted from the full grid, as on the templates
    for (let i = 0; i <= rowCount; i++) {
        const heavy = (rows[0] + i) % BLOCK === 0;
        lines.push(
            <Line key={`h${i}`} x1={0} y1={i * cell} x2={sideW} y2={i * cell} stroke={heavy ? HEAVY_LINE : '#BBB'} strokeWidth={heavy ? 1.5 : 0.5} />,
        );
    }
    for (let i = 0; i <= colCount; i++) {
        const heavy = (cols[0] + i) % BLOCK === 0;
        lines.push(
            <Line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={sideH} stroke={heavy ? HEAVY_LINE : '#BBB'} strokeWidth={heavy ? 1.5 : 0.5} />,
        );
    }
    // where the parts meet: across the whole grid, or along this part's inner edges (kept inside the drawing)
    const inside = (at: number, side: number) => Math.min(Math.max(at, SPLIT_LINE / 2), side - SPLIT_LINE / 2);
    if (zoomable) {
        const y = inside((split - rows[0]) * cell, sideH);
        const x = inside((split - cols[0]) * cell, sideW);
        lines.push(
            <Line key="split-h" x1={0} y1={y} x2={sideW} y2={y} stroke={colors.green} strokeWidth={SPLIT_LINE} />,
            <Line key="split-v" x1={x} y1={0} x2={x} y2={sideH} stroke={colors.green} strokeWidth={SPLIT_LINE} />,
        );
    }
    const numbers = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i + 1);

    return (
        // left-to-right in every language: the numbers have to count across the drawing the way they do on the paper
        // and steel templates, and right-to-left put the column numbers backwards and out of line with the squares
        <View style={styles.ltr}>
            {zoomable ? (
            <View style={styles.zooms}>
                {ZOOMS.map(z => (
                    <TouchableOpacity
                        key={String(z)}
                        onPress={() => setZoom(z)}
                        style={[styles.zoom, zoom === z && styles.zoomOn]}
                        accessibilityRole="button"
                    >
                        <Text style={styles.zoomText}>{zoomLabel(z)}</Text>
                    </TouchableOpacity>
                ))}
            </View>
            ) : null}
            <View style={[styles.colLabels, { marginLeft: LABEL, width: sideW }]}>
                {numbers(cols[0], colCount).map(n => (
                    <Text key={n} style={[styles.label, { width: cell }]}>
                        {n % labelEvery === 0 || n === 1 ? n : ''}
                    </Text>
                ))}
            </View>
            <View style={styles.gridRow}>
                <View style={{ width: LABEL }}>
                    {numbers(rows[0], rowCount).map(n => (
                        <Text key={n} style={[styles.label, { height: cell, lineHeight: cell }]}>
                            {n % labelEvery === 0 || n === 1 ? n : ''}
                        </Text>
                    ))}
                </View>
                <Svg width={sideW} height={sideH} style={styles.svg}>
                    <Rect x={0} y={0} width={sideW} height={sideH} fill="#FFF" />
                    {squares}
                    {lines}
                </Svg>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    ltr: {
        direction: 'ltr',
    },
    zooms: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 12,
    },
    zoom: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#444',
        marginRight: 6,
        marginBottom: 6,
    },
    zoomOn: {
        borderColor: colors.green,
        backgroundColor: 'rgba(35, 196, 127, 0.2)',
    },
    zoomText: {
        fontSize: 13,
        lineHeight: 16,
    },
    colLabels: {
        flexDirection: 'row',
    },
    gridRow: {
        flexDirection: 'row',
    },
    label: {
        fontSize: 9,
        lineHeight: 14,
        color: colors.gray.light,
        textAlign: 'center',
    },
    svg: {
        backgroundColor: '#FFF',
    },
});
