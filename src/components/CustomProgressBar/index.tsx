import React from 'react';
import { StyleSheet, View } from 'react-native';

interface Props {
    value: number;
}

const TOTAL_CHUNKS = 10;

// Capsule size bands. Same boundaries and palette as the capsule catalog
// guide (src/screens/CapsuleCatalog) and the capsule art chosen in
// src/components/VaultCapsules, so the Strike amount bar, the vault
// capsules and the legend all read off one ladder.
//
//   0    - 100K   white
//   100K - 1.1M   orange
//   1.1M - 11M    green
//   11M  - 110M   pink
//   110M - 1.1B   blue
//   1.1B +        red
//
// This used to stop at four bands: blue began at 11M and ran to infinity,
// so pink and red never appeared and every amount above green looked the
// same. Within a band the ten chunks fill on that band's own step, which
// is why each branch carries its own divisor, and the bottom of each band
// is one chunk rather than a proportional fraction. That mirrors the mask1
// exception in VaultCapsules.
function getColorAndFill(value: number): { color: string; filledChunks: number } {
    if (value >= 1_100_000_000) {
        // Red: whale tier, always full.
        return { color: '#FF0000', filledChunks: TOTAL_CHUNKS };
    } else if (value >= 110_000_000) {
        // Blue: 110M=1, 200M=2, 300M=3 ... 1B=10
        if (value < 200_000_000) return { color: '#1693ED', filledChunks: 1 };
        return { color: '#1693ED', filledChunks: Math.min(Math.floor(value / 100_000_000), 10) };
    } else if (value >= 11_000_000) {
        // Pink: 11M=1, 20M=2, 30M=3 ... 100M=10
        if (value < 20_000_000) return { color: '#FF69B4', filledChunks: 1 };
        return { color: '#FF69B4', filledChunks: Math.min(Math.floor(value / 10_000_000), 10) };
    } else if (value >= 1_100_000) {
        // Green: 1.1M=1, 2M=2, 3M=3 ... 10M=10
        if (value < 2_000_000) return { color: '#23C47F', filledChunks: 1 };
        return { color: '#23C47F', filledChunks: Math.min(Math.floor(value / 1_000_000), 10) };
    } else if (value >= 100_000) {
        // Orange: 100K to 1.1M, step 100K
        const chunks = Math.min(Math.ceil((value - 100_000) / 100_000), 10);
        return { color: '#FF8C00', filledChunks: Math.max(chunks, 1) };
    } else {
        // White: 0 to 100K, step 10K
        const chunks = Math.min(Math.ceil(value / 10_000), 10);
        return { color: '#FFFFFF', filledChunks: Math.max(chunks, 1) };
    }
}

export default function CustomProgressBar({ value }: Props) {
    console.log("🚀 ~ CustomProgressBar ~ value:", value);
    const { color, filledChunks } = getColorAndFill(value);

    return (
        <View style={styles.container}>
            {Array.from({ length: TOTAL_CHUNKS }).map((_, i) => (
                <View
                    key={i}
                    style={[
                        styles.chunk,
                        {
                            backgroundColor: i < filledChunks ? color : 'transparent',
                            borderWidth: 1,
                            borderColor: color,
                        },
                    ]}
                />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        height: 13,
        width: 68,
        borderRadius: 4,
        borderWidth: 0.8,
        borderColor: '#FFFFFF',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 2,
        paddingVertical: 1.5,
        gap: 1.5,
    },
    chunk: {
        flex: 1,
        height: '100%',
        borderRadius: 2,
    },
});
