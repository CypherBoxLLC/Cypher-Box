import { Alert } from 'react-native';
import loc from '../loc';
const alert = (text: string) => {
  // An explicit button, so it follows the app language rather than the phone's.
  Alert.alert(loc.alert.default, text, [{ text: loc._.ok }]);
};
export default alert;
