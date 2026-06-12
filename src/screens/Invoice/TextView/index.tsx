import { Text } from "@Cypher/component-library";
import React from "react";
import { StyleSheet, TextStyle, View, ViewStyle } from "react-native";

interface Props {
    keytext: string;
    text: string;
    textStyle?: TextStyle;
    /** Optional override for the row's outer container style. Used to
     * collapse the default `marginBottom: 30` on rows that need to sit
     * tight against their neighbour (e.g. amount / spent-from / trading
     * fees on the BUY review). */
    containerStyle?: ViewStyle;
}

export default function TextView({ keytext, text, textStyle, containerStyle }: Props) {
    return (
        <View style={StyleSheet.flatten([styles.container, containerStyle])}>
            <Text bold style={{fontSize: 18}}>{keytext}</Text>
            <Text italic style={StyleSheet.flatten([styles.text,textStyle && textStyle])}>{text}</Text>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        marginBottom:30,
        marginStart:15,
        marginEnd: 10,
    },
    text: {
        flex: 1,
        fontSize: 18,
        marginTop: 3,
    }
})