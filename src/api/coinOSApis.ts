import useAuthStore from '@Cypher/stores/authStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SimpleToast from "react-native-simple-toast";

const BASE_URL = 'https://coinos.io/api';
const getAuthToken = async () => {
  try {
    return await AsyncStorage.getItem('authToken');
  } catch (error) {
    console.error('Error getting auth token from AsyncStorage:', error);
    throw error;
  }
};

const withAuthToken = async (requestConfig: any) => {
  // const authToken = await getAuthToken();
  const authToken = useAuthStore.getState().token;
  if (!authToken) {
    throw new Error('Auth token not found in AsyncStorage');
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
    console.log('payload:', payload)
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

export const loginUser = async (username: string, password: string) => {
  try {
    const payload = {
        username,
        password
    }
    console.log('payload: ', payload)
    const response = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    console.log('response: ', response)
    return await response.json();
  } catch (error) {
    console.error('Error logging in user:', error);
    throw error;
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
  try {
    console.log('sendLightningPayment payload: ', amount, amount && amount !== '' && amount !== 0 ? { payreq: payreq, memo: memo, amount } : { payreq: payreq, memo: memo })
    const response = await fetch(`${BASE_URL}/payments`, await withAuthToken({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(amount && amount !== '' && amount !== 0 ? { payreq: payreq, memo: memo, amount } : { payreq: payreq, memo: memo }),
    }));

    console.log('response: ', response)
    const responseJSON = await response.text();
    console.log('responseJSON: ', responseJSON)
    return responseJSON;
  } catch (error) {
    console.error('Error sending lightning payment:', error);
    throw error;
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
    console.log('sendCoinsViaLNURL response: ', response)
    const lnurlPayData = await response.json();
    console.log('sendCoinsViaLNURL lnurlPayData: ', lnurlPayData)

    if (lnurlPayData.tag === "payRequest") {
      const paymentResponse = await fetch(lnurlPayData.callback+'?amount='+(amount * 1000), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      console.log('sendCoinsViaLNURL paymentResponse: ', paymentResponse)

      const paymentResult = await paymentResponse.json();
      console.log('sendCoinsViaLNURL paymentResult: ', paymentResult)
      if(paymentResult.pr){
        console.log('domain: ', domain)
        if(domain == 'coinos.io'){
          const response = await fetch(`${BASE_URL}/payments`, await withAuthToken({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ amount: amount, hash: paymentResult.pr }),
          }));
      
          console.log('response: ', response)
          const responseJSON = await response.json();
          console.log('responseJSON: ', responseJSON)
          return responseJSON;
        } else {
          const sendToUser = await sendLightningPayment(paymentResult.pr, memo, amount)

          console.log('sendToUser: ' ,sendToUser)
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
    console.log('response: ', response?.status)
    if(response?.status === 401){
      SimpleToast.show("Authorization expired. Please login again to continue", SimpleToast.SHORT)
      useAuthStore.getState().clearAuth();
    }
    const result = await response.json()
    console.log('result: ', result)
    return result;
  } catch (error) {
    console.error('Error getting me:', error);
    throw error;
  }
};

export const getCurrencyRates = async () => {
  try {
    const response = await fetch(`${BASE_URL}/rates`, await withAuthToken({
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }));
    return await response.json();
  } catch (error) {
    console.error('Error getting Rates:', error);
    throw error;
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