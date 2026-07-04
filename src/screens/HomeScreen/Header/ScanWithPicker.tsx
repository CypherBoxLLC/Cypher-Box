import React from 'react';
import {
    Image,
    Modal,
    Pressable,
    TouchableOpacity,
    View,
} from 'react-native';

import { Text } from '@Cypher/component-library';
import {
    CoinOS as CoinOSIcon,
    Cold1 as ColdIcon,
    Hot as HotIcon,
    StrikeFull,
} from '@Cypher/assets/images';
import { colors } from '@Cypher/style-guide';

/**
 * Stable wallet keys — used by the parent's onSelect to dispatch the right
 * send-screen flow. These match the wallet-rail vocabulary used elsewhere
 * (SendListNew tile ids are integers; we use string keys here so the call
 * site reads as code, not as magic numbers).
 */
export type ScanTargetKey = 'strike' | 'coinos' | 'hotVault' | 'coldVault' | 'ark';

interface Props {
    visible: boolean;
    onClose: () => void;
    onSelect: (key: ScanTargetKey) => void;
    available: {
        strike: boolean;
        coinos: boolean;
        hotVault: boolean;
        coldVault: boolean;
        ark: boolean;
    };
}

/**
 * "Scan with" modal — gates the camera behind an explicit wallet/vault
 * choice so the QR routing is unambiguous. Without this step a scanned
 * Bitcoin address could equally well be paid from any of the on-chain
 * rails (Hot Vault / Cold Vault / Ark on-chain) and we'd have to guess.
 *
 * Layout: vertical list of buttons. Disabled rows for rails the user
 * hasn't connected yet (rendered at low opacity, non-tappable) so they
 * see "yes, this exists, you'd just need to set it up first" rather than
 * an empty list that suggests we forgot.
 *
 * Tapping a row fires `onSelect(key)` and the parent owns the camera +
 * routing dance. Keeping this component dumb means the same picker can
 * later be reused for a "Receive with" flow if we want a symmetric UX.
 */
export default function ScanWithPicker({ visible, onClose, onSelect, available }: Props) {
    const rows: Array<{
        key: ScanTargetKey;
        label: string;
        subtitle: string;
        icon: any;
        isLogo?: boolean;
        textLabel?: string;
        accent: string;
    }> = [
        {
            key: 'strike',
            label: 'Strike',
            subtitle: 'Lightning · custodial',
            icon: StrikeFull,
            isLogo: true,
            accent: colors.pink.default,
        },
        {
            key: 'coinos',
            label: 'CoinOS',
            subtitle: 'Lightning · custodial',
            icon: CoinOSIcon,
            isLogo: true,
            accent: '#ffd166',
        },
        {
            key: 'ark',
            label: 'Bark Vault',
            subtitle: 'Lightning · self-custodial',
            icon: null,
            textLabel: 'ARK',
            accent: colors.ark?.light ?? '#7DD3FC',
        },
        {
            key: 'hotVault',
            label: 'Hot Vault',
            subtitle: 'Bitcoin on-chain',
            icon: HotIcon,
            accent: '#ff9a3c',
        },
        {
            key: 'coldVault',
            label: 'Cold Vault',
            subtitle: 'Bitcoin on-chain',
            icon: ColdIcon,
            accent: '#7fb3ff',
        },
    ];

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable style={modalStyles.backdrop} onPress={onClose}>
                {/* Inner Pressable swallows taps on the sheet itself so the
                    backdrop dismiss only fires when tapping outside. */}
                <Pressable style={modalStyles.sheet} onPress={() => {}}>
                    <Text bold style={modalStyles.title}>
                        Scan with
                    </Text>
                    <Text style={modalStyles.subtitle}>
                        Choose which wallet pays the scanned address or invoice.
                    </Text>

                    {rows.map((row) => {
                        const enabled = available[row.key];
                        return (
                            <TouchableOpacity
                                key={row.key}
                                disabled={!enabled}
                                onPress={() => {
                                    onClose();
                                    // Defer the parent's navigation to next
                                    // tick so the modal-close animation can
                                    // start before iOS opens the camera —
                                    // both transitions racing produces a
                                    // visible flicker.
                                    setTimeout(() => onSelect(row.key), 120);
                                }}
                                style={[
                                    modalStyles.row,
                                    { opacity: enabled ? 1 : 0.35, borderColor: enabled ? row.accent : '#333' },
                                ]}
                                activeOpacity={0.7}
                            >
                                <View style={modalStyles.rowIconWrap}>
                                    {row.isLogo ? (
                                        <Image source={row.icon} style={modalStyles.logo} resizeMode="contain" />
                                    ) : row.textLabel ? (
                                        <Text bold style={[modalStyles.textLogo, { color: row.accent }]}>
                                            {row.textLabel}
                                        </Text>
                                    ) : (
                                        <Image source={row.icon} style={modalStyles.icon} resizeMode="contain" />
                                    )}
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text bold style={modalStyles.rowLabel}>
                                        {row.label}
                                    </Text>
                                    <Text style={modalStyles.rowSubtitle}>
                                        {enabled ? row.subtitle : `${row.subtitle} · not connected`}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        );
                    })}

                    <TouchableOpacity onPress={onClose} style={modalStyles.cancel}>
                        <Text bold style={modalStyles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const modalStyles = {
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'flex-end' as const,
    },
    sheet: {
        backgroundColor: '#111',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 18,
        paddingTop: 18,
        paddingBottom: 32,
    },
    title: {
        fontSize: 18,
        color: colors.white,
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 13,
        color: '#888',
        marginBottom: 14,
    },
    row: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        backgroundColor: '#1a1a1a',
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 12,
        marginBottom: 8,
    },
    rowIconWrap: {
        width: 56,
        height: 32,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        marginRight: 10,
    },
    logo: {
        width: 60,
        height: 24,
    },
    icon: {
        width: 28,
        height: 28,
    },
    textLogo: {
        fontSize: 18,
        letterSpacing: 2,
    },
    rowLabel: {
        fontSize: 15,
        color: colors.white,
    },
    rowSubtitle: {
        fontSize: 12,
        color: '#888',
        marginTop: 2,
    },
    cancel: {
        marginTop: 6,
        alignSelf: 'center' as const,
        paddingVertical: 10,
        paddingHorizontal: 24,
    },
    cancelText: {
        fontSize: 14,
        color: '#aaa',
    },
};
