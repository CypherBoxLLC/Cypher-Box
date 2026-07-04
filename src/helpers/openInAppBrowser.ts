import { Linking } from "react-native";
import InAppBrowser from "react-native-inappbrowser-reborn";

// Opens an external URL inside the app (SFSafariViewController on iOS,
// Chrome Custom Tabs on Android) instead of handing off to the system
// browser. Used by sign-up flows so the user can return to Cypher Box
// with one tap. Falls back to Linking.openURL if the in-app browser
// bridge is unavailable.
const openInAppBrowser = async (url: string): Promise<void> => {
    try {
        if (await InAppBrowser.isAvailable()) {
            await InAppBrowser.open(url, {
                dismissButtonStyle: "done",
                modalEnabled: true,
                animated: true,
                readerMode: false,
                showTitle: true,
                enableUrlBarHiding: false,
                enableDefaultShare: false,
            });
            return;
        }
    } catch {
        // SFSafariViewController unavailable or native bridge failure;
        // fall through so the user still reaches the URL.
    }
    await Linking.openURL(url);
};

export default openInAppBrowser;
