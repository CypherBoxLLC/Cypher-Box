import React from 'react';
import { StyleSheet, View } from 'react-native';

interface Props {
    value: number;
}

const TOTAL_CHUNKS = 10;

function getColorAndFill(value: number): { color: string; filledChunks: number } {
    if (value >= 11_000_000) {
        // Blue: 11M=1, 20M=2, 30M=3 ... 100M=10
        if (value < 20_000_000) return { color: '#4488FF', filledChunks: 1 };
        const chunks = Math.min(Math.floor(value / 10_000_000), 10);
        return { color: '#4488FF', filledChunks: chunks };
    } else if (value >= 1_100_000) {
        // Green: 1.1M=1, 2M=2, 3M=3 ... 10M=10
        if (value < 2_000_000) return { color: '#44DD44', filledChunks: 1 };
        const chunks = Math.min(Math.floor(value / 1_000_000), 10);
        return { color: '#44DD44', filledChunks: chunks };
    } else if (value >= 100_000) {
        // Orange: 100K to 1.1M, step 100K
        const chunks = Math.min(Math.ceil((value - 100_000) / 100_000), 10);
        return { color: '#FF6600', filledChunks: Math.max(chunks, 1) };
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
