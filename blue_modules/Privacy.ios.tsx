import { useContext, useEffect } from 'react';
// @ts-ignore: react-native-obscure is not in the type definition
import { enabled } from 'react-native-privacy-snapshot';
import { BlueStorageContext } from './storage-context';
import { isPrivacyBlurOn, setPrivacyBlurMasterSwitch } from './privacySetting';

interface PrivacyComponent extends React.FC {
  enableBlur: () => void;
  disableBlur: () => void;
  // Lighter variant for seed-backup screens: keeps the app-switcher blur but
  // does not block screenshots, so users can screenshot their seed to back it up.
  enableBlurAllowingScreenshots: () => void;
  disableBlurAllowingScreenshots: () => void;
}

const Privacy: PrivacyComponent = () => {
  const { isPrivacyBlurEnabled } = useContext(BlueStorageContext);

  useEffect(() => {
    setPrivacyBlurMasterSwitch(isPrivacyBlurEnabled);
    if (!isPrivacyBlurEnabled) {
      // Turning the setting off must take effect immediately. Turning it on
      // does not force-activate globally: screens opt in on focus via
      // Privacy.enableBlur().
      Privacy.disableBlur();
    }
  }, [isPrivacyBlurEnabled]);

  return null;
};

Privacy.enableBlur = () => {
  if (!isPrivacyBlurOn()) return;
  enabled(true);
};

Privacy.disableBlur = () => {
  enabled(false);
};

// On iOS enableBlur only blurs the app-switcher snapshot; it never blocked
// screenshots (iOS exposes no such API). So the screenshot-allowing variant is
// identical to enableBlur, keeping the app-switcher blur on seed-backup screens.
Privacy.enableBlurAllowingScreenshots = () => {
  Privacy.enableBlur();
};

Privacy.disableBlurAllowingScreenshots = () => {
  Privacy.disableBlur();
};

export default Privacy;
