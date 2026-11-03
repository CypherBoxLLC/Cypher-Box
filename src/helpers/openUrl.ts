import { Alert, Linking } from "react-native";
import loc from "../../loc";

const openUrl = async (url: string) => {
    // Checking if the link is supported for links with custom URL scheme.
    const supported = await Linking.canOpenURL(url);

    if (supported) {
        // Opening the link with some app, if the URL scheme is "http" the web link should be opened
        // by some browser in the mobile
        await Linking.openURL(url);
    } else {
        Alert.alert(String(loc.formatString(loc.cypherbox.services.helpers.cannot_open_url, { url })));
    }
};

export default openUrl;