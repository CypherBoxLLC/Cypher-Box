import React, { useState } from "react";
import { Image, ScrollView, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { Icon } from 'react-native-elements';
import { colors } from "@Cypher/style-guide";
import { ProgressBar1, ProgressBar2, ProgressBar3, ProgressBar4, ProgressBar5 } from "@Cypher/assets/images";
import { ProgressBar } from "@Cypher/components";
import loc from "../../../loc";

export default function AdjustHotThreshold() {

    const [coinSlot, setCoinSlot] = useState(1);
    const [open, setOpen] = useState(false);

    const homeClickHandler = () => { }

    const handleDropDownOpen = () => {
        setOpen(true);
    }

    return (
        <ScreenLayout showToolbar disableScroll>
            <View style={styles.container}>
                <ScrollView>
                    <View style={styles.innerView}>
                        <Text bold subHeader style={styles.title}>{loc.cypherbox.vault.adjust_hot_threshold.title}</Text>
                        <View style={styles.tabs}>
                            <ProgressBar image={ProgressBar1} />
                            <ProgressBar image={ProgressBar2} />
                            <ProgressBar image={ProgressBar3} />
                            <ProgressBar image={ProgressBar4} />
                            <ProgressBar image={ProgressBar5} />
                        </View>
                        <Text h4 style={styles.desc}>
                            {loc.cypherbox.vault.adjust_hot_threshold.desc_1}{'\n\n'}{loc.cypherbox.vault.adjust_hot_threshold.desc_2}{'\n\n'}{loc.cypherbox.vault.adjust_hot_threshold.desc_3}{'\n\n'}{loc.cypherbox.vault.adjust_hot_threshold.desc_4}
                        </Text>
                    </View>
                </ScrollView>
                <Text h3 bold style={styles.coinslot}>{loc.cypherbox.vault.adjust_hot_threshold.select_threshold}</Text>
                <View style={styles.coinslotView}>
                    <TouchableOpacity style={styles.dropdown} onPress={handleDropDownOpen}>
                        <Icon name="chevron-down" type="font-awesome" color={colors.primary} size={15} />
                        <Text bold h2 style={styles.textCoinSlot}>{coinSlot}</Text>
                    </TouchableOpacity>
                    <Text h3 bold style={styles.coinslot}>{loc.cypherbox.vault.adjust_hot_threshold.coin_slots}</Text>
                    {open &&
                        <ScrollView style={styles.dropdownScroll}>
                            <View>
                                <Text bold h2 style={styles.textCoinSlot} onPress={() => { setCoinSlot(1); setOpen(false); }}>1</Text>
                                <Text bold h2 style={styles.textCoinSlot} onPress={() => { setCoinSlot(2); setOpen(false); }}>2</Text>
                                <Text bold h2 style={styles.textCoinSlot} onPress={() => { setCoinSlot(3); setOpen(false); }}>3</Text>
                                <Text bold h2 style={styles.textCoinSlot} onPress={() => { setCoinSlot(4); setOpen(false); }}>4</Text>
                                <Text bold h2 style={styles.textCoinSlot} onPress={() => { setCoinSlot(5); setOpen(false); }}>5</Text>
                            </View>
                        </ScrollView>
                    }
                </View>
                <Text h3 center style={styles.warn}>{loc.cypherbox.vault.adjust_hot_threshold.beyond_number}</Text>
                <Button text={loc.cypherbox.vault.adjust_hot_threshold.adjust_threshold} onPress={homeClickHandler} style={styles.button} textStyle={styles.btnText} />
            </View>
        </ScreenLayout>
    )
}
