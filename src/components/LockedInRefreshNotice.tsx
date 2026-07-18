import React from 'react';
import { TouchableOpacity, View } from 'react-native';

import { Text } from '@Cypher/component-library';
import { dispatchNavigate } from '@Cypher/helpers';
import useAuthStore from '@Cypher/stores/authStore';

/**
 * Shown in the Ark send / withdraw / swap flows when the user can't spend
 * because their funds are LOCKED in an in-flight refresh round. Instead of a
 * dead-end "insufficient balance", it tells them the funds exist but are
 * mid-refresh and routes them to the Capsules tab, where the refresh can be
 * cancelled.
 *
 * We deliberately do NOT offer an inline "cancel to spend" here: cancelling a
 * round can take up to ~an hour, so an inline button would read as instant and
 * mislead. The Capsules screen owns cancel and communicates its timing.
 *
 * COPY IS A PLACEHOLDER. Final wording is Bam's to design.
 */
export default function LockedInRefreshNotice({ lockedSats }: { lockedSats: number }) {
    const arkWallet = useAuthStore((s) => s.arkWallet);

    const goToCapsules = () => {
        dispatchNavigate('CheckingAccountNew', {
            wallet: arkWallet,
            accountType: 'ark',
            initialTab: 0, // Ark's tab 0 = Capsules (where refresh can be cancelled)
        });
    };

    return (
        <View
            style={{
                marginTop: 12,
                marginHorizontal: 4,
                padding: 12,
                borderRadius: 10,
                backgroundColor: 'rgba(255, 200, 80, 0.06)',
                borderWidth: 1,
                borderColor: 'rgba(255, 200, 80, 0.30)',
            }}
        >
            <Text style={{ fontSize: 12, color: '#CCC', lineHeight: 17 }}>
                {lockedSats.toLocaleString()} sats are in a pending refresh, not lost.
                Cancel the refresh from Capsules to spend them.
            </Text>
            <TouchableOpacity
                onPress={goToCapsules}
                style={{
                    marginTop: 10,
                    paddingVertical: 10,
                    borderRadius: 8,
                    alignItems: 'center',
                    backgroundColor: '#FFD54F',
                }}
            >
                <Text bold style={{ fontSize: 13, color: '#1C1C1C' }}>
                    Go to Capsules to cancel refresh
                </Text>
            </TouchableOpacity>
        </View>
    );
}
