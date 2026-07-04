import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";
import RBSheet from "react-native-raw-bottom-sheet";

import { Button, Text } from "@Cypher/component-library";
import { openInAppBrowser } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";

// Strike app store listings (verified via the iTunes Search API and a
// Play Store search 2026-06-13). URLs are region-agnostic; iOS / Android
// route to the user's local store, surfacing a "not available in your
// region" page if Strike isn't published there.
const STRIKE_APP_STORE_URL = "https://apps.apple.com/app/id1488724463";
const STRIKE_PLAY_STORE_URL =
    "https://play.google.com/store/apps/details?id=zapsolutions.strike";
const STRIKE_SIGNUP_WEB_URL = "https://dashboard.strike.me/signup";

export type StrikeSignupSheetRef = {
    open: () => void;
    close: () => void;
};

// Themed bottom sheet shown when the user taps "Create" on a Strike
// sign-up surface. Mirrors the project's other RBSheet bottom sheets
// (see HomeScreen SwapSheet) for visual consistency. Three actions:
//   - Install the Strike app (App Store / Play Store)
//   - Continue on Strike's web sign-up (in-app browser)
//   - Cancel
// All three are Apple-policy compliant (no system-browser handoff).
const StrikeSignupSheet = forwardRef<StrikeSignupSheetRef>((_, ref) => {
    const sheetRef = useRef<any>(null);

    useImperativeHandle(ref, () => ({
        open: () => sheetRef.current?.open(),
        close: () => sheetRef.current?.close(),
    }));

    const handleInstall = () => {
        sheetRef.current?.close();
        const url =
            Platform.OS === "ios" ? STRIKE_APP_STORE_URL : STRIKE_PLAY_STORE_URL;
        Linking.openURL(url);
    };

    const handleWeb = () => {
        sheetRef.current?.close();
        openInAppBrowser(STRIKE_SIGNUP_WEB_URL);
    };

    const handleCancel = () => {
        sheetRef.current?.close();
    };

    return (
        <RBSheet
            ref={sheetRef}
            height={360}
            openDuration={350}
            closeDuration={250}
            draggable
            dragOnContent
            closeOnPressBack
            customStyles={{
                wrapper: { backgroundColor: colors.shadow50 },
                draggableIcon: { backgroundColor: "#555", width: 40 },
                container: {
                    backgroundColor: colors.gray.dark,
                    borderTopLeftRadius: 20,
                    borderTopRightRadius: 20,
                },
            }}
        >
            <View style={styles.body}>
                {/* TODO(bam): UI copy placeholders. Replace the title,
                    message, and three button labels with the wording you
                    want before merging. */}
                <Text bold center style={styles.title}>
                    Sign up for Strike
                </Text>
                <Text center style={styles.message}>
                    Strike's mobile sign-up works best in their app. How would
                    you like to continue?
                </Text>
                <Button
                    text="Get the Strike app"
                    onPress={handleInstall}
                    style={styles.primaryBtn}
                />
                <Button
                    text="Continue in browser"
                    onPress={handleWeb}
                    style={styles.secondaryBtn}
                    textStyle={styles.secondaryBtnText}
                />
                <Button
                    text="Cancel"
                    onPress={handleCancel}
                    style={styles.cancelBtn}
                    textStyle={styles.cancelBtnText}
                />
            </View>
        </RBSheet>
    );
});

StrikeSignupSheet.displayName = "StrikeSignupSheet";

const styles = StyleSheet.create({
    body: {
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 28,
    },
    title: {
        fontSize: 20,
        color: colors.white,
        marginBottom: 8,
    },
    message: {
        fontSize: 14,
        color: colors.gray.text,
        marginBottom: 22,
        lineHeight: 20,
    },
    primaryBtn: {
        marginBottom: 10,
    },
    secondaryBtn: {
        marginBottom: 10,
        backgroundColor: "transparent",
        borderColor: colors.white,
    },
    secondaryBtnText: {
        color: colors.white,
    },
    cancelBtn: {
        backgroundColor: "transparent",
        borderColor: "transparent",
        borderWidth: 0,
    },
    cancelBtnText: {
        color: colors.gray.text,
    },
});

export default StrikeSignupSheet;
