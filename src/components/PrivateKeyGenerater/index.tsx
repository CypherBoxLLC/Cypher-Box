import React, { useContext, useEffect, useMemo, useState } from "react";
import { Image, TouchableOpacity, View } from "react-native"
import styles from "./styles";
import { Text } from "@Cypher/component-library";
import { EyeVisible } from "@Cypher/assets/images";
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
    const walletID = useAuthStore(s => s.walletID);
    const wallet = useMemo(
        () => wallets.find((w: AbstractWallet) => w.getID() === walletID),
        [wallets, walletID],
    );

    const navigation = useNavigation();
    const { colors } = useTheme();

    const [isView, setIsView] = useState(false);
    const [secretList, setSecretList] = useState([]);

    useEffect(() => {
        const entries = wallet?.getSecret().split(/\s/).entries();
        if(entries){
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
        }
    }, [])
    const viewClickHandler = () => {
        setIsView(true);
        callNext();
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
            {!isView && (
                <>
                    {/*
                      Plain dark overlay instead of @react-native-community/blur.
                      BlurView wraps iOS UIVisualEffectView, whose first mount
                      is expensive (empirically 1–2s on simulator, several
                      hundred ms on device) — it was the root cause of the
                      "black screen for 2 seconds after tapping Generate Private
                      Key" jank. A solid ~95% opaque dark surface is visually
                      equivalent for the "seed hidden until you tap View" use
                      case here; no sensitive content is visible underneath in
                      either case. Rendering a plain View also sidesteps the
                      historical iOS touch-passthrough bug where
                      UIVisualEffectView would absorb taps meant for overlaid
                      TouchableOpacity children — so the "View" button can be
                      a direct child again without the sibling-overlay dance.
                    */}
                    <View style={[styles.hideView, styles.hideOverlay]}>
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
                    </View>
                </>
            )}
        </View>
    );
}
