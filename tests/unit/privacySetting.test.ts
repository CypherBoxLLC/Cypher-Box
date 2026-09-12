import { isPrivacyBlurOn, setPrivacyBlurMasterSwitch } from '../../blue_modules/privacySetting';

describe('privacySetting master switch', () => {
  // Default is OFF by product decision (2026-09-12): users back up seed
  // phrases by screenshotting them, and UI bug reports need screenshots.
  // Android's only blur mechanism is FLAG_SECURE, which blocks screenshots as
  // a side effect, so the shield stays off unless enabled in Settings.
  it('defaults to off so screenshots keep working', () => {
    expect(isPrivacyBlurOn()).toBe(false);
  });

  it('reflects updates from the <Privacy/> sync effect', () => {
    setPrivacyBlurMasterSwitch(false);
    expect(isPrivacyBlurOn()).toBe(false);
    setPrivacyBlurMasterSwitch(true);
    expect(isPrivacyBlurOn()).toBe(true);
  });
});
