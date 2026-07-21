import { useContext, useEffect } from 'react';
// @ts-ignore: react-native-obscure is not in the type definition
import Obscure from 'react-native-obscure';
import { BlueStorageContext } from './storage-context';
import { isPrivacyBlurOn, setPrivacyBlurMasterSwitch } from './privacySetting';

interface PrivacyComponent extends React.FC {
  enableBlur: () => void;
  disableBlur: () => void;
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

export default Privacy;
