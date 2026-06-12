import useAuthStore from '@Cypher/stores/authStore';
import { Platform } from 'react-native';
import { triggerPaymentNotification } from '@Cypher/components/PaymentNotification';
import { recordEvent } from '@Cypher/stores/eventLogStore';

// Connect to our relay instead of directly to CoinOS (Cloudflare blocks direct WS)
const RELAY_WS_URL = 'wss://notifications.cypherbox.io:3003';
const { coinosRelayUri } = require('../../blue_modules/constants');
// RELAY_API_KEY lives in a gitignored secrets module so it never enters
// repo history. Bootstrap with `cp blue_modules/secrets.example.ts
// blue_modules/secrets.ts` on a fresh checkout.
const { RELAY_API_KEY } = require('../../blue_modules/secrets');

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
if (__DEV__) console.log('[CoinOS WS] Sending login for', _username);
    send('login', { username: _username, coinosToken: token });
  } else if (!_username) {
    console.warn('[CoinOS WS] Cannot authenticate - username not set');
  }
};

const handleMessage = (event: WebSocketMessageEvent) => {
  try {
    const { type, data } = JSON.parse(event.data);
if (__DEV__) console.log('[CoinOS WS] Message:', type, data);

    switch (type) {
      case 'authenticated':
if (__DEV__) console.log('[CoinOS WS] Authenticated with relay as', data?.username);
        reconnectDelay = 1000;
        break;

      case 'payment':
        if (data && typeof data.amount === 'number' && data.amount > 0) {
if (__DEV__) console.log('[CoinOS WS] Payment received:', data.amount, 'sats');

          // Show in-app banner
          triggerPaymentNotification(data.amount, data.confirmed, 'coinos', 'CoinOS');

          // Activity log: only emit on confirmed=true to avoid double-
          // counting the unconfirmed → confirmed transition for the
          // same invoice. Iid is intentionally NOT logged (privacy).
          if (data.confirmed) {
            recordEvent({ kind: 'ln-received', wallet: 'coinos', sats: data.amount });
          }

          if (onPaymentReceived) {
            onPaymentReceived(data);
          }
        } else if (data) {
          console.warn('[CoinOS WS] Invalid payment amount:', data.amount);
        }
        break;

      case 'id':
if (__DEV__) console.log('[CoinOS WS] Session ID:', data);
        break;

      case 'logout':
if (__DEV__) console.log('[CoinOS WS] Server requested logout');
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

if (__DEV__) console.log(`[CoinOS WS] Reconnecting in ${reconnectDelay}ms...`);
  reconnectTimer = setTimeout(() => {
    connect();
  }, reconnectDelay);

  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
};

export const connect = () => {
  const token = useAuthStore.getState().token;
  if (!token) {
if (__DEV__) console.log('[CoinOS WS] No token, skipping connect');
    return;
  }

  // Already connected
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
if (__DEV__) console.log('[CoinOS WS] Already connected/connecting');
    return;
  }

  intentionalClose = false;
if (__DEV__) console.log('[CoinOS WS] Connecting to relay', RELAY_WS_URL);

  try {
    socket = new WebSocket(RELAY_WS_URL);

    socket.onopen = () => {
if (__DEV__) console.log('[CoinOS WS] Socket opened, authenticating...');
      auth();
    };

    socket.onmessage = handleMessage;

    socket.onclose = (e) => {
if (__DEV__) console.log('[CoinOS WS] Socket closed:', e.code, e.reason);
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
if (__DEV__) console.log('[CoinOS WS] Disconnecting');
    socket.close();
    socket = null;
  }
};

export const isConnected = () => socket?.readyState === WebSocket.OPEN;

// Register push token with CoinOS relay for background notifications
export const registerPushToken = async (username: string, pushToken: string) => {
  const token = useAuthStore.getState().token;
  if (!token) {
if (__DEV__) console.log('[CoinOS Relay] Missing token for push registration');
    return;
  }
  if (!username) {
if (__DEV__) console.log('[CoinOS Relay] Missing username for push registration');
    return;
  }
  if (!pushToken) {
if (__DEV__) console.log('[CoinOS Relay] Missing push token for push registration');
    return;
  }
  if (!coinosRelayUri) {
if (__DEV__) console.log('[CoinOS Relay] Missing relay URI for push registration');
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
if (__DEV__) console.log('[CoinOS Relay] Push registration:', result);
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
if (__DEV__) console.log('[CoinOS Relay] Push unregistered');
  } catch (e) {
    console.warn('[CoinOS Relay] Push unregister failed:', e);
  }
};

/**
 * Toggle the per-device Ark refresh opt-in on the relay. Called from
 * setArkBackgroundRefreshEnabled when the user flips the toggle.
 *
 * The relay's silent-push scanner only targets devices with
 * ark_refresh_opt_in = 1, so this call is the gating signal — without
 * it, the client may have written its background-readable seed locally
 * but the relay won't ever wake the device via push.
 *
 * Failure does not block the toggle from succeeding. Scheduled wakes
 * (BGProcessingTask / WorkManager) still fire either way; the silent
 * push is the safety-net path.
 */
export const setArkRefreshSubscription = async (
  username: string,
  pushToken: string,
  optIn: boolean,
): Promise<boolean> => {
  if (!username || !pushToken || !coinosRelayUri) return false;
  try {
    const response = await fetch(`${coinosRelayUri}/ark-refresh/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': RELAY_API_KEY },
      body: JSON.stringify({ username, pushToken, optIn }),
    });
    if (__DEV__) console.log('[CoinOS Relay] ark-refresh/subscribe', { optIn, status: response.status });
    return response.ok;
  } catch (e) {
    console.warn('[CoinOS Relay] ark-refresh/subscribe failed:', e);
    return false;
  }
};

/**
 * Fire-and-forget. Tells the relay the unix-seconds at which the
 * soonest-expiring spendable VTXO will become unrecoverable, so its
 * scanner can decide when to fire a silent push wake. `null` means
 * the wallet currently has no spendable VTXOs whose expiry is
 * computable (or no spendable VTXOs at all) — the relay should
 * suppress pushes for the device until a non-null value lands.
 *
 * Called from useArkSync after each successful foreground sync.
 * Errors are swallowed; the next sync (30s later) retries.
 */
export const postArkRefreshExpiry = async (
  username: string,
  soonestExpiryAt: number | null,
): Promise<void> => {
  if (!username || !coinosRelayUri) return;
  try {
    await fetch(`${coinosRelayUri}/ark-refresh/expiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': RELAY_API_KEY },
      body: JSON.stringify({ username, soonestExpiryAt }),
    });
  } catch (e) {
    if (__DEV__) console.log('[CoinOS Relay] ark-refresh/expiry failed (will retry next sync):', (e as Error)?.message);
  }
};
