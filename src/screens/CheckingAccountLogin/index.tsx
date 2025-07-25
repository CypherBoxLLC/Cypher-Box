import React from "react";
import { Linking, TouchableOpacity, View, Image } from "react-native";
import styles from "./styles";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
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

const config = {
    id: 'strike',
    name: 'Strike',
    type: 'oauth',
    issuer: "https://auth.strike.me", // Strike Identity Server URL
    clientId: "cypherbox",
    clientSecret: "SbYmuewpZGS8XDktirso8ficpChSGu7dEaYuMrLx+3k=", // If needed (but avoid hardcoding secrets in client-side code)
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
    allBTCWallets,
    FirstTimeLightning,
    setStrikeMe,
    setStrikeAuth,
    setStrikeToken,
    setAllBTCWallets,
    setFirstTimeLightning
  } = useAuthStore();

  const createCheckingAccountClickHandler = () => {
    Linking.openURL("https://coinos.io/register");
  };

  const createStrikeAccountClickHandler = () => {
    Linking.openURL("https://dashboard.strike.me/signup");
  };

  const handleCoinosLogin = () => {
    dispatchNavigate("LoginCoinOSScreen");
  };

  const handleStrikeLogin = async () => {
    try {
      const result = await authorize(config);
      console.log("Access Token:", result);
      setStrikeToken(result.accessToken);
      setStrikeAuth(true);
      const temp = [...allBTCWallets];
      const tokenParts = result.accessToken.split(".");
      const header = Buffer.from(tokenParts[0], "base64").toString("utf8");
      const payload = Buffer.from(tokenParts[1], "base64").toString("utf8");
      const signature = tokenParts[2];
      const decoded = JSON.parse(payload);
      console.log("decoded", decoded);
      console.log("signature: ", signature);
      setStrikeMe(decoded);
      setAllBTCWallets([...temp, "STRIKE"]);
      if(FirstTimeLightning){
        dispatchNavigate("CheckingAccountCreated");
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

  return (
    <ScreenLayout showToolbar>
      <View style={styles.container}>
        <HeaderWithLine title="Login to Lightning Account" />
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
          {!isAuth && (
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
