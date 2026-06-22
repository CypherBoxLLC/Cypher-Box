import React, { useEffect } from "react";
import { Linking, TouchableOpacity, View, Image, ActivityIndicator } from "react-native";
import { generateMnemonic as barkGenerateMnemonic } from "@secondts/bark-react-native";
import styles from "./styles";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate, openInAppBrowser } from "@Cypher/helpers";
import { FEATURE_ARK_ENABLED } from "@Cypher/services/ark";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import { authorize } from "react-native-app-auth";
import { jwtDecode } from "jwt-decode";
import { Buffer } from "buffer";
import { dispatchReset } from "@Cypher/helpers/navigation";
import {
  LoginOption,
  RegisterPrompt,
  HeaderWithLine,
  CreateButton,
} from "@Cypher/components";
import accountStyles from "@Cypher/components/CheckingAccount/styles";
import LinearGradient from "react-native-linear-gradient";
import SimpleToast from "react-native-simple-toast";
import Ionicons from "react-native-vector-icons/Ionicons";

const config = {
    id: 'strike',
    name: 'Strike',
    type: 'oauth',
    clientId: "cypherbox",
    // clientSecret removed — do not hardcode secrets
    clientSecret: "",
    redirectUrl: "cypherbox://oauth/callback", // Must match the redirect URI in your Strike app settings
    scopes: ["offline_access", 'partner.currency-exchange-quote.create', 'partner.currency-exchange-quote.execute', 'partner.currency-exchange-quote.read', 'partner.receive-request.read', 'partner.deposit.manage', 'partner.payout-originator.read', 'partner.payment-quote.onchain.create', 'partner.payment-quote.lightning.create', 'partner.payment-quote.execute', 'partner.receive-request.create', "partner.balances.read", "partner.currency-exchange-quote.read", "partner.account.profile.read", "profile", "openid", "partner.invoice.read", "partner.invoice.create", "partner.invoice.quote.generate", "partner.invoice.quote.read", "partner.rates.ticker"], // Specify necessary scopes
    usePKCE: true,
    skipCodeExchange: true,
    idToken: false,
    checks: ['pkce', 'state'],
    // Hardcoded endpoints skip the OIDC discovery fetch
    // (`/.well-known/openid-configuration`) that `issuer` would otherwise
    // trigger before iOS can show the auth permission prompt — that round-
    // trip was ~300-800ms of dead air between tapping "Login" and seeing
    // anything happen. Endpoints verified against the live discovery doc
    // (2026-04-27): Strike uses `/connect/*` paths, NOT `/oauth/*` (the
    // earlier commented-out guesses had the wrong path). If Strike rotates
    // these, re-derive from `https://auth.strike.me/.well-known/openid-configuration`.
    serviceConfiguration: {
      authorizationEndpoint: "https://auth.strike.me/connect/authorize",
      tokenEndpoint: "https://auth.strike.me/connect/token",
      revocationEndpoint: "https://auth.strike.me/connect/revocation",
    },
};

export default function CheckingAccountLogin() {
  const {
    isAuth,
    isStrikeAuth,
    isArkAuth,
    allBTCWallets,
    FirstTimeLightning,
    setStrikeMe,
    setStrikeAuth,
    setStrikeToken,
    setAllBTCWallets,
    setFirstTimeLightning
  } = useAuthStore();
  const [strikeLoading, setStrikeLoading] = React.useState(false);
  const [CoinosException, setCoinosException] = React.useState(false);
  const [pageLoading, setPageLoading] = React.useState(true);

  useEffect(() => {
    // Geo-gate temporarily disabled per Bam's intermediate phase: ship
    // archive builds with CoinOS visible everywhere so the full
    // custodial / non-custodial Lightning matrix is testable end-to-end.
    // The IP round-trip + EU/GB/IN/CN block is kept below as the
    // canonical reference for re-enabling alongside `isCoinosAllowed()`
    // in services/featureFlags.ts when the production gate goes back on.
    setPageLoading(false);
    return;

    // --- Original IP-based gate (preserved for re-enable) -----------
    // Dev bypass + EU/GB/IN/CN block via ipapi.co. Pair with
    // `isCoinosAllowed()` (locale-based) in featureFlags.ts when wiring
    // CoinOS visibility back to a production gate.
    //
    // if (__DEV__) {
    //   setPageLoading(false);
    //   return;
    // }
    async function fetchIPInfo() {
      try {
        setPageLoading(true);
        const res = await fetch('https://ipapi.co/json/');
        const data = await res.json();

        const isBlocked =
          data.continent_code === 'EU' ||
          ['GB', 'IN', 'CN'].includes(data.country_code);

        if (isBlocked) {
          setCoinosException(true);
        }
      } catch (error) {
        console.log('IP fetch failed', error);
      } finally {
        setPageLoading(false);
      }
    }

    fetchIPInfo();
  }, []);

  const createCheckingAccountClickHandler = () => {
    openInAppBrowser("https://coinos.io/register");
  };

  const createStrikeAccountClickHandler = () => {
    openInAppBrowser("https://dashboard.strike.me/signup");
  };

  const handleCoinosLogin = () => {
    dispatchNavigate("LoginCoinOSScreen");
  };

  const handleArkCreate = () => {
    // Skip the CreateArkScreen intro (experimental warning + hot-vault
    // seed-source toggle) and go straight to the seed-phrase reveal.
    // Mirrors the fresh-seed branch of the old CreateArkScreen.handleCreate.
    const mnemonic = barkGenerateMnemonic();
    dispatchNavigate("ArkSeedPhraseScreen", { mnemonic });
  };

  // Manual seed-entry recovery — surfaced as a sibling to the big "Create Ark"
  // CTA so users with a written-down seed never have to dig into Settings or
  // the DEV Capsules tab to find their way back into a wallet on a fresh
  // install. Mirrors the hot-vault "Already have a hot vault? Recover" flow.
  const handleArkRecover = () => {
    dispatchNavigate("RecoverArkScreen");
  };

  const openArkInfo = () => {
    Linking.openURL("https://second.tech");
  };

  // Opens the standalone custodial-risk explainer (CheckingAccountIntro,
  // repurposed from its old role as a one-time gate on the way into this
  // screen — see HomeScreen.loginClickHandler). Reached via the "?" icon
  // next to the CUSTODIAL section header below.
  const openCustodialInfo = () => {
    dispatchNavigate("CheckingAccountIntro");
  };

  const handleStrikeLogin = async () => {
    try {
      const result = await authorize(config);
      const reStrikeTokenExchange = await strikeTokenExchange(result.authorizationCode, result.codeVerifier || '');
      setStrikeToken(reStrikeTokenExchange.access_token);
      setStrikeAuth(true);
      const temp = [...allBTCWallets];
      const tokenParts = reStrikeTokenExchange.access_token.split(".");
      const header = Buffer.from(tokenParts[0], "base64").toString("utf8");
      const payload = Buffer.from(tokenParts[1], "base64").toString("utf8");
      const signature = tokenParts[2];
      const decoded = JSON.parse(payload);
      setStrikeMe(decoded);
      setAllBTCWallets([...temp, "STRIKE"]);
      if(FirstTimeLightning){
        setFirstTimeLightning(false);
        dispatchNavigate("CheckingAccountCreated", { accountType: 'strike' });
      }else{
        dispatchReset("HomeScreen", {
          isComplete: true
        });
      }
      

      // if (balances && balances?.balances) {
      //   const numericAmount = Number(balances.balances[0].amount.replace(/[^0-9\.]/g, ''));
      //   setMatchedRate(numericAmount);
      // }
    } catch (error) {
      console.error("OAuth error", error);
    }
  };

  const strikeTokenExchange = async (code: string, verifier: string) => {
    try {
      setStrikeLoading(true);
      const details = {
        code: code,
        verifier: verifier,
      };      
      const response = await fetch('https://cypherbox-backend.onrender.com/oauth/start', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(details),
      });

      const responseJSON = await response.json();
      if (responseJSON.success) {
        return responseJSON.data;
      } else {
        SimpleToast.show('Strike authentication failed.', SimpleToast.SHORT);
        return null;
      }
    } catch (error) {
      console.error("Fetch Error:", error);
    } finally {
      setStrikeLoading(false);
    }
  };

  
  if(pageLoading){
    return (
      <ScreenLayout showToolbar>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.white} />
        </View>
      </ScreenLayout>
    );
  }

  if(strikeLoading){
    return (
      <ScreenLayout showToolbar>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.white} />
          <Text style={styles.loadingText}>Logging in to Strike...</Text>
        </View>
      </ScreenLayout>
    );
  }

  // Visibility flags for the two category sections — used to suppress
  // empty headers when every provider in a section is already connected.
  const showCustodial = !isStrikeAuth || (!isAuth && !CoinosException);
  const showArk = FEATURE_ARK_ENABLED && !isArkAuth;

  return (
      <ScreenLayout showToolbar>
      <View style={styles.container}>
        <HeaderWithLine title="Add a Lightning Wallet" titleColor="#FFFFFF" />
        <View style={styles.content}>
          <Text style={styles.intro}>
            Pick a provider to power Lightning send/receive. Custodial accounts
            hold your bitcoin with a third party, while non-custodial wallets
            let you have full control over your keys and funds.
          </Text>

          {showArk && (
            <>
              <View style={styles.sectionHeader}>
                <Text bold style={[styles.sectionTitle, styles.sectionTitleAccent]}>
                  NON-CUSTODIAL  ·  LIGHTNING-ENABLED
                </Text>
                <View style={[styles.sectionDivider, styles.sectionDividerArk]} />
              </View>
              <Text style={styles.sectionSubtitle}>
                Create a self-custodial wallet — keys under your full control.
              </Text>

              {/* Ark (Second.tech) — gated behind FEATURE_ARK_ENABLED until
                  mainnet ASP launches. Re-enable in services/ark/config.ts.
                  Row layout mirrors Strike/CoinOS: [Ark Vault 🚣 + Second]
                  on the left, [Recover] on the right (yellow-accented to
                  signal the non-custodial provider). The boat-outline
                  glyph reuses the same Ark visual identifier the Vault
                  tab and home Card use, so the brand is consistent. */}
              <View style={accountStyles.providerRow}>
                <LoginOption
                  label="Create Ark Vault"
                  labelColor={colors.white}
                  iconPrefixIonicon="boat-outline"
                  iconPrefixTint={colors.white}
                  borderColor={colors.ark.extralight}
                  onPress={handleArkCreate}
                  containerStyle={accountStyles.loginOptionContainerInRow}
                />
                <CreateButton
                  label="Recover"
                  accentColor={colors.ark.light}
                  onPress={handleArkRecover}
                />
              </View>
              {/* Ark experimental disclaimer — replaces the prior
                  RegisterPrompt with a tighter, more professional
                  inline note. Yellow "Learn more" matches the wallet's
                  accent so the affordance reads as Ark-specific. */}
              <View style={accountStyles.experimentalNotice}>
                <Ionicons
                  name="warning-outline"
                  size={13}
                  color={colors.ark.light}
                  style={accountStyles.experimentalIcon}
                />
                <Text style={accountStyles.experimentalText}>
                  Experimental technology. Use at your own risk.{' '}
                </Text>
                <TouchableOpacity onPress={openArkInfo} activeOpacity={0.7}>
                  <Text bold style={accountStyles.experimentalLink}>Learn more</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {showCustodial && (
            <>
              <View style={styles.sectionHeader}>
                <Text bold style={styles.sectionTitle}>CUSTODIAL  ·  LIGHTNING-ENABLED</Text>
                {/* On-demand explainer of custodial-Lightning trust
                    assumptions. Replaces the prior one-time
                    CheckingAccountIntro gate so users who already
                    understand the model aren't forced through it on
                    every install. */}
                <TouchableOpacity
                  onPress={openCustodialInfo}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.helpIcon}
                  accessibilityLabel="Learn about custodial Lightning"
                  accessibilityRole="button"
                >
                  <Ionicons name="help-circle-outline" size={16} color={colors.white} />
                </TouchableOpacity>
                <View style={styles.sectionDivider} />
              </View>
              <Text style={styles.sectionSubtitle}>
                Sign in to an existing Lightning account. Or create an account
                on provider's website and come back again to Cypher Box and login!
              </Text>

              {!isStrikeAuth && (
                /* Side-by-side row: [Login to + Strike logo] + [Create].
                   The wider login pill stays on the LEFT; the narrower
                   pink-bordered Create button takes the remaining space
                   and links to Strike's signup page. */
                <View style={accountStyles.providerRow}>
                  <LoginOption
                    label="Login to"
                    logo={require("@Cypher/assets/images/strike.png")}
                    onPress={handleStrikeLogin}
                    containerStyle={accountStyles.loginOptionContainerInRow}
                  />
                  <CreateButton onPress={createStrikeAccountClickHandler} />
                </View>
              )}
              {!isAuth && !CoinosException && (
                <View style={accountStyles.providerRow}>
                  <LoginOption
                    label="Login to"
                    logo={require("@Cypher/assets/images/coinos.png")}
                    onPress={handleCoinosLogin}
                    containerStyle={accountStyles.loginOptionContainerInRow}
                  />
                  <CreateButton onPress={createCheckingAccountClickHandler} />
                </View>
              )}
            </>
          )}
        </View>
      </View>
    </ScreenLayout>
  );
}
