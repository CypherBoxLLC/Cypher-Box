import useAuthStore from '@Cypher/stores/authStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SimpleToast from "react-native-simple-toast";
import { revoke } from 'react-native-app-auth';
import { v4 as uuidv4 } from 'uuid';

const BASE_URL = 'https://api.strike.me/v1';

/**
 * Strike OAuth client + revocation endpoint, mirroring the serviceConfiguration
 * in CheckingAccountLogin. Kept here so the disconnect paths can revoke without
 * importing a screen. auth.strike.me is already a configured host for the login
 * flow, so this adds no new host.
 */
const STRIKE_REVOKE_CONFIG = {
    clientId: 'cypherbox',
    serviceConfiguration: {
        authorizationEndpoint: 'https://auth.strike.me/connect/authorize',
        tokenEndpoint: 'https://auth.strike.me/connect/token',
        revocationEndpoint: 'https://auth.strike.me/connect/revocation',
    },
};

/**
 * Tell Strike to invalidate an access token, so disconnecting actually ends the
 * session instead of leaving a working bearer token alive until it expires on
 * its own. The token is persisted (encrypted) on the device, so a stale valid
 * one is a real credential sitting at rest for no reason.
 *
 * Best effort by design: NEVER throws. The caller must be able to clear local
 * state unconditionally, so a network failure cannot strand someone in a
 * logged-in-looking state they can't leave.
 *
 * sendClientId is required because Strike runs IdentityServer, which expects
 * client_id in the revocation body. Basic auth is deliberately not used: the
 * app has no client secret (the OAuth relay holds it), so an Authorization
 * header here would just send an empty secret. If Strike rejects revocation
 * from the app because the client is confidential, this returns false and the
 * revoke has to move server-side into the relay.
 */
export const revokeStrikeToken = async (accessToken: string | null | undefined): Promise<boolean> => {
    if (!accessToken) return false;
    try {
        await revoke(STRIKE_REVOKE_CONFIG, {
            tokenToRevoke: accessToken,
            sendClientId: true,
        });
        return true;
    } catch (err) {
        console.warn('[Strike] access-token revocation failed:', err);
        return false;
    }
};

const withAuthToken = async (requestConfig: any) => {
    const authToken = useAuthStore.getState().strikeToken;
    if (!authToken) {
        throw new Error('Strike not logged in. Please log into Strike first.');
    }
    return {
        ...requestConfig,
        headers: {
            ...requestConfig.headers,
            Authorization: `Bearer ${authToken}`,
        },
    };
};

export const getBalances = async () => {
    try {
        const response = await fetch(`${BASE_URL}/balances/`, await withAuthToken({
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        const responseJSON = await response.json();
        if(responseJSON?.data && responseJSON?.data?.status === 401){
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT)
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error fetching balances by strike:', error);
        throw error;
    }
};

export const getStrikeRates = async () => {
    try {
        const response = await fetch(`${BASE_URL}/rates/ticker`, await withAuthToken({
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        const responseJSON = await response.json();
        if(responseJSON?.status === 401){
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT)
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error fetching Strike rates:', error);
        throw error;
    }
};

export const createInvoice = async (invoiceData: any) => {
  try {
if (__DEV__) console.log('invoiceData: ', invoiceData)
    const response = await fetch(`${BASE_URL}/receive-requests`, await withAuthToken({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invoiceData),
    }));
    return await response.json();
  } catch (error) {
    console.error('Error creating invoice:', error);
    throw error;
  }
};



export const getStrikeDepositAddress = async (): Promise<{ bitcoinAddress: string }> => {
  try {
    // Request on-chain deposit address from Strike
    const token = useAuthStore.getState().strikeToken;
    if (__DEV__) console.log('>>> getStrikeDepositAddress token:', token ? 'EXISTS' : 'MISSING');
    
    const response = await fetch(`${BASE_URL}/receive-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ onchain: {}, targetCurrency: 'BTC' }), // Cypher Box: receive as Bitcoin, no auto-convert to fiat
    });
    
if (__DEV__) console.log('>>> API response status:', response.status);
    
    if (!response.ok) {
      throw new Error(`Strike API error: ${response.status}`);
    }
    
    const data = await response.json();
if (__DEV__) console.log('>>> API response data:', JSON.stringify(data));
    return { bitcoinAddress: data.onchain?.address };
  } catch (error) {
    console.error('Error getting Strike deposit address:', error);
    throw error;
  }
};

export const sendStrikeLightningPayment = async (invoice: string, amount?: number): Promise<any> => {
  try {
    const idempotencyKey = uuidv4();

    // Step 1: Create Lightning payment quote
    //
    // Strike's `/payment-quotes/lightning` endpoint REQUIRES the BOLT11
    // to be passed as `lnInvoice` (not `invoice`). The previous shape
    // here always 400'd with:
    //   validationErrors.lnInvoice = "The field lnInvoice is required"
    // The helper had this wrong field name from day one — the only
    // pre-existing call site (ConfirmTransction) had never actually
    // succeeded against the Strike API. Don't rename the *parameter*
    // (callers still pass it as a positional arg called "invoice"); only
    // the request body field needs to match Strike's contract.
    const quoteData: any = { lnInvoice: invoice };
    if (amount) {
      quoteData.amount = amount;
    }
    
    const quoteResponse = await fetch(`${BASE_URL}/payment-quotes/lightning`, await withAuthToken({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': idempotencyKey
      },
      body: JSON.stringify(quoteData),
    }));
    
    if (!quoteResponse.ok) {
      // Surface Strike's error body so callers can show the user what
      // actually went wrong (e.g. "INVALID_INVOICE" / "ROUTE_NOT_FOUND")
      // instead of just an opaque HTTP status.
      let body = '';
      try { body = await quoteResponse.text(); } catch { /* ignore */ }
      // 401 = Strike OAuth token expired. Strike's tokens are not
      // auto-refreshed (unlike CoinOS) — the user has to re-login.
      // Clear the stored auth so the next render redirects them to
      // CheckingAccountLogin instead of leaving them stuck on a
      // wallet card whose balance reads now-stale data.
      if (quoteResponse.status === 401) {
        useAuthStore.getState().clearStrikeAuth();
        throw new Error('Strike session expired — please log into Strike again.');
      }
      throw new Error(
        `Strike quote error: ${quoteResponse.status}${body ? ` — ${body.slice(0, 200)}` : ''}`,
      );
    }

    const quoteDataResponse = await quoteResponse.json();
    const paymentQuoteId = quoteDataResponse.paymentQuoteId;
    if (__DEV__) console.log('Lightning payment quote ID:', paymentQuoteId, 'full response:', JSON.stringify(quoteDataResponse));
    
    // Step 2: Execute the Lightning payment
    const executeResponse = await fetch(`${BASE_URL}/payment-quotes/${paymentQuoteId}/execute`, await withAuthToken({
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
    }));
    
    if (!executeResponse.ok) {
      let body = '';
      try { body = await executeResponse.text(); } catch { /* ignore */ }
      if (executeResponse.status === 401) {
        useAuthStore.getState().clearStrikeAuth();
        throw new Error('Strike session expired — please log into Strike again.');
      }
      throw new Error(
        `Strike execute error: ${executeResponse.status}${body ? ` — ${body.slice(0, 200)}` : ''}`,
      );
    }
    
    const executeData = await executeResponse.json();
if (__DEV__) console.log('Lightning payment result:', executeData);
    return executeData;
  } catch (error) {
    console.error('Error sending Strike Lightning payment:', error);
    throw error;
  }
};

export const getPaymentQoute = async (url: string, data: any) => {
    try {
        const idempotencyKey = uuidv4();
if (__DEV__) console.log('idempotencyKey: ' ,idempotencyKey)
        const response = await fetch(`${BASE_URL}/payment-quotes/${url}`, await withAuthToken({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'idempotency-key': idempotencyKey
            },
            body: JSON.stringify(data),
        }));
        const responseJSON = await response.json();
        if(responseJSON?.data && responseJSON?.data?.status === 401){
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT)
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error fetching payment quote:', error);
        throw error;
    }
}

export const getPaymentQouteByLightening = async (data: any, paymentQouteID: string) => {
    const idempotencyKey = uuidv4();
if (__DEV__) console.log('idempotencyKey: ', idempotencyKey)
    try {
        // const response = await fetch(`${BASE_URL}/payment-quotes/lightning/lnurl`, await withAuthToken({
        //     method: 'POST',
        //     headers: {
        //         'Content-Type': 'application/json',
        //         'idempotency-key': idempotencyKey
        //     },
        //     body: JSON.stringify(data),
        // }));
        // const responseJSON = await response.json();
        // console.log('responseJSON: ', responseJSON)
        // const paymentQouteID = responseJSON.paymentQuoteId;
        // console.log('paymentQouteID: ', paymentQouteID)
        const responsePayment = await fetch(`${BASE_URL}/payment-quotes/${paymentQouteID}/execute`, await withAuthToken({
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        const responsePaymentJSON = await responsePayment.json();
if (__DEV__) console.log('responsePaymentJSON: ', responsePaymentJSON)
        return responsePaymentJSON;
    } catch (error) {
        console.error('Error fetching getPaymentQouteByLightening:', error);
        throw error;
    }
};

export const createFiatExchangeQuote = async (data: any, maxBuyFallback: boolean) => {
    const idempotencyKey = uuidv4();
    try {
        const responsePayment = await fetch(`${BASE_URL}/currency-exchange-quotes?maxBuyFallback=${maxBuyFallback}`, await withAuthToken({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'idempotency-key': idempotencyKey
            },
            body: JSON.stringify(data),
        }));
        const responseJSON = await responsePayment.json();
        if(responseJSON?.data && responseJSON?.data?.status === 401){
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT)
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error fetching createFiatExchangeQuote:', error);
        throw error;
    }
};

export const executeFiatExchangeQuote = async (paymentQouteID: string) => {
    try {
        const responsePayment = await fetch(`${BASE_URL}/currency-exchange-quotes/${paymentQouteID}/execute`, await withAuthToken({
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        // const responsePaymentJSON = await responsePayment.json();
        // console.log('responsePaymentJSON: ', responsePaymentJSON)
        return responsePayment;
    } catch (error) {
        console.error('Error fetching executeFiatExchangeQuote:', error);
        throw error;
    }
};

export const getPaymentQouteByLighteningURL = async (data: any, paymentQouteID: string) => {
    const idempotencyKey = uuidv4();
if (__DEV__) console.log('idempotencyKey: ', idempotencyKey)
    try {
        // const response = await fetch(`${BASE_URL}/payment-quotes/lightning`, await withAuthToken({
        //     method: 'POST',
        //     headers: {
        //         'Content-Type': 'application/json',
        //         'idempotency-key': idempotencyKey
        //     },
        //     body: JSON.stringify(data),
        // }));
        // const responseJSON = await response.json();
        // const paymentQouteID = responseJSON.paymentQuoteId;
        const responsePayment = await fetch(`${BASE_URL}/payment-quotes/${paymentQouteID}/execute`, await withAuthToken({
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        const responsePaymentJSON = await responsePayment.json();
        return responsePaymentJSON;
    } catch (error) {
        console.error('Error fetching getPaymentQouteByLighteningURL:', error);
        throw error;
    }
};

export const getOnChainTiers = async (data: any) => {
    const idempotencyKey = uuidv4();
    try {
        const response = await fetch(`${BASE_URL}/payment-quotes/onchain/tiers`, await withAuthToken({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'idempotency-key': idempotencyKey
            },
            body: JSON.stringify(data),
        }));
if (__DEV__) console.log('response: ', response)
        const responseJSON = await response.json();
        if(responseJSON?.data && responseJSON?.data?.status === 401){
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT)
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error fetching getOnChainTiers:', error);
        throw error;
    }
};

export const getPaymentQouteByOnChain = async (data: any, paymentQouteID: string) => {
    const idempotencyKey = uuidv4();
if (__DEV__) console.log('idempotencyKey: ', idempotencyKey)
    try {
        // const response = await fetch(`${BASE_URL}/payment-quotes/onchain`, await withAuthToken({
        //     method: 'POST',
        //     headers: {
        //         'Content-Type': 'application/json',
        //         'idempotency-key': idempotencyKey
        //     },
        //     body: JSON.stringify(data),
        // }));
        // console.log('response: ', response)
        // const responseJSON = await response.json();
        // console.log('responseJSON: ', responseJSON)
        // const paymentQouteID = responseJSON.paymentQuoteId;
        const responsePayment = await fetch(`${BASE_URL}/payment-quotes/${paymentQouteID}/execute`, await withAuthToken({
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        const responsePaymentJSON = await responsePayment.json();
        if(responsePaymentJSON?.data && responsePaymentJSON?.data?.status === 401){
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT)
            useAuthStore.getState().clearStrikeAuth();
        }
        return responsePaymentJSON;
    } catch (error) {
        console.error('Error fetching getPaymentQouteByOnChain:', error);
        throw error;
    }
};

export const getInvoices = async () => {
    try {
        const response = await fetch(`${BASE_URL}/invoices`, await withAuthToken({
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        const responseJSON = await response.json();
        if(responseJSON?.data && responseJSON?.data?.status === 401){
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT)
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error fetching invoices by strike:', error);
        throw error;
    }
};

/**
 * Poll Strike for the terminal state of a Lightning payment that came back
 * from `/payment-quotes/{id}/execute` as `PENDING`. The execute endpoint
 * returns immediately once Strike accepts the invoice into its routing
 * queue — the payment then takes a few seconds to settle on the Lightning
 * network. Callers that need a definitive success/failure signal must poll
 * `GET /payments/{paymentId}` until the state transitions to one of:
 *   - `COMPLETED` → settled, funds left Strike
 *   - `FAILED`    → LN routing gave up; funds returned to Strike balance
 *   - `REVERSED`  → settled then refunded (rare; treat as failure)
 *
 * Polls every `intervalMs` for at most `timeoutMs`. Returns the final
 * payment record; caller decides how to react to the terminal state.
 * If the timeout elapses while still PENDING/NEW, returns the last
 * observed record with state intact — caller can decide whether to
 * treat that as a soft failure or keep waiting in the background.
 *
 * Why polling and not webhooks: Strike's webhook delivery requires a
 * public HTTPS endpoint we don't have for the mobile client. Polling
 * is the canonical approach for mobile-only Strike integrations.
 */
export const getStrikePaymentStatus = async (paymentId: string): Promise<any> => {
    try {
        const response = await fetch(`${BASE_URL}/payments/${paymentId}`, await withAuthToken({
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        }));
        if (response.status === 401) {
            useAuthStore.getState().clearStrikeAuth();
            throw new Error('Strike session expired — please log into Strike again.');
        }
        if (!response.ok) {
            let body = '';
            try { body = await response.text(); } catch { /* ignore */ }
            throw new Error(
                `Strike payment-status error: ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`,
            );
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching Strike payment status:', error);
        throw error;
    }
};

export const pollStrikePaymentUntilTerminal = async (
    paymentId: string,
    opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<any> => {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const intervalMs = opts.intervalMs ?? 1_000;
    const start = Date.now();
    let last: any = null;
    while (Date.now() - start < timeoutMs) {
        last = await getStrikePaymentStatus(paymentId);
        const state = String(last?.state ?? '').toUpperCase();
        if (__DEV__) {
            console.log('[Strike] poll payment', paymentId.slice(0, 8), 'state=', state);
        }
        if (state === 'COMPLETED' || state === 'FAILED' || state === 'REVERSED') {
            return last;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    if (__DEV__) {
        console.log('[Strike] poll payment', paymentId.slice(0, 8), 'TIMEOUT after', timeoutMs, 'ms; last state=', last?.state);
    }
    return last;
};

// ===== Account Profile & Limits =====

export const getStrikeProfile = async () => {
    try {
        const response = await fetch(`${BASE_URL}/accounts/profile`, await withAuthToken({
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        const responseJSON = await response.json();
        if (responseJSON?.data?.status === 401) {
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT);
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error fetching Strike profile:', error);
        throw error;
    }
};

export const getStrikeLimits = async () => {
    try {
        const response = await fetch(`${BASE_URL}/accounts/limits`, await withAuthToken({
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        const responseJSON = await response.json();
        if (responseJSON?.data?.status === 401) {
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT);
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error fetching Strike limits:', error);
        throw error;
    }
};

// ===== Bank Payment Methods =====

export const getBankPaymentMethods = async () => {
    try {
        const response = await fetch(`${BASE_URL}/payment-methods/bank`, await withAuthToken({
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        const responseJSON = await response.json();
        if (responseJSON?.data?.status === 401) {
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT);
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error fetching bank payment methods:', error);
        throw error;
    }
};

// ===== Fiat Deposits =====

export const estimateDepositFee = async (amount: string, paymentMethodId: string) => {
    try {
        const response = await fetch(`${BASE_URL}/deposits/fee`, await withAuthToken({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ amount, paymentMethodId }),
        }));
        const responseJSON = await response.json();
        if (responseJSON?.data?.status === 401) {
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT);
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error estimating deposit fee:', error);
        throw error;
    }
};

export const initiateDeposit = async (amount: string, paymentMethodId: string) => {
    const idempotencyKey = uuidv4();
    try {
        const response = await fetch(`${BASE_URL}/deposits`, await withAuthToken({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'idempotency-key': idempotencyKey,
            },
            body: JSON.stringify({ amount, paymentMethodId }),
        }));
        const responseJSON = await response.json();
        if (responseJSON?.data?.status === 401) {
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT);
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error initiating deposit:', error);
        throw error;
    }
};

export const getDeposits = async () => {
    try {
        const response = await fetch(`${BASE_URL}/deposits`, await withAuthToken({
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        const responseJSON = await response.json();
        if (responseJSON?.data?.status === 401) {
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT);
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error fetching deposits:', error);
        throw error;
    }
};

// ===== Fiat Withdrawals (Payouts) =====

export const createPayout = async (amount: string, paymentMethodId: string) => {
    try {
        const response = await fetch(`${BASE_URL}/payouts`, await withAuthToken({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ amount, paymentMethodId }),
        }));
        const responseJSON = await response.json();
        if (responseJSON?.data?.status === 401) {
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT);
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error creating payout:', error);
        throw error;
    }
};

export const initiatePayout = async (payoutId: string) => {
    try {
        const response = await fetch(`${BASE_URL}/payouts/${payoutId}/initiate`, await withAuthToken({
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        const responseJSON = await response.json();
        if (responseJSON?.data?.status === 401) {
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT);
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error initiating payout:', error);
        throw error;
    }
};

export const getPayouts = async () => {
    try {
        const response = await fetch(`${BASE_URL}/payouts`, await withAuthToken({
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        const responseJSON = await response.json();
        if (responseJSON?.data?.status === 401) {
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT);
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error fetching payouts:', error);
        throw error;
    }
};

export const getInvoicesByID = async (id: string) => {
    try {
        const response = await fetch(`${BASE_URL}/invoices/${id}`, await withAuthToken({
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }));
        const responseJSON = await response.json();
        if(responseJSON?.data && responseJSON?.data?.status === 401){
            SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT)
            useAuthStore.getState().clearStrikeAuth();
        }
        return responseJSON;
    } catch (error) {
        console.error('Error fetching invoices by strike:', error);
        throw error;
    }
};