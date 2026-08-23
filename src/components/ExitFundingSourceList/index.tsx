import React from 'react';
import { TouchableOpacity, View } from 'react-native';

import { Text } from '@Cypher/component-library';
import { colors } from '@Cypher/style-guide';
import type {
    ExitFundingSource,
    ExitFundingSourceId,
} from '@Cypher/services/ark/exitFundingSources';

/**
 * "Fund exit fees from another wallet" picker.
 *
 * Presentational only: the caller decides which sources exist (see
 * buildExitFundingSources) and what selecting one does. Keeping the rules out
 * of here is what lets them be unit-tested.
 *
 * Unavailable rows are rendered, dimmed, with their reason. Hiding them makes
 * the feature look broken to someone who expected their wallet to be listed;
 * showing them says what to fix. They are not tappable, so the dead end is
 * visible rather than discovered by tapping.
 */

type Props = {
    sources: readonly ExitFundingSource[];
    onSelect: (id: ExitFundingSourceId) => void;
    /** Sats still needed, for the per-row "covers it / partial" hint. */
    shortfallSats?: number;
};

function balanceLine(source: ExitFundingSource, shortfallSats?: number): string | null {
    if (source.balanceSats == null) return null;
    const bal = `${source.balanceSats.toLocaleString()} sats`;
    if (!shortfallSats || shortfallSats <= 0) return bal;
    // Say up front whether this one finishes the job, so the user does not pick
    // a wallet, walk through a confirm screen and only then discover it is
    // short.
    return source.balanceSats >= shortfallSats ? `${bal} · covers it` : `${bal} · partial`;
}

export default function ExitFundingSourceList({ sources, onSelect, shortfallSats }: Props) {
    return (
        <View>
            {sources.map((source) => {
                const sub = source.available
                    ? balanceLine(source, shortfallSats)
                    : source.unavailableReason ?? null;

                return (
                    <TouchableOpacity
                        key={source.id}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !source.available }}
                        disabled={!source.available}
                        activeOpacity={0.7}
                        onPress={() => onSelect(source.id)}
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingHorizontal: 14,
                            paddingVertical: 14,
                            borderRadius: 12,
                            marginBottom: 8,
                            backgroundColor: 'rgba(255,255,255,0.06)',
                            opacity: source.available ? 1 : 0.45,
                        }}
                    >
                        <View style={{ flex: 1, paddingRight: 12 }}>
                            <Text bold style={{ fontSize: 15 }}>
                                {source.label}
                            </Text>
                            {!!sub && (
                                <Text style={{ fontSize: 12, color: '#AAA', marginTop: 3 }}>
                                    {sub}
                                </Text>
                            )}
                        </View>

                        {/* Cold Vault is the slow one. Saying so on the row is the
                            difference between an informed choice and a surprise
                            hardware-wallet round-trip mid-exit. */}
                        {source.slow && source.available && (
                            <Text style={{ fontSize: 11, color: colors.gray?.thin ?? '#888' }}>
                                needs your signing device
                            </Text>
                        )}
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}
