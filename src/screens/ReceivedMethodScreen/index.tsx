import React from "react";
import { Image, View } from "react-native";
import styles from "./styles";
import loc from "../../../loc";
import { LeftArrow } from "@Cypher/assets/images";
import { GradientCard, GradientCardWithShadow } from "@Cypher/components";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";

export default function ReceivedMethodScreen() {

    const handleCreateInvoice = () => {
        console.log('create invoice click');
        dispatchNavigate('CreateInvoice');
    }

    const getAddressClickHandler = () => {
        console.log('getaddress click');
        dispatchNavigate('GetAddressScreen');
    }

    return (
        <ScreenLayout showToolbar isBackButton>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <Text subHeader bold>{loc.cypherbox.payments.received_method.receive_bitcoin}</Text>
                    <View style={styles.extra} />
                    <GradientCard style={styles.height} linearStyle={styles.height} onPress={handleCreateInvoice}>
                        <View style={styles.background}>
                            <View style={styles.view}>
                                <View style={styles.container2}>
                                    <Text subHeader bold style={styles.title}>{loc.cypherbox.payments.received_method.lightning_invoice}</Text>
                                    <Text h4 bold style={styles.desc}>{loc.cypherbox.payments.received_method.lightning_invoice_desc}</Text>
                                </View>
                                <Image source={LeftArrow} style={styles.image} resizeMode="contain" />
                            </View>
                        </View>
                    </GradientCard>
                    <View style={styles.extra} />
                    <GradientCard style={styles.height} linearStyle={styles.height} onPress={getAddressClickHandler}>
                        <View style={styles.background}>
                            <View style={styles.view}>
                                <View style={styles.container2}>
                                    <Text subHeader bold style={styles.title}>{loc.cypherbox.payments.received_method.network_address}</Text>
                                    <Text h4 bold style={styles.desc}>{loc.cypherbox.payments.received_method.network_address_desc}</Text>
                                </View>
                                <Image source={LeftArrow} style={styles.image} resizeMode="contain" />
                            </View>
                        </View>
                    </GradientCard>
                </View>
            </View>
        </ScreenLayout>
    )
}
