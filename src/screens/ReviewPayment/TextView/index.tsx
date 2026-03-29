import { Text } from "@Cypher/component-library";
import React from "react";
import { StyleSheet, TextStyle, View } from "react-native";

interface Props {
    keytext: string;
    text: string;
    textStyle?: TextStyle;
}

export default function TextView({ keytext, text, textStyle }: Props) {
    return (
        <View style={styles.container}>
            <Text h2 style={{}}>{keytext}</Text>
            <Text h2 italic style={StyleSheet.flatten([styles.text,textStyle && textStyle])}>{text}</Text>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        marginBottom:25,
        marginStart:15,
        marginEnd: 10,
        alignItems:'flex-start',
        // flex:1,
        // backgroundColor:'red'
    },
    text: {
        flex: 1,
        fontSize: 18
    }
})