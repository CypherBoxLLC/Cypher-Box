import React from "react";
import { View } from "react-native";
import styles from "./styles";
import { Text } from "@Cypher/component-library";
import loc from "../../../loc";

export default function Tips() {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>{loc.cypherbox.components.tips.title}</Text>
            <Text h4 style={styles.descption}>
                {loc.cypherbox.components.tips.list}
            </Text>
        </View>
    )
}
