import useAuthStore from '@Cypher/stores/authStore';
import SimpleToast from "react-native-simple-toast";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { updateExchangeRate, EXCHANGE_RATES_STORAGE_KEY } from "../../blue_modules/currency";
import { getFiatRate } from "../../models/fiatUnit";
import { assertLnurlPayCallbackUrl, assertAmountWithinSendable, buildCallbackUrl, verifyLnurlPayInvoice } from "./lnurlPayValidation";

const BASE_URL = 'https://coinos.io/api';

const withAuthToken = async (requestConfig: any) => {
  const authToken = useAuthStore.getState().token;
  if (!authToken) {
    throw new Error('Authentication required. Please login to continue.');
  }
  return {
    ...requestConfig,
    headers: {
      ...requestConfig.headers,
      Authorization: `${authToken}`,
    },
  };
};

export const registerUser = async (username: string, password: string) => {
  try {
    const payload = {
        user: {
            username: username,
            password: password,
        }
    }
if (__DEV__) console.log('payload:', payload)
    const response = await fetch(`${BASE_URL}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    return await response.text();
  } catch (error) {
    console.error('Error registering user:', error);
    throw error;
  }
};

export const loginUser = async (username: string, password: string, recaptchaToken: string) => {
  try {
    const payload = {
        username,
        password,
        recaptcha: recaptchaToken || '' // Send empty string if no token
    };
    
if (__DEV__) console.log('Logging in with username:', username);
    
    const response = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'CoinOS-Mobile-App',
      },
      body: JSON.stringify(payload),
    });
    
if (__DEV__) console.log('Response status:', response.status);
    
    if (response.status === 401) {
      const errorText = await response.text();
      // Diagnostic — multiple users have reported "Captcha verification
      // failed" on CoinOS login but our prior throw discarded the raw
      // response. Log the literal body + response headers so we can tell
      // apart: "failed captcha" (Google scored low / domain mismatch /
      // action mismatch), "invalid recaptcha" (siteKey wrong), or anything
      // else CoinOS might surface. Trim/limit so we don't dump huge bodies.
      console.log(
        '[CoinOS login 401]',
        'bodyLen=', errorText?.length ?? 0,
        'bodyHead=', JSON.stringify(errorText?.slice?.(0, 300) ?? ''),
        'contentType=', response.headers.get('content-type'),
        'recaptchaTokenLen=', recaptchaToken?.length ?? 0,
      );
      if (errorText === 'failed captcha' || errorText.includes('captcha')) {
        throw new Error('Captcha verification failed. Please try again.');
      }
      if (errorText === '2fa required' || errorText.includes('2fa')) {
        throw new Error('2fa required');
      }
      throw new Error('Invalid username or password');
    }
    
    if (response.status === 429) {
      throw new Error('Too many login attempts. Please wait and try again later.');
    }

    // 502/503/504 are transient gateway errors from CoinOS's own
    // infrastructure (Cloudflare briefly can't reach their origin), not a
    // credential problem. Give the user a retry hint instead of a raw
    // "status 502". Observed intermittently 2026-07-08.
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      throw new Error('Coinos is temporarily unavailable. Please try again in a moment.');
    }

    if (!response.ok) {
      throw new Error(`Login failed with status ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error logging in user:', error);
    throw error;
  }
};

/**
 * Silently refresh CoinOS token using stored Keychain credentials.
 * Returns the new token string on success, or null if refresh fails.
 * Does NOT require captcha — CoinOS allows re-login without it for existing sessions.
 *
 * De-duped across the JS bundle lifetime: reading the biometric-protected
 * keychain entry always shows a FaceID/TouchID prompt, so only do it once
 * per app launch regardless of how many times HomeScreen mounts.
 */
let _coinosTokenRefreshAttempted = false;
export const resetCoinOSTokenRefresh = () => {
  _coinosTokenRefreshAttempted = false;
};
export const refreshCoinOSToken = async (): Promise<string | null> => {
  if (_coinosTokenRefreshAttempted) return null;
  _coinosTokenRefreshAttempted = true;
  try {
    const Keychain = require('react-native-keychain');
    const credentials = await Keychain.getGenericPassword({
      service: 'coinos-login',
      authenticationPrompt: { title: 'Authenticate to refresh CoinOS session' },
    });

    if (!credentials || !credentials.username || !credentials.password) {
if (__DEV__) console.log('[CoinOS] No keychain credentials for token refresh');
      return null;
    }

    const payload = {
      username: credentials.username,
      password: credentials.password,
      recaptcha: '',
    };

    const response = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'CoinOS-Mobile-App',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Diagnostic — when silent token refresh started 401-ing for multiple
      // users (and persisted across networks), the comment above said
      // CoinOS "allows re-login without captcha for existing sessions."
      // That's worth verifying — if CoinOS now requires captcha on EVERY
      // login including silent refresh, this whole path is broken and we
      // need to either drive the captcha here too or stop calling refresh
      // and force a manual login. The body tells us which.
      const errorText = await response.text().catch(() => '');
      console.warn(
        '[CoinOS] Token refresh failed:',
        response.status,
        'bodyHead=', JSON.stringify(errorText?.slice?.(0, 300) ?? ''),
        'contentType=', response.headers.get('content-type'),
      );
      return null;
    }

    const data = await response.json();
    if (data?.token) {
if (__DEV__) console.log('[CoinOS] Token refreshed successfully');
      return data.token;
    }
    return null;
  } catch (e: any) {
    console.warn('[CoinOS] Token refresh error:', e.message);
    return null;
  }
};

export const forgetPassword = async (email: string) => {
  try {
    const response = await fetch(`${BASE_URL}/forgot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({email}),
    });

    return await response.text();
  } catch (error) {
    console.error('Error registering user:', error);
    throw error;
  }
};

export const updateUserName = async (id: string, email: string) => {
  try {
    const response = await fetch(`${BASE_URL}/request`, await withAuthToken({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id, email }),
    }));
    return await response.text();
  } catch (error) {
    console.error('Error sending bitcoin payment:', error);
    throw error;
  }
};

export const createInvoice = async (invoiceData: any) => {
  try {
    const response = await fetch(`${BASE_URL}/invoice`, await withAuthToken({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ invoice: invoiceData }),
    }));
    return await response.json();
  } catch (error) {
    console.error('Error creating invoice:', error);
    throw error;
  }
};

export const getInvoiceByLightening = async (hash: string) => {
  try {
    const response = await fetch(`${BASE_URL}/decode/${hash}`, await withAuthToken({
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }));
    return await response.json();
  } catch (error) {
    console.error('Error fetching invoice by lightening coinos:', error);
    throw error;
  }
};

export const getInvoiceByHash = async (hash: string) => {
  try {
    const response = await fetch(`${BASE_URL}/invoice/${hash}`, await withAuthToken({
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }));
    return await response.json();
  } catch (error) {
    console.error('Error fetching invoice by hash:', error);
    throw error;
  }
};

export const sendLightningPayment = async (payreq: string, memo: string, amount?: any) => {
  // Bound the HTTP call so a stuck backend / Cloudflare 524 can't hang the
  // caller's UI indefinitely. The Coinos LN payment may still complete on
  // their side after we abort; the caller must treat AbortError as PENDING
  // (do not invite a retry — see 2026-05-31 incident notes).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45_000);
  try {
if (__DEV__) console.log('sendLightningPayment payload: ', amount, amount && amount !== '' && amount !== 0 ? { payreq: payreq, memo: memo, amount } : { payreq: payreq, memo: memo })
    const response = await fetch(`${BASE_URL}/payments`, await withAuthToken({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(amount && amount !== '' && amount !== 0 ? { payreq: payreq, memo: memo, amount } : { payreq: payreq, memo: memo }),
      signal: controller.signal,
    }));

if (__DEV__) console.log('response: ', response)
    const responseJSON = await response.text();
if (__DEV__) console.log('responseJSON: ', responseJSON)
    return responseJSON;
  } catch (error) {
    console.error('Error sending lightning payment:', error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const sendCoinsViaUsername = async (address: string, amount: number, memo: string) => {
  try {
    let [name, domain] = address.split("@");
    const user = useAuthStore.getState().user;

    if(user?.toLowerCase() === name?.toLowerCase()){
      SimpleToast.show("Cannot send to self", SimpleToast.SHORT);
      throw new Error("Cannot send to self");
    }

    let url = `https://${domain}/.well-known/lnurlp/${name}`;

    const response = await fetch(url);
if (__DEV__) console.log('sendCoinsViaLNURL response: ', response)
    const lnurlPayData = await response.json();
if (__DEV__) console.log('sendCoinsViaLNURL lnurlPayData: ', lnurlPayData)

    if (lnurlPayData.tag === "payRequest") {
      // Verify the service before trusting anything it returns: https-only
      // callback, declared min/max bounds, then verify the returned invoice
      // matches the amount the user confirmed and commits to the service
      // metadata (same checks as the hardened class/lnurl.js path).
      assertLnurlPayCallbackUrl(lnurlPayData.callback);
      const amountMsat = Math.floor(amount * 1000);
      assertAmountWithinSendable(amountMsat, lnurlPayData.minSendable, lnurlPayData.maxSendable);
      const paymentResponse = await fetch(buildCallbackUrl(lnurlPayData.callback, amountMsat), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
if (__DEV__) console.log('sendCoinsViaLNURL paymentResponse: ', paymentResponse)

      const paymentResult = await paymentResponse.json();
if (__DEV__) console.log('sendCoinsViaLNURL paymentResult: ', paymentResult)
      if(paymentResult.pr){
        verifyLnurlPayInvoice(paymentResult.pr, amount, lnurlPayData.metadata);
if (__DEV__) console.log('domain: ', domain)
        if(domain == 'coinos.io'){
          const response = await fetch(`${BASE_URL}/payments`, await withAuthToken({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ amount: amount, hash: paymentResult.pr }),
          }));
      
if (__DEV__) console.log('response: ', response)
          const responseJSON = await response.json();
if (__DEV__) console.log('responseJSON: ', responseJSON)
          return responseJSON;
        } else {
          const sendToUser = await sendLightningPayment(paymentResult.pr, memo, amount)

if (__DEV__) console.log('sendToUser: ' ,sendToUser)
          return sendToUser;  
  
        }
      } else {
        SimpleToast.show(paymentResult.reason, SimpleToast.SHORT);
        throw paymentResult?.reason;
      }
    } else {
      SimpleToast.show("Invalid LNURL-Pay response", SimpleToast.SHORT)
      throw new Error("Invalid LNURL-pay response");
    }
  } catch (error) {
    console.error("Error sending LNURL-pay payment:", error);
    throw error;
  }
}

export const sendInternalPayment = async (amount: number, hash: string) => {
  try {
    const response = await fetch(`${BASE_URL}/payments`, await withAuthToken({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount, hash }),
    }));
    return await response.json();
  } catch (error) {
    console.error('Error sending internal payment:', error);
    throw error;
  }
};

export const bitcoinRecommendedFee = async () => {
  try {
    const response = await fetch(`https://mempool.space/api/v1/fees/recommended`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return await response.json();
  } catch (error) {
    console.error('Error getting Fee:', error);
    throw error;
  }
};

export const bitcoinSendFee = async (amount: number, address: string, feeRate: number) => {
  try {
    const response = await fetch(`${BASE_URL}/bitcoin/fee`, await withAuthToken({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount, address, feeRate}),
    }));
    
    return await response.text();
  } catch (error) {
    console.error('Error sending bitcoin payment:', error);
    throw error;
  }
};

export const sendBitcoinPayment = async (amount: number, address: string, feeRate: number, memo: string) => {
  try {
    const response = await fetch(`${BASE_URL}/bitcoin/send`, await withAuthToken({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: feeRate === 0 ? JSON.stringify({ amount, address }) : JSON.stringify({ amount, address, feeRate, memo }),
    }));
    return await response.text();
  } catch (error) {
    console.error('Error sending bitcoin payment:', error);
    throw error;
  }
};

export const getMe = async () => {
  try {
    const response = await fetch(`${BASE_URL}/me`, await withAuthToken({
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }));
if (__DEV__) console.log('response: ', response?.status)
    if(response?.status === 401){
      SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT)
      useAuthStore.getState().clearAuth();
      return null;
    }
    const result = await response.json()
if (__DEV__) console.log('result: ', result)
    return result;
  } catch (error) {
    console.error('Error getting me:', error);
    throw error;
  }
};

/**
 * Currency rates — historically pulled from CoinOS's `/rates` endpoint,
 * but that source proved unreliable: intermittent 5xx, stale figures
 * during quoting flows, and outright broken responses that surfaced
 * as zero-rate displays in the send keyboard, transaction history,
 * invoice-creation USD preview, and the swap screen.
 *
 * Per Bam (May 2026): rates now come from BlueWallet's built-in
 * currency daemon (`blue_modules/currency`), the same machinery
 * the vault screens, Ark card, and HomeScreen's `matchedRate` use.
 * Going through `updateExchangeRate()` means we get:
 *   - The user's selected fiat source (CoinDesk / Coinbase /
 *     CoinGecko / Bitstamp / etc., per `FiatUnit[ticker].source`)
 *   - The 30-minute TTL the daemon enforces — repeated calls don't
 *     spam any single rate provider
 *   - Persistence to AsyncStorage so the cache survives app restarts
 *     and works offline after the first successful fetch
 *
 * Flow:
 *   1. `updateExchangeRate()` — refreshes the cache if stale, no-op
 *      otherwise. This is BlueWallet's own entrypoint; we never call
 *      a rate extractor directly. Errors here are non-fatal; the
 *      daemon stamps `LAST_UPDATED_ERROR: true` and we still try to
 *      read whatever cached value is left.
 *   2. Read the cache from AsyncStorage and return the BTC_USD entry.
 *
 * Return shape preserved as `{ USD: <USD-per-BTC> }` so existing call
 * sites that do `matchKeyAndValue(response, 'USD')` keep working
 * without per-site changes. Auth no longer required (BlueWallet rate
 * is local) — that's a deliberate side benefit: the rate is now
 * available even when the CoinOS token has expired.
 *
 * EUR / GBP etc. are NOT included in the returned object because
 * every current call site only matches 'USD'; if a screen ever needs
 * a different fiat, add it via the same daemon path.
 */
export const getCurrencyRates = async () => {
  try {
    // 1) Refresh BlueWallet's daemon cache (no-op if it's been
    //    called within 10s OR the cache is < 30 min old).
    await updateExchangeRate();

    // 2) Cache hit path — only works when the user's preferred
    //    currency is USD. The daemon stores ONE entry, keyed by
    //    `BTC_<preferredCurrency>`. For USD users this is BTC_USD
    //    and we get a fast read. For users on EUR / GBP / etc.,
    //    BTC_USD never lands in the cache so we fall through.
    const raw = await AsyncStorage.getItem(EXCHANGE_RATES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const cached = parsed?.['BTC_USD'];
      if (typeof cached === 'number' && cached > 0) {
        return { USD: cached };
      }
    }

    // 3) Fallback: call getFiatRate('USD') — BlueWallet's own
    //    rate-source dispatcher in models/fiatUnit.ts. It picks
    //    the extractor configured for the USD FiatUnit (CoinDesk
    //    by default, configurable via fiatUnits.json) and returns
    //    USD-per-BTC. Same machinery the daemon uses internally;
    //    we just skip the daemon's preferred-currency-only cache
    //    layer because non-USD users would otherwise see $0.00
    //    on every CoinOS-paid screen (send keyboard, tx history,
    //    invoice creation, swap).
    const live = await getFiatRate('USD');
    return { USD: Number(live) || 0 };
  } catch (error) {
    console.error('Error getting BlueWallet rate:', error);
    return { USD: 0 };
  }
};

export const getTransactionHistory = async (offset: number, limit: number) => {
  try {
    const response = await fetch(`${BASE_URL}/payments?offset=${offset}&limit=${limit}`, await withAuthToken({
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }));
    return await response.json();
  } catch (error) {
    console.error('Error fetching getTransactionHistory:', error);
    throw error;
  }
};

export const getTransactionDetail = async (id: number) => {
  try {
    const response = await fetch(`${BASE_URL}/payments/${id}`, await withAuthToken({
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }));
    return await response.json();
  } catch (error) {
    console.error('Error fetching getTransactionDetail:', error);
    throw error;
  }
};

// ===========================================
// Two-Factor Authentication (2FA/TOTP)
// ===========================================

/**
 * Get OTP secret for 2FA setup.
 * Requires user to have a PIN set (server uses requirePin middleware).
 * Returns: { secret: string, username: string }
 */
export const getOTPsecret = async () => {
  try {
    const response = await fetch(`${BASE_URL}/user/otpsecret`, await withAuthToken({
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401 && errorText.includes('pin')) {
        throw new Error('PIN required. Please set a PIN in your CoinOS account first.');
      }
      throw new Error(`Failed to get OTP secret: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error getting OTP secret:', error);
    throw error;
  }
};

/**
 * Enable 2FA on the user's account.
 * @param token - 6-digit TOTP code from authenticator app
 */
export const enableTwoFA = async (token: string) => {
  try {
    const response = await fetch(`${BASE_URL}/user/2fa/enable`, await withAuthToken({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    }));

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        throw new Error('Invalid TOTP code. Please try again.');
      }
      throw new Error(`Failed to enable 2FA: ${errorText}`);
    }

if (__DEV__) console.log('[CoinOS] 2FA enabled successfully');
    return { success: true };
  } catch (error) {
    console.error('Error enabling 2FA:', error);
    throw error;
  }
};

/**
 * Disable 2FA on the user's account.
 * @param token - 6-digit TOTP code from authenticator app
 */
export const disableTwoFA = async (token: string) => {
  try {
    const response = await fetch(`${BASE_URL}/user/2fa/disable`, await withAuthToken({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    }));

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        throw new Error('Invalid TOTP code. Please try again.');
      }
      throw new Error(`Failed to disable 2FA: ${errorText}`);
    }

if (__DEV__) console.log('[CoinOS] 2FA disabled successfully');
    return { success: true };
  } catch (error) {
    console.error('Error disabling 2FA:', error);
    throw error;
  }
};

/**
 * Submit 2FA token during login (after password auth).
 * Re-sends login credentials with the TOTP token.
 */
export const verifyTwoFALogin = async (token: string, username: string, password: string, captchaToken?: string) => {
  try {
    // Re-login with credentials + 2FA TOTP code
    // Only include recaptcha if we have it (may have expired since first attempt)
    const payload: any = {
      username,
      password,
      token: token,  // 6-digit TOTP code
    };
    if (captchaToken) {
      payload.recaptcha = captchaToken;
    }
if (__DEV__) console.log('[2FA] Sending login with token:', { username, tokenLength: token.length, hasCaptcha: !!captchaToken });
    
    const response = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'CoinOS-Mobile-App',
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
if (__DEV__) console.log('[2FA] Response status:', response.status, 'body:', responseText);
    
    if (!response.ok) {
      if (response.status === 401) {
        if (responseText.includes('captcha')) {
          throw new Error('Captcha verification failed. Please try again.');
        }
        if (responseText.includes('2fa')) {
          throw new Error('Invalid 2FA code. Please try again.');
        }
        throw new Error(responseText || 'Invalid 2FA code. Please try again.');
      }
      throw new Error(`2FA verification failed: ${responseText}`);
    }

    // Returns updated user object with full session
    return JSON.parse(responseText);
  } catch (error) {
    console.error('[2FA] Error verifying 2FA login:', error);
    throw error;
  }
};