import useAuthStore from '@Cypher/stores/authStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SimpleToast from "react-native-simple-toast";
import { v4 as uuidv4 } from 'uuid';

const BASE_URL = 'https://api.strike.me/v1';

const withAuthToken = async (requestConfig: any) => {
    const authToken = useAuthStore.getState().strikeToken;
    if (!authToken) {
        throw new Error('Auth token not found in AsyncStorage');
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
        return await response.json();
    } catch (error) {
        console.error('Error fetching balances by strike:', error);
        throw error;
    }
};

export const createInvoice = async (invoiceData: any) => {
  try {
    console.log('invoiceData: ', invoiceData)
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

export const getPaymentQoute = async (url: string, data: any) => {
        const idempotencyKey = uuidv4();
        console.log('idempotencyKey: ' ,idempotencyKey)
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
}

export const getPaymentQouteByLightening = async (data: any, paymentQouteID: string) => {
    const idempotencyKey = uuidv4();
    console.log('idempotencyKey: ', idempotencyKey)
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
        console.log('responsePaymentJSON: ', responsePaymentJSON)
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
    console.log('idempotencyKey: ', idempotencyKey)
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
        console.log('response: ', response)
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
    console.log('idempotencyKey: ', idempotencyKey)
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
        return await response.json();
    } catch (error) {
        console.error('Error fetching invoices by strike:', error);
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
        return await response.json();
    } catch (error) {
        console.error('Error fetching invoices by strike:', error);
        throw error;
    }
};