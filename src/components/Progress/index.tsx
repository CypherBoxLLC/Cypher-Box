import { colors } from "@Cypher/style-guide";
import React from "react";
import { View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import styles from "./styles";

interface Props {
    current: number;
    color?: string[];
    /**
     * How many steps the flow has. Three unless a flow says otherwise: Hot
     * Vault creation has four once it ends on the USDT screen.
     */
    steps?: number;
}

/** What the three-step bar's two 80pt connectors add up to. */
const CONNECTORS_TOTAL_WIDTH = 160;

/**
 * Progress step indicator. One dot per step (three by default), filled
 * left-to-right as `current` climbs. The connectors share a fixed total width,
 * so a longer flow packs its dots closer instead of growing the bar.
 *
 * Why the same-color fast path:
 *   Under RN 0.76 New Arch (Fabric) with react-native-linear-gradient@2.8.3
 *   — which has no codegenConfig and therefore goes through the Fabric
 *   interop layer — each <LinearGradient> mount costs hundreds of ms.
 *   Every caller of this component currently passes a palette whose two
 *   stops are identical (e.g. [colors.green, colors.green]), meaning each
 *   of the three LinearGradients here was painting a solid color anyway
 *   while paying the full native-view creation tax. We detect that case
 *   and short-circuit to a plain <View style={{backgroundColor}}> —
 *   visually identical, but mounts in microseconds. True two-stop
 *   gradients still get the LinearGradient path.
 */
export default function Progress({ current = 0, color, steps = 3 }: Props) {
    const data = Array.from({ length: Math.max(1, steps) }, (_, i) => i + 1);
    const connectorWidth = CONNECTORS_TOTAL_WIDTH / Math.max(1, data.length - 1);

    const renderSegment = (filled: boolean, index: number) => {
        const palette = filled
            ? (color ? color : [colors.pink.default, colors.pink.light])
            : [colors.black.light, colors.black.light];

        if (palette[0] === palette[1]) {
            return (
                <View
                    key={index}
                    style={[styles.linear, { backgroundColor: palette[0] }]}
                />
            );
        }
        return (
            <LinearGradient
                key={index}
                style={styles.linear}
                start={{ x: 1, y: 0 }}
                end={{ x: 0, y: 0 }}
                colors={palette}
            />
        );
    };

    return (
        <View style={styles.container}>
            {data.map((_, index) => (
                <React.Fragment key={index}>
                    {renderSegment(current >= index, index)}
                    {index !== data.length - 1 && (
                        <View style={{
                            width: connectorWidth, height: 1,
                            backgroundColor: (current - 1) >= index ? color ? (color[0] || colors.green) : colors.pink.default : colors.black.light,
                        }} />
                    )}
                </React.Fragment>
            ))}
        </View>
    );
}