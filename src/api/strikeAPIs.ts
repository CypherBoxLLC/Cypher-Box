import useAuthStore from '@Cypher/stores/authStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SimpleToast from "react-native-simple-toast";
import { v4 as uuidv4 } from 'uuid';

const BASE_URL = 'https://api.strike.me/v1';

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
      body: JSON.stringify({ onchain: {} }),
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
    const quoteData: any = { invoice };
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
      throw new Error(`Strike quote error: ${quoteResponse.status}`);
    }
    
    const quoteDataResponse = await quoteResponse.json();
    const paymentQuoteId = quoteDataResponse.paymentQuoteId;
if (__DEV__) console.log('Lightning payment quote ID:', paymentQuoteId);
    
    // Step 2: Execute the Lightning payment
    const executeResponse = await fetch(`${BASE_URL}/payment-quotes/${paymentQuoteId}/execute`, await withAuthToken({
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
    }));
    
    if (!executeResponse.ok) {
      throw new Error(`Strike execute error: ${executeResponse.status}`);
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