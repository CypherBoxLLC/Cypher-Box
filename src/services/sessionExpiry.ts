import SimpleToast from 'react-native-simple-toast';
import useAuthStore from '@Cypher/stores/authStore';
import { isCoinosAllowed, isStrikeAllowed } from './featureFlags';
import loc from '../../loc';

/*
 * A Strike or CoinOS session that has expired (a 401 from the service).
 *
 * Where the app offers the service, the account is signed out and the user can sign in again, as before. Where the
 * region gate hides it, sign-in is hidden too, so signing out made the card and its balance vanish from the app with
 * no way back. There the account stays connected instead: the card keeps its last balance and the notice that points
 * to the Strike app or coinos.io, and no toast repeats on every refresh. If the gate opens again (the iOS storefront
 * resolving late, for one), the next 401 signs out as usual.
 */

/** `message`: the toast to show when signing out; null for none. */
export function expireStrikeSession(message: string | null = loc.cypherbox.services.strike_api.authorization_expired): void {
    if (!isStrikeAllowed()) return;
    if (message) SimpleToast.show(message, SimpleToast.SHORT);
    useAuthStore.getState().clearStrikeAuth();
}

/** `message`: the toast to show when signing out; null for none. */
export function expireCoinosSession(message: string | null = loc.cypherbox.services.coinos_api.authorization_expired): void {
    if (!isCoinosAllowed()) return;
    if (message) SimpleToast.show(message, SimpleToast.SHORT);
    useAuthStore.getState().clearAuth();
}
