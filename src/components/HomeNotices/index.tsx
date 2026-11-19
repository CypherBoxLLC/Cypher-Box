import React, { useEffect, useState } from 'react';
import { I18nManager, LayoutChangeEvent, StyleProp, StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import SimpleToast from 'react-native-simple-toast';

import { Text } from '@Cypher/component-library';
import { HomeNotice, HomeNoticeSeverity, isIgnorable, visibleHomeNotices } from '@Cypher/services/homeNotices';
import useAuthStore from '@Cypher/stores/authStore';
import useEventLogStore from '@Cypher/stores/eventLogStore';
import { colors } from '@Cypher/style-guide';
import loc from '../../../loc';

// The icons sit at the right edge of the screen in both languages. A row runs from the right in Arabic, so the
// right edge is its start there and its end in English.
const RIGHT_EDGE = I18nManager.isRTL ? 'flex-start' : 'flex-end';

/** Notice colours, shared with the "ignored" rows in Activity. */
export const HOME_NOTICE_COLORS: Record<HomeNoticeSeverity, string> = {
    red: colors.redLight,
    // The amber the refresh wait banner and the boarding row already use.
    yellow: '#FFD54F',
    green: colors.green,
};

function withAlpha(hex: string, alpha: number): string {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface Props {
    notices: ReadonlyArray<HomeNotice | null | undefined | false>;
    style?: StyleProp<ViewStyle>;
    /** Closes an open message when it changes, e.g. when the carousel leaves the page. */
    closeKey?: unknown;
    onLayout?: (event: LayoutChangeEvent) => void;
}

/** The message, with `linkText` underlined as the tap hint. */
function NoticeText({ notice, color }: { notice: HomeNotice; color: string }) {
    const text = notice.text ?? '';
    let body: React.ReactNode = text;
    const idx = notice.linkText ? text.indexOf(notice.linkText) : -1;
    if (notice.linkText && idx >= 0) {
        body = (
            <>
                {text.slice(0, idx)}
                <Text bold style={[styles.link, { color }]}>
                    {notice.linkText}
                </Text>
                {text.slice(idx + notice.linkText.length)}
            </>
        );
    }
    const line = (
        <Text style={[styles.messageText, { color }]}>
            {body}
        </Text>
    );
    if (!notice.onPress) return line;
    return (
        <TouchableOpacity onPress={notice.onPress} activeOpacity={0.7} accessibilityRole="button">
            {line}
        </TouchableOpacity>
    );
}

/**
 * Home's contextual notices as a row of coloured icons (red critical, yellow
 * warning, green tip) at the right edge of the screen. Tapping an icon shows
 * its message underneath and tapping it again hides it; one message is open at
 * a time.
 *
 * Yellow and green icons carry a small × that ignores the notice: it is hidden
 * until its situation changes (services/homeNotices.ts), and it goes into
 * Activity under the bell, where it can be read again and brought back with
 * "Show again" after a mis-tap. Red ones have no × and cannot be ignored.
 *
 * The container is always drawn, at zero height when nothing shows, so a
 * parent measuring it through onLayout sees it shrink back.
 */
export default function HomeNotices({ notices, style, closeKey, onLayout }: Props) {
    const ignored = useAuthStore((s) => s.homeNoticeIgnores);
    const ignoreHomeNotice = useAuthStore((s) => s.ignoreHomeNotice);
    const recordEvent = useEventLogStore((s) => s.recordEvent);
    const shown = visibleHomeNotices(notices, ignored);
    const [openId, setOpenId] = useState<string | null>(null);
    const open = shown.find((n) => n.id === openId) ?? null;

    useEffect(() => {
        setOpenId(null);
    }, [closeKey]);

    if (shown.length === 0) {
        return <View style={style} onLayout={onLayout} />;
    }

    const ignore = (notice: HomeNotice) => {
        if (notice.severity === 'red') return;
        ignoreHomeNotice(notice.id, notice.situation);
        recordEvent({
            kind: 'notice-ignored',
            noticeId: notice.id,
            text: notice.text ?? notice.accessibilityLabel ?? '',
            severity: notice.severity,
            icon: notice.icon,
            situation: notice.situation,
        });
        if (openId === notice.id) setOpenId(null);
        SimpleToast.show(loc.cypherbox.home.notice_ignored_toast, SimpleToast.SHORT);
    };

    return (
        <View style={style} onLayout={onLayout}>
            <View style={styles.icons}>
                {shown.map((notice) => {
                    const color = HOME_NOTICE_COLORS[notice.severity];
                    const isOpen = notice.id === open?.id;
                    const label = notice.accessibilityLabel ?? notice.text;
                    return (
                        // A slot a little bigger than the icon, so the × in its
                        // corner stays inside it: touches outside a parent's
                        // bounds do not land on iOS.
                        <View key={notice.id} style={styles.slot}>
                            <TouchableOpacity
                                testID={`home-notice-${notice.id}`}
                                onPress={() => setOpenId(isOpen ? null : notice.id)}
                                activeOpacity={0.7}
                                hitSlop={{ top: 6, bottom: 8, left: 4, right: 4 }}
                                accessibilityRole="button"
                                accessibilityLabel={label}
                                accessibilityState={{ expanded: isOpen }}
                                style={[
                                    styles.icon,
                                    { borderColor: color, backgroundColor: isOpen ? color : withAlpha(color, 0.15) },
                                ]}
                            >
                                <Ionicons name={notice.icon} size={16} color={isOpen ? colors.black.default : color} />
                            </TouchableOpacity>
                            {isIgnorable(notice) && (
                                <TouchableOpacity
                                    testID={`home-notice-ignore-${notice.id}`}
                                    onPress={() => ignore(notice)}
                                    activeOpacity={0.7}
                                    hitSlop={{ top: 4, bottom: 2, left: 2, right: 4 }}
                                    accessibilityRole="button"
                                    accessibilityLabel={label ? `${loc.cypherbox.home.notice_ignore}: ${label}` : loc.cypherbox.home.notice_ignore}
                                    style={styles.dismiss}
                                >
                                    <Ionicons name="close" size={10} color={colors.white} />
                                </TouchableOpacity>
                            )}
                        </View>
                    );
                })}
            </View>
            {open && (
                // An outline in the notice's colour, with no fill.
                <View style={[styles.message, { borderColor: withAlpha(HOME_NOTICE_COLORS[open.severity], 0.45) }]}>
                    {open.content ?? <NoticeText notice={open} color={HOME_NOTICE_COLORS[open.severity]} />}
                    {!open.content && open.actions?.map((action) => (
                        <TouchableOpacity
                            key={action.label}
                            onPress={action.onPress}
                            activeOpacity={0.7}
                            hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                            accessibilityRole="button"
                        >
                            <Text bold style={styles.action}>
                                {action.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    icons: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: RIGHT_EDGE,
        gap: 6,
    },
    slot: {
        width: 40,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
    },
    icon: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // Top end corner of the slot, overlapping the icon's edge. `end` follows
    // the layout direction, so it sits top-left in Arabic.
    dismiss: {
        position: 'absolute',
        top: 0,
        end: 0,
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.gray.light,
        backgroundColor: '#2a2a2a',
        alignItems: 'center',
        justifyContent: 'center',
    },
    message: {
        alignSelf: 'stretch',
        marginTop: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
    },
    link: {
        textDecorationLine: 'underline',
    },
    messageText: {
        fontSize: 13,
        lineHeight: 18,
        textAlign: 'center',
    },
    action: {
        marginTop: 6,
        fontSize: 13,
        color: colors.gray.light,
        textAlign: 'center',
        textDecorationLine: 'underline',
    },
});
