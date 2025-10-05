import React, { useContext } from 'react';
// @ts-ignore: react-native-handoff is not in the type definition
import Handoff from 'react-native-handoff';
import { BlueStorageContext } from '../blue_modules/storage-context';

interface HandoffComponentProps {
  url?: string;
}

interface HandoffComponentWithActivityTypes extends React.FC<HandoffComponentProps> {
  activityTypes: {
    ReceiveOnchain: string;
    Xpub: string;
    ViewInBlockExplorer: string;
  };
}

const HandoffComponent: HandoffComponentWithActivityTypes = props => {
  const { isHandOffUseEnabled } = useContext(BlueStorageContext);

  if (isHandOffUseEnabled) {
    return <Handoff {...props} />;
  }
  return null;
};

const activityTypes = {
  ReceiveOnchain: 'io.cypherbox.btc.receiveonchain',
  Xpub: 'io.cypherbox.btc.xpub',
  ViewInBlockExplorer: 'io.cypherbox.btc.blockexplorer',
};

HandoffComponent.activityTypes = activityTypes;

export default HandoffComponent;
