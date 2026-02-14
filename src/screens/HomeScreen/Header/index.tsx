import { Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { useNavigation, useRoute } from "@react-navigation/native";
import React from "react";
import { Image, TouchableOpacity, View } from "react-native";
import { scanQrHelper } from "../../../../helpers/scan-qr";
import styles from "../styles";

interface Props {
    onBarScanned(value: any): void;
}

export default function Header({ onBarScanned }: Props) {
    const { navigate } = useNavigation();
    const routeName = useRoute().name;

    const navigateToSettings = () => {
        dispatchNavigate("Settings");
    };

    const onScanButtonPressed = () => {
        scanQrHelper(navigate, routeName).then(onBarScanned);
    };

    return <View style={styles.title}>
        <Text subHeader bold>
            Total Assests
        </Text>
        <View style={styles.row}>
            <TouchableOpacity
                style={styles.imageView}
                onPress={navigateToSettings}
            >
                <Image
                    style={styles.image}
                    resizeMode="contain"
                    source={require("../../../../img/settings.png")}
                />
            </TouchableOpacity>
            {/* <TouchableOpacity
                style={styles.imageViews}
                onPress={onScanButtonPressed}
            >
                <Image
                    style={styles.scan}
                    resizeMode="contain"
                    source={require("../../../../img/scan-new@3x2.png")}
                />
            </TouchableOpacity> */}
        </View>
    </View>
}