import React from "react"
import { View } from "react-native"
import styles from "./styles"
import { Text } from "@Cypher/component-library";

interface Props {
    title: string;
}

export default function Header({ title }: Props) {
    return <View style={styles.main}>
        <View style={styles.line} />
        <Text style={styles.header}>{title}</Text>
        <View style={styles.line} />
    </View>
}
