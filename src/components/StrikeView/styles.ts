import { colors, widths } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    gradientBorder: ViewStyle;
    innerContainer: ViewStyle;
    gradientBackground: ViewStyle;
    strikeRow: ViewStyle;
    sideContainer: ViewStyle;
    fiatBalanceBox: ViewStyle;
    fiatBalanceBox2: ViewStyle;
    fiatBalanceBox3: ViewStyle;
    sellBuyButton: ViewStyle;
    sellBuyGradient: ViewStyle;
    topShadow: ViewStyle;
    bottomShadow: ViewStyle;
    linearGradientStyleMain: ViewStyle;
    sellBuyButton2: ViewStyle;
    sellBuyGradient2: ViewStyle;
    topShadow2: ViewStyle;
    bottomShadow2: ViewStyle;
    linearGradientStyleMain2: ViewStyle;
    sellBuyButton3: ViewStyle;
    sellBuyGradient3: ViewStyle;
    topShadow3: ViewStyle;
    bottomShadow3: ViewStyle;
    linearGradientStyleMain3: ViewStyle;
    sellBuyButton4: ViewStyle;
    sellBuyGradient4: ViewStyle;
    topShadow4: ViewStyle;
    bottomShadow4: ViewStyle;
    linearGradientStyleMain4: ViewStyle;
    rowContainer: ViewStyle;
    progressBarImage: ImageStyle;
    minusButton: ViewStyle;
    bottomButtonsContainer: ViewStyle;
    bitcoinPriceContainer: ViewStyle;
    bitcoinPriceContainerInner: ViewStyle;
    bitcoinPriceText: TextStyle;
    strikeLogo: ImageStyle;
}

export default StyleSheet.create<Style>({
    container: {
        // Drop the entire Strike fiat-balance section (capsule + BUY/SELL
        // buttons + bitcoin exchange-rate box) 15pt lower so it doesn't
        // crowd the BalanceView above it.
        marginTop: 15,
    },
    gradientBorder: {
        borderRadius: 12,
    },
    innerContainer: {
        borderRadius: 9,
        overflow: 'hidden',
    },
    gradientBackground: {
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    strikeRow: {
        flexDirection: 'row',
        flex: 1,
    },
    sideContainer: {
        flex: 1,
    },
    fiatBalanceBox: {
        width: 121,
        height: 94,
        margin: 20,
        marginBottom: 10,
        // marginTop 40 → 30 per Bam: Fiat Balance text + amount up 10pt.
        // alignSelf flex-start → center: horizontal-center the box within
        // the right sideContainer so it visually centers between the
        // capsule's right edge and the card's right edge (rather than
        // hugging the left side of the right half).
        marginTop: 30,
        alignSelf: 'center',
        alignItems: 'center',
        // Round 5 — Fiat Balance text up another 10pt. Using `transform`
        // (paint-only) instead of dropping marginTop further so SELL
        // below stays put — modifying marginTop drags SELL with it
        // (see the SELL marginTop:-5 comment in index.tsx).
        transform: [{ translateY: -10 }],
    },
    fiatBalanceBox2: {
        width: 121,
        height: 94,
        margin: 20,
        marginBottom: 10,
        // The capsule now lives in the LEFT sideContainer (its position in
        // the JSX was swapped with the Fiat Balance box), so this box's
        // alignSelf mirrors `fiatBalanceBox` and pins to flex-start of its
        // half. Was previously 'center' to fit the right half + plus/minus
        // column layout pre-RN-0.76, but after the Yoga 2 migration that
        // resolved to the wrong side and Bam saw it "stuck to the right
        // corner."
        alignSelf: 'flex-start',
        // Per Bam: shift the whole UTXO-capsule square right 25pt and
        // down 25pt from its post-swap position. marginLeft 20 → 45,
        // marginTop 20 → 45 (each is base-margin 20 + 25pt offset). The
        // box's outer width grows to 186pt as a result; that overflow
        // sits within the LEFT sideContainer's slot so it doesn't
        // collide with the right-side Fiat Balance text.
        marginLeft: 45,
        marginTop: 45,
        // Round 4 final — Round 4's full (−45, −45) was too much; backed
        // off 15pt on each axis to land at (−30, −30). Net effect: capsule
        // sits at (15, 15) inside the LEFT sideContainer (marginLeft/Top
        // 45 + −30 paint offset). Still using `transform` (not margin)
        // so the BUY button below stays put.
        transform: [{ translateX: -30 }, { translateY: -30 }],
        justifyContent: 'center',
        borderRadius: 20,
    },
    fiatBalanceBox3: {
        borderRadius: 18,
        width: 115,
        height: 88,
    },
    sellBuyButton: {
        shadowColor: '#040404',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
        elevation: 8,
        alignSelf: 'center',
        width: 121,
    },
    sellBuyGradient: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
        width: 121,
    },
    topShadow: {
        // Green glow removed per Bam — was `colors.greenShadow` with full
        // opacity, gave the BUY / SELL buttons a green halo. Switched to
        // a neutral dark drop with reduced opacity so the buttons keep a
        // subtle 3D pop without a colored tint.
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        shadowOpacity: 0.6,
        shadowColor: '#000000',
        borderRadius: 25,
        height: 33,
        width: 121,
        justifyContent: 'center',
    },
    bottomShadow: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: '#030303',
        borderRadius: 25,
        height: 33,
        width: 121,
        justifyContent: 'center',
        position: 'absolute',
    },
    linearGradientStyleMain: {
        borderRadius: 25,
        height: 33,
        width: 121,
        justifyContent: 'center',
    },
    sellBuyButton2: {
        shadowColor: '#040404',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
        elevation: 8,
        alignSelf: 'center',
        height: 89,
        width: 67,
    },
    sellBuyGradient2: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
    },
    topShadow2: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        // shadowOpacity: 1,
        shadowColor: colors.greenShadow,
        borderRadius: 24,
        height: 89,
        width: 67,
        justifyContent: 'center',
        alignItems: 'center'
    },
    bottomShadow2: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: '#030303',
        borderRadius: 24,
        height: 89,
        width: 67,
        justifyContent: 'center',
        position: 'absolute',
    },
    linearGradientStyleMain2: {
        borderRadius: 24,
        height: 89,
        width: 67,
        justifyContent: 'center',
        alignItems: 'center'
    },
    sellBuyButton3: {
        shadowColor: '#040404',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
        elevation: 8,
        alignSelf: 'center',
        height: 38,
        width: widths * 0.60,
    },
    sellBuyGradient3: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
    },
    topShadow3: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        // shadowOpacity: 1,
        shadowColor: colors.greenShadow,
        borderRadius: 24,
        height: 38,
        width: widths * 0.60,
        justifyContent: 'center',
        alignItems: 'center'
    },
    bottomShadow3: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: '#030303',
        borderRadius: 24,
        height: 38,
        width: widths * 0.60,
        justifyContent: 'center',
        position: 'absolute',
    },
    linearGradientStyleMain3: {
        borderRadius: 24,
        height: 38,
        width: widths * 0.60,
        justifyContent: 'center',
        alignItems: 'center'
    },
    sellBuyButton4: {
        shadowColor: '#040404',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
        elevation: 8,
        alignSelf: 'center',
        height: 38,
        width: widths * 0.26,
        marginStart: 11
    },
    sellBuyGradient4: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
    },
    topShadow4: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        // shadowOpacity: 1,
        shadowColor: '#E85C5A',
        borderRadius: 24,
        height: 38,
        width: widths * 0.26,
        justifyContent: 'center',
        alignItems: 'center'
    },
    bottomShadow4: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: '#030303',
        borderRadius: 24,
        height: 38,
        width: widths * 0.26,
        justifyContent: 'center',
        position: 'absolute',
    },
    linearGradientStyleMain4: {
        borderRadius: 24,
        height: 38,
        width: widths * 0.26,
        justifyContent: 'center',
        alignItems: 'center'
    },
    rowContainer: {
        flexDirection: 'row',
        // -5 cropped the top edge of the gradient card on Strike+Ark
        // (carousel slot clips at its top boundary). 5 keeps the top
        // edge inside the slot while still ~25pt above the original 30
        // anchor — the 35pt-up Bam asked for, minus 10pt to avoid the
        // overflow.
        marginTop: 5,
    },
    progressBarImage: {
        width: 62,
        height: 15
    },
    minusButton: {
        marginTop: 5
    },
    bottomButtonsContainer: {
        flexDirection: 'row',
        marginTop: 15
    },
    bitcoinPriceContainer: {
        marginTop: 13,
        // Override BlackBGView's default 85pt outer / 80pt inner box.
        // Bam: shrink box height, keep text width. Text remains
        // 30pt fontSize so the price string still spans the same
        // horizontal length; only the vertical padding around it
        // shrinks. linearSecondStyle below mirrors with 52pt for the
        // inner gradient so both layers stay flush.
        height: 56,
        // Lift the box 5pt via paint-only transform. Tried marginTop
        // first (13 → 3) but it didn't visibly move — the parent
        // column flex absorbed the change because the next sibling
        // (`isShowButtons` GradientView with marginTop:60, only on
        // the Account screen) consumes free vertical space. translateY
        // is layout-independent: it shifts the rendered position
        // without affecting flex math, so it lifts cleanly on home.
        // Was -10pt initially; backed off to -5 per Bam after the
        // shorter box freed enough vertical breathing room that the
        // -10 lift left a visible gap below the BUY/SELL buttons.
        transform: [{ translateY: -5 }],
    },
    bitcoinPriceContainerInner: {
        height: 52,
    },
    bitcoinPriceText: {
        fontSize: 30,
        // Tighter line-height to match the shorter box without
        // clipping descenders on the price string. 40 → 34 still
        // clears the tallest BTC-symbol glyph at 30pt.
        lineHeight: 34
    },
    strikeLogo: {
        width: 160,
        height: 50,
        marginTop: 40,
        alignSelf: 'center'
    },
});
