/**
 * Module-level master switch for the screen-capture shield (FLAG_SECURE on
 * Android, privacy-snapshot on iOS).
 *
 * The <Privacy/> component (mounted once in App.js) syncs this from
 * BlueStorageContext. The platform Privacy components' static
 * enableBlur/disableBlur helpers read it, so screens can opt into the shield
 * on focus without threading context through every call site.
 */
// Default OFF: screenshots must work. Users back up seed phrases by
// screenshotting them, and UI bug reports need screenshots. Android's only
// blur mechanism is FLAG_SECURE, which blocks screenshots as a side effect,
// so the shield stays off unless a user turns it on in Settings > Privacy.
let privacyBlurMasterSwitch = false;

export function setPrivacyBlurMasterSwitch(value: boolean): void {
  privacyBlurMasterSwitch = value;
}

export function isPrivacyBlurOn(): boolean {
  return privacyBlurMasterSwitch;
}

/**
 * Screens currently showing a recovery phrase (or a SeedQR, or a key made from one). They are protected whatever
 * the setting above says: the app-switcher preview is hidden, and on Android screenshots are blocked. Counted, so a
 * secret screen opened over another one doesn't drop the protection when it closes.
 */
let secretScreens = 0;

/** Returns true when this is the first secret screen, i.e. protection has to be switched on. */
export function addSecretScreen(): boolean {
  secretScreens += 1;
  return secretScreens === 1;
}

/** Returns true when no secret screen is left, i.e. protection can go back to what the setting says. */
export function removeSecretScreen(): boolean {
  secretScreens = Math.max(0, secretScreens - 1);
  return secretScreens === 0;
}
