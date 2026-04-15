import React, { useContext, useEffect, useState } from "react";
import { ActivityIndicator, Image, TouchableOpacity, View } from "react-native"
import styles from "./styles";
import { Text } from "@Cypher/component-library";
import { EyeVisible } from "@Cypher/assets/images";
import { BlurView } from "@react-native-community/blur";
import { useNavigation, useRoute } from "@react-navigation/native";
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import { AbstractWallet } from '../../../class';
import { useTheme } from '../../../components/themes';
import useAuthStore from "@Cypher/stores/authStore";

interface Props {
    callNext(): void;
}

export default function PrivateKeyGenerater({ callNext }: Props) {
    const { wallets } = useContext(BlueStorageContext);
    const { walletID } = useAuthStore();
    const wallet = wallets.find((w: AbstractWallet) => w.getID() === walletID);
    
    const navigation = useNavigation();
    const { colors } = useTheme();

    const [isView, setIsView] = useState(false);
    const [loading, setLoading] = useState(false);
    const [secretList, setSecretList] = useState([]);

    useEffect(() => {
        console.log('wallet: ', wallet)
        const entries = wallet?.getSecret().split(/\s/).entries();
        if(entries){
            setLoading(true)
            let arr: any = [];
            for (const [index, secret] of entries) {
                if (secret) {
                    arr.push({
                        id: index + 1,
                        label: secret
                    })
                }
            }
            setSecretList(arr);
            setLoading(false)
        }
    }, [])

    if (__DEV__) console.log('secretList: ', secretList)
    const viewClickHandler = () => {
        setLoading(true);
        setTimeout(() => {
            setLoading(false);
            setIsView(true);
            setTimeout(() => {
                callNext();
                // setTimeout(() => {
                //     setIsView(false);
                // }, 2000);
            }, 3000);
        }, 1500);
    }

    const buttons = [
        { id: 1, label: 'future' },
        { id: 7, label: 'exit' },
        { id: 7, label: 'exit' },
        { id: 7, label: 'exit' },
        { id: 7, label: 'exit' },
        { id: 9, label: 'drum' },
        { id: 7, label: 'exit' },
        { id: 5, label: 'disagree' },
        { id: 5, label: 'disagree' },
        { id: 7, label: 'exit' },
        { id: 7, label: 'exit' },
        { id: 7, label: 'exit' },
    ];

    return (
        <View>
            <View style={styles.container}>
                {secretList.map((secret, index) => (
                    <TouchableOpacity key={index} style={styles.button}>
                        <Text h4 style={styles.buttonText}>{`${secret.id}. ${secret.label}`}</Text>
                    </TouchableOpacity>
                ))}
            </View>
            {!isView &&
                <BlurView
                    style={styles.hideView}
                    blurType="dark"
                    blurAmount={9}
                    reducedTransparencyFallbackColor="white"
                >
                    {loading ?
                        <ActivityIndicator style={{ position: 'absolute', top: 100, bottom: 0, left: 0, right: 0 }} />
                    :
                        <View style={styles.centerView}>
                            <View>
                                <Text style={styles.title} center>Tap to reveal your seed phrase</Text>
                                <Text style={styles.detail} center>Make sure no one is watching your screen.</Text>
                            </View>
                            <TouchableOpacity style={styles.viewStyle} onPress={viewClickHandler}>
                                <Image source={EyeVisible} />
                                <Text h3 style={styles.viewBtn}>View</Text>
                            </TouchableOpacity>
                        </View>
                    }
                </BlurView>
            }
        </View>
    );
}
