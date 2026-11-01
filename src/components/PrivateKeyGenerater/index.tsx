import React, { useContext, useEffect, useMemo, useState } from "react";
import { Image, Platform, TouchableOpacity, View } from "react-native"
import styles from "./styles";
import { Text } from "@Cypher/component-library";
import { rtl } from "@Cypher/style-guide";
import { EyeVisible } from "@Cypher/assets/images";
import { useNavigation, useRoute } from "@react-navigation/native";
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import { AbstractWallet } from '../../../class';
import { useTheme } from '../../../components/themes';
import useAuthStore from "@Cypher/stores/authStore";
import useProtectSecret from "../../custom-hooks/useProtectSecret";
import { mnemonicToSeedQR, seedQRGrid } from "@Cypher/helpers/seedQR";
import { dispatchNavigate } from "@Cypher/helpers";
import SeedQRGrid from "../SeedQRGrid";
import OfflineSeedWarning from "../OfflineSeedWarning";
import loc from "../../../loc";

interface Props {
    callNext(): void;
}

export default function PrivateKeyGenerater({ callNext }: Props) {
    const { wallets } = useContext(BlueStorageContext);
    const walletID = useAuthStore(s => s.walletID);
    const signingMode = useAuthStore(s => s.signingMode);
    const wallet = useMemo(
        () => wallets.find((w: AbstractWallet) => w.getID() === walletID),
        [wallets, walletID],
    );

    const navigation = useNavigation();
    const { colors } = useTheme();

    const [isView, setIsView] = useState(false);
    const [secretList, setSecretList] = useState([]);
    // the same backup, as words or as a SeedQR to copy by hand (lets a signing phone sign by scanning it)
    const [format, setFormat] = useState<'words' | 'seedqr'>('words');
    const grid = useMemo(() => {
        try {
            return seedQRGrid(mnemonicToSeedQR(wallet?.getSecret?.() ?? ''));
        } catch (_) {
            return null;
        }
    }, [wallet]);
    // the words are in the view tree from the start, under the reveal overlay: hide them from the app switcher and,
    // on Android, from screenshots for as long as this is shown
    useProtectSecret();

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

    const showSeedQR = isView && format === 'seedqr' && grid;

    return (
        <View>
            {grid ? (
                <View style={styles.tabs}>
                    {(['words', 'seedqr'] as const).map(f => (
                        <TouchableOpacity
                            key={f}
                            onPress={() => setFormat(f)}
                            style={[styles.tab, format === f && styles.tabOn]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: format === f }}
                        >
                            <Text bold style={styles.tabText}>{f === 'words' ? `${secretList.length || 12} words` : 'SeedQR'}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            ) : null}
            {showSeedQR ? (
                // same width as the words, so switching tabs doesn't move the screen; copying and checking happen in the
                // full-screen SeedQR flow, which has room for the zoom and the scan
                <View style={styles.seedQR}>
                    {Platform.OS === 'ios' ? (
                        <Text style={styles.seedQRWarning}>{loc.cypherbox.components.private_key_generator.no_screenshot}</Text>
                    ) : null}
                    <SeedQRGrid grid={grid} width={300} zoomable={false} />
                    <Text style={styles.seedQRNote}>
                        {loc.cypherbox.components.private_key_generator.seedqr_note}
                    </Text>
                    <TouchableOpacity
                        style={styles.checkBtn}
                        onPress={() => dispatchNavigate('SeedQRBackup', { walletID: wallet?.getID?.() })}
                        accessibilityRole="button"
                    >
                        <Text h3>{loc.cypherbox.components.private_key_generator.copy_square}</Text>
                    </TouchableOpacity>
                </View>
            ) : (
            <View>
            <View style={styles.container}>
                {secretList.map((secret, index) => (
                    <TouchableOpacity key={index} style={styles.button}>
                        {/* the words showed faintly through the reveal overlay, so they aren't drawn until View */}
                        <Text h4 style={[styles.buttonText, rtl.ltrText]}>{`${secret.id}. ${isView ? secret.label : '••••••'}`}</Text>
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
                                <Text style={styles.title} center>{loc.cypherbox.components.private_key_generator.tap_to_reveal}</Text>
                                <Text style={styles.detail} center>{loc.cypherbox.components.private_key_generator.no_one_watching}</Text>
                            </View>
                            <TouchableOpacity style={styles.viewStyle} onPress={viewClickHandler}>
                                <Image source={EyeVisible} />
                                <Text h3 style={styles.viewBtn}>{loc.cypherbox.components.private_key_generator.view}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </>
            )}
            </View>
            )}
            {signingMode ? <OfflineSeedWarning /> : null}
        </View>
    );
}
