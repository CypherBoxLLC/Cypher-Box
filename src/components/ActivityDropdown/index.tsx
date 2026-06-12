import React, { useMemo } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { Text } from "@Cypher/component-library";
import useEvents from "@Cypher/custom-hooks/useEvents";
import { dispatchNavigate } from "@Cypher/helpers";
import { Row } from "@Cypher/screens/Activity";

interface Props {
    visible: boolean;
    onClose: () => void;
}

/**
 * Dropdown preview for the in-app event log, anchored under the bell icon
 * in HomeScreen header.
 *
 * Shows up to MAX_PREVIEW most-recent events plus a "Show more" footer that
 * pushes to the full Activity screen. Reuses `Row` from `screens/Activity`
 * so the dropdown and the screen render the same per-kind copy and icons —
 * any drift would be a real bug, not a styling difference.
 *
 * Layered as a transparent Modal:
 *   - Modal handles Android back-button dismiss (`onRequestClose`) and the
 *     z-index above any nav-stack content underneath.
 *   - Backdrop Pressable dismisses on tap-outside.
 *   - Inner Pressable swallows the tap so a click inside the card doesn't
 *     bubble up to the backdrop and close the dropdown.
 *
 * Positioning: hardcoded `top: 90, right: 16` for now — lands roughly under
 * the bell on a Galaxy A14 / iPhone 13. If users on smaller / larger devices
 * report drift, switch to `useSafeAreaInsets()` and offset by header height.
 *
 * Privacy: `Row` already sanitizes — sats + relative time + wallet kind
 * only. No address or invoice surfaces here.
 */
const MAX_PREVIEW = 5;

export default function ActivityDropdown({ visible, onClose }: Props) {
    const events = useEvents();
    // Snapshot `now` once per render so all rows in this paint compute the
    // same relative time. Re-evaluates when the events list changes (which
    // is the only signal that matters — no need for a clock tick).
    const now = useMemo(() => Date.now(), [events.length]);
    const preview = events.slice(0, MAX_PREVIEW);

    // Early-return null when hidden so the component has zero footprint
    // in the parent's layout tree. RN 0.76 New Arch (Fabric) has been
    // observed to leak Modal-internal width onto sibling cards in some
    // configurations even with `visible={false}` — bypass entirely by
    // not rendering the Modal at all when closed. The fade animation
    // still works because the Modal mounts fresh on each open with
    // `animationType="fade"`.
    if (!visible) return null;

    const handleShowMore = () => {
        onClose();
        dispatchNavigate("Activity");
    };

    return (
        <Modal
            transparent
            visible={visible}
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable style={styles.backdrop} onPress={onClose}>
                {/* Inner Pressable: blocks tap-bubble so taps inside the
                    card don't dismiss. The empty onPress is intentional. */}
                <Pressable style={styles.card} onPress={() => {}}>
                    {events.length === 0 ? (
                        <View style={styles.empty}>
                            <Text style={styles.emptyText}>No activity yet.</Text>
                        </View>
                    ) : (
                        <View style={styles.list}>
                            {preview.map((ev, idx) => (
                                <View key={ev.id}>
                                    <Row ev={ev} now={now} />
                                    {idx < preview.length - 1 && (
                                        <View style={styles.sep} />
                                    )}
                                </View>
                            ))}
                        </View>
                    )}
                    <Pressable
                        style={styles.showMore}
                        onPress={handleShowMore}
                        accessibilityLabel="Show all activity"
                    >
                        <Text style={styles.showMoreText}>Show more</Text>
                    </Pressable>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.3)",
    },
    card: {
        position: "absolute",
        top: 90,
        right: 16,
        width: 320,
        maxHeight: 480,
        backgroundColor: "#1f2332",
        borderRadius: 12,
        paddingVertical: 4,
        shadowColor: "#000",
        shadowOpacity: 0.35,
        shadowOffset: { width: 0, height: 6 },
        shadowRadius: 14,
        elevation: 10,
        overflow: "hidden",
    },
    list: {
        paddingTop: 4,
    },
    sep: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: "rgba(255,255,255,0.08)",
        marginLeft: 70,
    },
    showMore: {
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "rgba(255,255,255,0.1)",
        alignItems: "center",
    },
    showMoreText: {
        color: "#7CB9F8",
        fontSize: 14,
        fontFamily: "Lato-Bold",
    },
    empty: {
        paddingVertical: 24,
        paddingHorizontal: 20,
        alignItems: "center",
    },
    emptyText: {
        color: "rgba(255,255,255,0.5)",
        fontSize: 14,
    },
});
