import { Text } from "@Cypher/component-library"
import { GradientCard } from "@Cypher/components"
import React, { useState } from "react"
import { Image, StyleSheet, TouchableOpacity, View } from "react-native"
import LinearGradient from "react-native-linear-gradient"
import SimpleToast from "react-native-simple-toast";

import styles from "./styles"
import { Bitcoin, LiquidBitCoin, Socked } from "@Cypher/assets/images"
import { colors } from "@Cypher/style-guide"
import { Icon } from 'react-native-elements';
import { dispatchNavigate } from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore"
import Clipboard from "@react-native-clipboard/clipboard"
import loc from "../../../../loc"

interface Props {
    refRBSheet: any;
    matchedRate: number;
    currency: string;
    receiveType: boolean
}

export default function ReceivedList({ refRBSheet, receiveType, matchedRate, currency }: Props) {
    const {user, strikeMe} = useAuthStore();
    const [data, setData] = useState(receiveType ? [
        {
            id: 1,
            name: loc.cypherbox.home_lists.received_list.lightning_address,
            type: 0,
            description: user+'@coinos.io',
            navigation: {},
        },
        {
            id: 2,
            name: loc.cypherbox.home_lists.received_list.lightning_invoice,
            type: 0,
            description: loc.cypherbox.home_lists.received_list.lightning_invoice_desc,
            navigation: {
                screen: 'CreateInvoice',
                params: {
                    matchedRate, currency
                }
            }
        },
        {
            id: 3,
            name: loc.cypherbox.home_lists.received_list.liquid_address,
            type: 1,
            description: loc.cypherbox.home_lists.received_list.liquid_address_desc,
            navigation: {
                screen: 'QrScreen',
                params: {
                    isBitcoinQr: true,
                    type: "liquid"
                }
            },
        },
        {
            id: 4,
            name: loc.cypherbox.home_lists.received_list.bitcoin_address,
            type: 2,
            description: loc.cypherbox.home_lists.received_list.bitcoin_address_desc,
            navigation: {
                screen: 'QrScreen',
                params: {
                    isBitcoinQr: true,
                    type: "bitcoin"
                }
            },
        },
    ]
    :
    [
        {
            id: 1,
            name: loc.cypherbox.home_lists.received_list.lightning_address,
            type: 0,
            description: strikeMe?.username+'@strike.me',
            navigation: {},
        },
        {
            id: 2,
            name: loc.cypherbox.home_lists.received_list.lightning_invoice,
            type: 0,
            description: loc.cypherbox.home_lists.received_list.lightning_invoice_desc,
            navigation: {
                screen: 'CreateInvoice',
                params: {
                    matchedRate, currency, receiveType
                }
            }
        },
        {
            id: 4,
            name: loc.cypherbox.home_lists.received_list.bitcoin_address,
            type: 2,
            description: loc.cypherbox.home_lists.received_list.bitcoin_address_desc,
            navigation: {
                screen: 'QrScreen',
                params: {
                    isBitcoinQr: true,
                    type: "bitcoin",
                    receiveType
                }
            },
        },
    ]
    );

    const onPress = (item: any) => { 
        refRBSheet?.current?.close();

        if(item?.id == 1){
            Clipboard.setString(receiveType ? user+'@coinos.io' : strikeMe?.username+'@strike.me');
            SimpleToast.show(loc.cypherbox.home_lists.received_list.copied, SimpleToast.SHORT);
        
        }
        item?.navigation?.screen &&
        setTimeout(() => {
            dispatchNavigate(item?.navigation?.screen, item?.navigation?.params);
        }, 150);
    }

    return <>
        <LinearGradient
            start={{ x: 0, y: 1 }} end={{ x: 1, y: 1 }}
            colors={['#FF65D4', '#D617A1']}
            style={styles.line} /><View style={styles.shadow10}>
            <View style={styles.row2}>
                <TouchableOpacity onPress={() => refRBSheet?.current?.close()} style={styles.closeView}>
                    <Icon name="close" size={22} type="iosicons" color={colors.white} />
                </TouchableOpacity>
                <Text h2 bold style={styles.bottomtext}>{loc.cypherbox.home_lists.received_list.receive}</Text>
            </View>
            <View style={styles.list}>
                {data?.map((item) => (
                    <GradientCard colors_={['#B6B6B6', '#FFFFFF']}
                        style={styles.main}
                        linearStyle={styles.height2}
                        onPress={() => onPress(item)}>
                        <View style={styles.background}>
                            <View style={styles.view3}>
                                <View style={styles.subview}>
                                    <Text subHeader bold style={styles.title2}>{item?.name}</Text>
                                    <Text h4 bold style={StyleSheet.flatten([styles.desc, {
                                        fontSize: item?.id == 1 ? 18 : 14,
                                        lineHeight: item?.id == 1 ? 28 : 14,
                                        marginTop: item?.id == 1 ? 0 : 5,
                                    }])}>{item?.description}</Text>
                                </View>
                                <View style={styles.image3}>
                                    <Image source={item?.type == 0 ? Socked : item?.type == 1 ? LiquidBitCoin : Bitcoin} style={item?.type == 0 ? styles.image2 : styles.image3} resizeMode="contain" />
                                </View>
                            </View>
                        </View>
                    </GradientCard>
                ))}
            </View>
        </View>
    </>
}