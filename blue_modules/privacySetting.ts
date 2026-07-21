/**
 * Module-level master switch for the screen-capture shield (FLAG_SECURE on
 * Android, privacy-snapshot on iOS).
 *
 * The <Privacy/> component (mounted once in App.js) syncs this from
 * BlueStorageContext. The platform Privacy components' static
 * enableBlur/disableBlur helpers read it, so screens can opt into the shield
 * on focus without threading context through every call site.
 */
let privacyBlurMasterSwitch = true;

export function setPrivacyBlurMasterSwitch(value: boolean): void {
  privacyBlurMasterSwitch = value;
}

export function isPrivacyBlurOn(): boolean {
  return privacyBlurMasterSwitch;
}
