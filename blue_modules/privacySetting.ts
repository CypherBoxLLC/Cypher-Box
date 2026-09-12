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
