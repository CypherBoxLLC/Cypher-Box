import React, { useEffect, useRef } from "react";
import { Animated, Image, ImageBackground, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import { Text } from "@Cypher/component-library";
import { Barcode, ProgressBar5, Tag, Transaction, TransactionBlue, Yes} from "@Cypher/assets/images";
import { colors } from "@Cypher/style-guide";
import { btc, sats } from "@Cypher/helpers/coinosHelper";
import MaskedView from "@react-native-masked-view/masked-view";
import { blue } from "react-native-reanimated/lib/typescript/reanimated2/Colors";

interface Props {
    item: any;
    isPending?: boolean;
    isVault?: boolean;
}

const whiteCapsule = require("@Cypher/assets/images/whitecapsule.png")
const orangeCapsule = require("@Cypher/assets/images/orangeCapsule.png")
const greenCapsule = require("@Cypher/assets/images/greencapsule.png")
const grassCapsule = require("@Cypher/assets/images/grasscapsule.png")
const cyanCapsule = require("@Cypher/assets/images/cyancapsule.png")
const blueCapsule = require("@Cypher/assets/images/bluecapsule.png")
const pinkCapsule = require("@Cypher/assets/images/pinkcapsule.png")
const redCapsule = require("@Cypher/assets/images/redcapsule.png")

const mask1 = require("@Cypher/assets/images/mask1.png")
const mask2 = require("@Cypher/assets/images/mask2.png")
const mask3 = require("@Cypher/assets/images/mask3.png")
const mask4 = require("@Cypher/assets/images/mask4.png")
const mask5 = require("@Cypher/assets/images/mask5.png")
const mask6 = require("@Cypher/assets/images/mask6.png")
const mask7 = require("@Cypher/assets/images/mask7.png")
const mask8 = require("@Cypher/assets/images/mask8.png")
const mask9 = require("@Cypher/assets/images/mask9.png")
const mask10 = require("@Cypher/assets/images/mask10.png")

const VaultCapsules = ({ item, isPending = false, isVault = false }: Props) => {
    const glowAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (isPending) {
            const loop = Animated.loop(
                Animated.sequence([
                    Animated.timing(glowAnim, { toValue: 1, duration: 1000, useNativeDriver: false }),
                    Animated.timing(glowAnim, { toValue: 0, duration: 1000, useNativeDriver: false }),
                ]),
            );
            loop.start();
            return () => loop.stop();
        } else {
            glowAnim.setValue(0);
        }
    }, [isPending]);
    const BTCAmount = btc(item?.value) + " BTC";
    const SATsAmount = item;
    //const SATsAmount = 1_100_000_000
    //const { memo } = wallet.getUTXOMetadata(item.txid, item.vout);
    console.log("🚀 ~ CustomProgressBar ~ value:", SATsAmount)
    
        const ranges = [
            // {barColor: redCapsule,
            // max: 2_000_387_900,
            // min: 1_010_195_889},
            {barColor: pinkCapsule,
            max: 1_100_000_000,
            min: 100_000_000, //1.1BTC = 110_021_334
            },
            {barColor: blueCapsule,
            max: 110_000_000, //110_021_334
            min: 10_000_000 //11M
            },
            {barColor: grassCapsule,
            max: 11_000_000,
            min: 1_000_000  //1.1M
            },
            {barColor: orangeCapsule,
            max: 1_100_000,
            min: 100_000
            },
            {barColor: whiteCapsule,
            max: 100_000,
            min: 0
            }
        ]

        const barColor = SATsAmount >= 1_100_000_000 ? redCapsule : //10.1 BTC
        SATsAmount >= 110_000_000 ? pinkCapsule : //1.1M BTC
        SATsAmount >= 11_000_000 ? blueCapsule : //11M sats
        SATsAmount >= 1_100_000 ? grassCapsule : //1.1M sats
        SATsAmount >= 100_000 ? orangeCapsule : whiteCapsule//100k sats
        
        const max = ranges.find(e => e.barColor === barColor)?.max
        const min = ranges.find(e => e.barColor === barColor)?.min

        const range = max - min

        const percentage = ((SATsAmount - min) / range)

        //first three statements are exceptions, as the range is different from the rest within the same capsule color
        const maskElement = (1_100_000 <= SATsAmount && SATsAmount < 2_000_000) ||
        (11_000_000 <= SATsAmount && SATsAmount < 20_000_000) ||
        (110_000_000 <= SATsAmount && SATsAmount < 200_000_000) ? mask1 : 
        percentage < 1 && percentage >= 0.9 ? mask10 :
        percentage < 0.9 && percentage >= 0.8 ? mask9 :
        percentage < 0.8 && percentage >= 0.7 ? mask8 :
        percentage < 0.7 && percentage >= 0.6 ? mask7 :
        percentage < 0.6 && percentage >= 0.5 ? mask6 :
        percentage < 0.5 && percentage >= 0.4 ? mask5 :
        percentage < 0.4 && percentage >= 0.3 ? mask4 :
        percentage < 0.3 && percentage >= 0.2 ? mask3 :
        percentage < 0.2 && percentage >= 0.1 ? mask2 : mask1

        //exceptions
        //maskElement = 

    return (
                    <View style={[styles.tab, { position: 'relative' }]}>
                    {isPending && (
                        <Animated.View
                            pointerEvents="none"
                            style={{
                                position: 'absolute',
                                top: -4,
                                left: -4,
                                right: -4,
                                bottom: -4,
                                borderRadius: 6,
                                shadowColor: '#ffd700',
                                shadowOffset: { width: 0, height: 0 },
                                shadowOpacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
                                shadowRadius: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 28] }),
                                elevation: 20,
                                borderWidth: 1.5,
                                borderColor: glowAnim.interpolate({ inputRange: [0, 1], outputRange: ['rgba(255,215,0,0.3)', 'rgba(255,215,0,0.9)'] }),
                            }}
                        />
                    )}
                    <MaskedView
                            style={{ flex: 1, flexDirection: 'row', width: '100%', alignContent: 'center', alignItems:'center', justifyContent: 'center', alignSelf: 'center'}}
                            maskElement={
                                <Image source={maskElement} resizeMode='contain' style={{flex:1, flexDirection:'row', backgroundColor: 'transparent', width: '95%', alignContent: 'center', alignItems:'center', justifyContent: 'center', alignSelf: 'center'}}></Image>
                            
                            }>
                                
                            
                        <Image source={barColor} resizeMode='contain' style={styles.progressbar} />
                        </MaskedView>
                        
                    </View>
                    
    );
};

export default VaultCapsules;
