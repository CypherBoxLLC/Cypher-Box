import React from "react";
import { Image, ImageBackground, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import { Text } from "@Cypher/component-library";
import { ProgressBar5, ProgressBarColdStorage, Tag, Transaction, TransactionBlue, Yes} from "@Cypher/assets/images";
import { colors } from "@Cypher/style-guide";
import { btc } from "@Cypher/helpers/coinosHelper";
import Capsule from "../Capsule";
import MaskedView from "@react-native-masked-view/masked-view";

interface Props {
    wallet: any;
    item: any;
    onPress(id: string): void;
    handleChoose(item: any): void;
    ids: any;
    vaultTab: boolean;
}
const shortenAddress = (address: string) => {
    // Take the first 6 characters
    const start = address.substring(0, 4);
    // Take the last 6 characters
    const end = address.substring(address.length - 4);
    // Combine with three dots in the middle
    return `${start}...${end}`;
};

const ListView = ({ wallet, item, onPress, handleChoose, ids, vaultTab }: Props) => {
    const BTCAmount = btc(item?.value) + " BTC";
    const { memo } = wallet.getUTXOMetadata(item.txid, item.vout);

    return (
        <ImageBackground source={vaultTab ? TransactionBlue : Transaction} style={styles.main}>
            {ids.includes(`${item.txid}:${item.vout}`) && (<View style={[styles.borderview, vaultTab && { borderColor: colors.coldGreen }]} />)
            }
            <TouchableOpacity activeOpacity={0.7} style={styles.container} onPress={() => onPress(`${item.txid}:${item.vout}`)}>
                <View style={styles.coin}>
                    <Capsule wallet={wallet} item={item} vaultTab={vaultTab}></Capsule>
                    {/* <View style={styles.tab}>
                    <MaskedView
                            style={{ flex: 1, flexDirection: 'row', height: '100%', alignContent: 'stretch', alignItems:'stretch', justifyContent: 'stretch' }}
                            maskElement={
                                <Image source={require('@Cypher/assets/images/mask1.png')} resizeMode='contain' style={{backgroundColor: 'transparent', width: '100%', height:'100%'}}></Image>
                            
                            }>
                                
                            
                        <Image source={vaultTab ? 
                             ProgressBarColdStorage 
                            : 
                             ProgressBar5
                            } resizeMode='contain' style={styles.progressbar} />
                        </MaskedView>
                    </View> */}
                    {/* <Text bold>Address: {shortenAddress(item?.address)}</Text> */}
                </View>
                <View style={styles.size}>
                    <Text bold style={styles.value}>{BTCAmount}</Text>
                    {memo && memo !== "" &&
                        <Text bold>{memo}</Text>
                    }
                </View>
                <TouchableOpacity style={styles.label} onPress={() => handleChoose(item)}>
                    <Image source={Tag} style={{}} />
                </TouchableOpacity>
                <View style={styles.select}>
                    <View style={styles.checkbox}>
                        {ids.includes(`${item.txid}:${item.vout}`) &&
                            <Image source={Yes} />
                        }
                    </View>
                </View>
            </TouchableOpacity>
        </ImageBackground>
    );
};

export default ListView;
