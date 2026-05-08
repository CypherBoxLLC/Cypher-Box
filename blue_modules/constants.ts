/**
 * Let's keep config vars, constants and definitions here
 */

// export const groundControlUri: string = 'https://groundcontrol-bluewallet.herokuapp.com/';
export const groundControlUri: string = 'https://notifications.cypherbox.io/';
export const coinosRelayUri: string = 'https://notifications.cypherbox.io:3002';
// RELAY_API_KEY moved to blue_modules/secrets.ts (gitignored). The previous
// hardcoded value here was leaked in public git history and rotated on the
// VPS — see blue_modules/secrets.example.ts for the new layout.
