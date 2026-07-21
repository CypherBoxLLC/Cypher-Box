import { isPrivacyBlurOn, setPrivacyBlurMasterSwitch } from '../../blue_modules/privacySetting';

describe('privacySetting master switch', () => {
  it('defaults to on', () => {
    expect(isPrivacyBlurOn()).toBe(true);
  });

  it('reflects updates from the <Privacy/> sync effect', () => {
    setPrivacyBlurMasterSwitch(false);
    expect(isPrivacyBlurOn()).toBe(false);
    setPrivacyBlurMasterSwitch(true);
    expect(isPrivacyBlurOn()).toBe(true);
  });
});
