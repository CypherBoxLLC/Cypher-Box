import {useEffect} from 'react';
import {BackHandler} from 'react-native';

/**
 * Custom React hook that disables Android Hardware back button
 */
export default function useDisableAndroidBackButton() {
  const doNothing = () => true;

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', doNothing);

    return () => {
      subscription.remove();
    };
  }, []);
}
