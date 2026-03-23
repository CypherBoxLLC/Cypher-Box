import useAuthStore from '@Cypher/stores/authStore';
import { Platform } from 'react-native';
import { triggerPaymentNotification } from '@Cypher/components/PaymentNotification';

// Connect to our relay instead of directly to CoinOS (Cloudflare blocks direct WS)
const RELAY_WS_URL = 'wss://notifications.cypherbox.io:3003';
const { coinosRelayUri, RELAY_API_KEY } = require('../../blue_modules/constants');

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 16000;
let intentionalClose = false;

type PaymentCallback = (data: { amount: number; confirmed: boolean; iid: string }) => void;
let onPaymentReceived: PaymentCallback | null = null;

export const setOnPaymentReceived = (cb: PaymentCallback | null) => {
  onPaymentReceived = cb;
};

const send = (type: string, data?: any) => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, data }));
  }
};

let _username: string | null = null;

export const setUsername = (username: string | null) => {
  _username = username;
};

const auth = () => {
  const token = useAuthStore.getState().token;
  if (token && _username) {
    console.log('[CoinOS WS] Sending login for', _username);
    send('login', { username: _username, coinosToken: token });
  } else if (!_username) {
    console.warn('[CoinOS WS] Cannot authenticate - username not set');
  }
};

const handleMessage = (event: WebSocketMessageEvent) => {
  try {
    const { type, data } = JSON.parse(event.data);
    console.log('[CoinOS WS] Message:', type, data);

    switch (type) {
      case 'authenticated':
        console.log('[CoinOS WS] Authenticated with relay as', data?.username);
        reconnectDelay = 1000;
        break;

      case 'payment':
        if (data && typeof data.amount === 'number' && data.amount > 0) {
          console.log('[CoinOS WS] Payment received:', data.amount, 'sats');

          // Show in-app banner
          triggerPaymentNotification(data.amount, data.confirmed, 'coinos', 'CoinOS');

          if (onPaymentReceived) {
            onPaymentReceived(data);
          }
        } else if (data) {
          console.warn('[CoinOS WS] Invalid payment amount:', data.amount);
        }
        break;

      case 'id':
        console.log('[CoinOS WS] Session ID:', data);
        break;

      case 'logout':
        console.log('[CoinOS WS] Server requested logout');
        disconnect();
        break;
    }
  } catch (e) {
    console.warn('[CoinOS WS] Failed to parse message:', e);
  }
};

const scheduleReconnect = () => {
  if (intentionalClose) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);

  console.log(`[CoinOS WS] Reconnecting in ${reconnectDelay}ms...`);
  reconnectTimer = setTimeout(() => {
    connect();
  }, reconnectDelay);

  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
};

export const connect = () => {
  const token = useAuthStore.getState().token;
  if (!token) {
    console.log('[CoinOS WS] No token, skipping connect');
    return;
  }

  // Already connected
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    console.log('[CoinOS WS] Already connected/connecting');
    return;
  }

  intentionalClose = false;
  console.log('[CoinOS WS] Connecting to relay', RELAY_WS_URL);

  try {
    socket = new WebSocket(RELAY_WS_URL);

    socket.onopen = () => {
      console.log('[CoinOS WS] Socket opened, authenticating...');
      auth();
    };

    socket.onmessage = handleMessage;

    socket.onclose = (e) => {
      console.log('[CoinOS WS] Socket closed:', e.code, e.reason);
      socket = null;
      scheduleReconnect();
    };

    socket.onerror = (e) => {
      console.warn('[CoinOS WS] Socket error:', e);
    };
  } catch (e) {
    console.error('[CoinOS WS] Failed to create socket:', e);
    scheduleReconnect();
  }
};

export const disconnect = () => {
  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    console.log('[CoinOS WS] Disconnecting');
    socket.close();
    socket = null;
  }
};

export const isConnected = () => socket?.readyState === WebSocket.OPEN;

// Register push token with CoinOS relay for background notifications
export const registerPushToken = async (username: string, pushToken: string) => {
  const token = useAuthStore.getState().token;
  if (!token) {
    console.log('[CoinOS Relay] Missing token for push registration');
    return;
  }
  if (!username) {
    console.log('[CoinOS Relay] Missing username for push registration');
    return;
  }
  if (!pushToken) {
    console.log('[CoinOS Relay] Missing push token for push registration');
    return;
  }
  if (!coinosRelayUri) {
    console.log('[CoinOS Relay] Missing relay URI for push registration');
    return;
  }

  try {
    const response = await fetch(`${coinosRelayUri}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': RELAY_API_KEY },
      body: JSON.stringify({
        username,
        coinosToken: token,
        pushToken,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      }),
    });
    const result = await response.json();
    console.log('[CoinOS Relay] Push registration:', result);
  } catch (e) {
    console.warn('[CoinOS Relay] Push registration failed:', e);
  }
};

export const unregisterPushToken = async (username: string, pushToken: string) => {
  if (!username || !pushToken || !coinosRelayUri) return;

  try {
    await fetch(`${coinosRelayUri}/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': RELAY_API_KEY },
      body: JSON.stringify({ username, pushToken }),
    });
    console.log('[CoinOS Relay] Push unregistered');
  } catch (e) {
    console.warn('[CoinOS Relay] Push unregister failed:', e);
  }
};
