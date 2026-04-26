import React, { useEffect } from "react";
import { Linking, TouchableOpacity, View, Image, ActivityIndicator } from "react-native";
import styles from "./styles";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
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
} from "@Cypher/components";
import LinearGradient from "react-native-linear-gradient";
import SimpleToast from "react-native-simple-toast";

const config = {
    id: 'strike',
    name: 'Strike',
    type: 'oauth',
    issuer: "https://auth.strike.me", // Strike Identity Server URL
    clientId: "cypherbox",
    // clientSecret removed — do not hardcode secrets
    clientSecret: "",
    redirectUrl: "cypherbox://oauth/callback", // Must match the redirect URI in your Strike app settings
    scopes: ["offline_access", 'partner.currency-exchange-quote.create', 'partner.currency-exchange-quote.execute', 'partner.currency-exchange-quote.read', 'partner.receive-request.read', 'partner.deposit.manage', 'partner.payout-originator.read', 'partner.payment-quote.onchain.create', 'partner.payment-quote.lightning.create', 'partner.payment-quote.execute', 'partner.receive-request.create', "partner.balances.read", "partner.currency-exchange-quote.read", "partner.account.profile.read", "profile", "openid", "partner.invoice.read", "partner.invoice.create", "partner.invoice.quote.generate", "partner.invoice.quote.read", "partner.rates.ticker"], // Specify necessary scopes
    //clientAuthMethod: "post",
    //wellKnown: `https://auth.strike.me/.well-known/openid-configuration`,
    // authorization: {
    //     params: {
    //         scope: 'partner.invoice.read offline_access',
    //         response_type: 'code',
    //     }
    // },
    usePKCE: true, 
    skipCodeExchange: true,
    idToken: false,
    checks: ['pkce', 'state'],
    // serviceConfiguration: {
    //   authorizationEndpoint: "https://auth.strike.me/oauth/authorize",
    //   tokenEndpoint: "https://auth.strike.me/oauth/token",
    //   revocationEndpoint: "https://auth.strike.me/oauth/revoke",
    // },
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
    Linking.openURL("https://coinos.io/register");
  };

  const createStrikeAccountClickHandler = () => {
    Linking.openURL("https://dashboard.strike.me/signup");
  };

  const handleCoinosLogin = () => {
    dispatchNavigate("LoginCoinOSScreen");
  };

  const handleArkCreate = () => {
    dispatchNavigate("CreateArkScreen");
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

  const handleStrikeLogin = async () => {
    try {
      const result = await authorize(config);
      console.log("Access Token:", result);
      const reStrikeTokenExchange = await strikeTokenExchange(result.authorizationCode, result.codeVerifier || '');
      setStrikeToken(reStrikeTokenExchange.access_token);
      setStrikeAuth(true);
      const temp = [...allBTCWallets];
      const tokenParts = reStrikeTokenExchange.access_token.split(".");
      const header = Buffer.from(tokenParts[0], "base64").toString("utf8");
      const payload = Buffer.from(tokenParts[1], "base64").toString("utf8");
      const signature = tokenParts[2];
      const decoded = JSON.parse(payload);
      console.log("decoded", decoded);
      console.log("signature: ", signature);
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
      console.log('details to send:', details);
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
        console.log("Response Body:", responseJSON);
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

  return (
      <ScreenLayout showToolbar>
      <View style={styles.container}>
        <HeaderWithLine title="Connect to Lightning providor" />
        <View style={styles.content}>
          {!isStrikeAuth && (
            <>
              <LoginOption
                logo={require("@Cypher/assets/images/strike.png")}
                onPress={handleStrikeLogin}
              />
              <RegisterPrompt
                text="Don't have a Strike account?"
                actionText="Download and register"
                onPress={createStrikeAccountClickHandler}
              />
            </>
          )}
          {!isAuth && !CoinosException && (
            <>
              <LoginOption
                logo={require("@Cypher/assets/images/coinos.png")}
                onPress={handleCoinosLogin}
              />
              <RegisterPrompt
                text="Don't have a Coinos account?"
                actionText="Register"
                onPress={createCheckingAccountClickHandler}
              />
            </>
          )}
          {FEATURE_ARK_ENABLED && !isArkAuth && (
            <>
              {/* Ark (Second.tech) — gated behind FEATURE_ARK_ENABLED until
                  mainnet ASP launches. Re-enable in services/ark/config.ts. */}
              <LoginOption
                logo={require("@Cypher/assets/images/second.png")}
                borderColor={colors.ark.extralight}
                onPress={handleArkCreate}
              />
              <RegisterPrompt
                text="⚠ Experimental — non-custodial Ark via Second"
                actionText="Learn more"
                onPress={openArkInfo}
              />
              <RegisterPrompt
                text="Already have an Ark seed phrase?"
                actionText="Recover"
                onPress={handleArkRecover}
              />
            </>
          )}
        </View>
        <View style={styles.footer}>
          <LinearGradient
            colors={["#333333", "rgba(48, 48, 51, 0.6)"]}
            style={styles.line}
          />
          <Image
            source={require("@Cypher/assets/images/electricity.png")}
            style={styles.lightningIcon}
            resizeMode="contain"
          />
        </View>
      </View>
    </ScreenLayout>
  );
}
