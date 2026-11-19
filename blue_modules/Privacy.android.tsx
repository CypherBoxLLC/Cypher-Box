import { useContext, useEffect } from 'react';
// @ts-ignore: react-native-obscure is not in the type definition
import Obscure from 'react-native-obscure';
import { BlueStorageContext } from './storage-context';
import { addSecretScreen, isPrivacyBlurOn, removeSecretScreen, setPrivacyBlurMasterSwitch } from './privacySetting';

interface PrivacyComponent extends React.FC {
  enableBlur: () => void;
  disableBlur: () => void;
  // Lighter variant for seed-backup screens: keeps the app-switcher blur but
  // does not block screenshots, so users can screenshot their seed to back it up.
  enableBlurAllowingScreenshots: () => void;
  disableBlurAllowingScreenshots: () => void;
  // Screens showing a recovery phrase or a SeedQR: always protected, whatever the privacy setting.
  protectSecret: () => void;
  releaseSecret: () => void;
}

const Privacy: PrivacyComponent = () => {
  const { isPrivacyBlurEnabled } = useContext(BlueStorageContext);

  useEffect(() => {
    setPrivacyBlurMasterSwitch(isPrivacyBlurEnabled);
    if (!isPrivacyBlurEnabled) {
      // Turning the setting off must take effect immediately. Turning it on
      // does not force-activate globally: screens opt in on focus via
      // Privacy.enableBlur().
      Obscure.deactivateObscure();
    }
  }, [isPrivacyBlurEnabled]);

  return null;
};

Privacy.enableBlur = () => {
  if (!isPrivacyBlurOn()) return;
  Obscure.activateObscure();
};

Privacy.disableBlur = () => {
  Obscure.deactivateObscure();
};

// Seed-backup screens: the user should be able to screenshot their seed to
// back it up. Android's only blur mechanism is FLAG_SECURE (Obscure), which
// ALSO blocks screenshots, so there is no way to hide the app-switcher preview
// without blocking the backup screenshot. Ensure it is off here (a prior screen
// may have set it) and do not re-enable it.
Privacy.enableBlurAllowingScreenshots = () => {
  Obscure.deactivateObscure();
};

Privacy.disableBlurAllowingScreenshots = () => {};

// FLAG_SECURE: hides the app-switcher preview and blocks screenshots and screen recording.
Privacy.protectSecret = () => {
  if (addSecretScreen()) Obscure.activateObscure();
};

Privacy.releaseSecret = () => {
  if (removeSecretScreen() && !isPrivacyBlurOn()) Obscure.deactivateObscure();
};

export default Privacy;
