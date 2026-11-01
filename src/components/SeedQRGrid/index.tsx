import React, { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";

import { Text } from "@Cypher/component-library";
import type { SeedQRGrid as Grid } from "@Cypher/helpers/seedQR";
import { colors } from "@Cypher/style-guide";

type Zoom = 'all' | 0 | 1 | 2 | 3;

const ZOOMS: { key: Zoom; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 0, label: 'Top left' },
    { key: 1, label: 'Top right' },
    { key: 2, label: 'Bottom left' },
    { key: 3, label: 'Bottom right' },
];

const LABEL = 18;

/**
 * A SeedQR drawn as a numbered grid to copy by hand, the way SeedSigner's paper and steel templates are laid out:
 * rows and columns numbered, a heavier line every 5 squares, and each quarter zoomable so the squares are big enough
 * to copy. Shared by the Hot Vault's backup screens (as a preview, `zoomable` off) and Settings > Make a SeedQR
 * backup.
 */
export default function SeedQRGrid({ grid, width, zoomable = true }: { grid: Grid; width: number; zoomable?: boolean }) {
    const [zoom, setZoom] = useState<Zoom>('all');

    const half = Math.ceil(grid.size / 2);
    const rows = zoom === 'all' ? [0, grid.size] : zoom < 2 ? [0, half] : [grid.size - half, grid.size];
    const cols = zoom === 'all' ? [0, grid.size] : zoom % 2 === 0 ? [0, half] : [grid.size - half, grid.size];
    const count = rows[1] - rows[0];
    const cell = Math.floor((width - LABEL) / count);
    const side = cell * count;
    const labelEvery = count > 15 ? 5 : 1;

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
    for (let i = 0; i <= count; i++) {
        // a heavier line every 5 squares, counted from the full grid, as on the templates
        const heavyRow = (rows[0] + i) % 5 === 0;
        const heavyCol = (cols[0] + i) % 5 === 0;
        lines.push(
            <Line key={`h${i}`} x1={0} y1={i * cell} x2={side} y2={i * cell} stroke={heavyRow ? colors.blueText : '#BBB'} strokeWidth={heavyRow ? 1.5 : 0.5} />,
            <Line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={side} stroke={heavyCol ? colors.blueText : '#BBB'} strokeWidth={heavyCol ? 1.5 : 0.5} />,
        );
    }
    const numbers = (from: number) => Array.from({ length: count }, (_, i) => from + i + 1);

    return (
        <View>
            {zoomable ? (
            <View style={styles.zooms}>
                {ZOOMS.map(z => (
                    <TouchableOpacity
                        key={String(z.key)}
                        onPress={() => setZoom(z.key)}
                        style={[styles.zoom, zoom === z.key && styles.zoomOn]}
                        accessibilityRole="button"
                    >
                        <Text style={styles.zoomText}>{z.label}</Text>
                    </TouchableOpacity>
                ))}
            </View>
            ) : null}
            <View style={[styles.colLabels, { marginLeft: LABEL, width: side }]}>
                {numbers(cols[0]).map(n => (
                    <Text key={n} style={[styles.label, { width: cell }]}>
                        {n % labelEvery === 0 || n === 1 ? n : ''}
                    </Text>
                ))}
            </View>
            <View style={styles.gridRow}>
                <View style={{ width: LABEL }}>
                    {numbers(rows[0]).map(n => (
                        <Text key={n} style={[styles.label, { height: cell, lineHeight: cell }]}>
                            {n % labelEvery === 0 || n === 1 ? n : ''}
                        </Text>
                    ))}
                </View>
                <Svg width={side} height={side} style={styles.svg}>
                    <Rect x={0} y={0} width={side} height={side} fill="#FFF" />
                    {squares}
                    {lines}
                </Svg>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
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
        borderColor: colors.blueText,
        backgroundColor: 'rgba(22, 147, 237, 0.2)',
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
