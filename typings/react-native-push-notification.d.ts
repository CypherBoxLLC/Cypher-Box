// Minimal ambient module shim for react-native-push-notification 8.1.1.
//
// We only use a small slice of its surface (configure, requestPermissions,
// localNotification, createChannel) and the upstream @types package isn't
// installed in this project. Matches the existing pattern in this typings/
// folder (see react-native-prompt-android.d.ts) — light-touch declarations
// that unblock tsc without committing to a full type model.

declare module 'react-native-push-notification' {
    type Importance = 'default' | 'low' | 'high' | 'max' | 'min' | number;
    type Priority = 'default' | 'low' | 'high' | 'max' | 'min';

    interface ConfigureOptions {
        onRegister?: (token: { os: string; token: string }) => void;
        onNotification?: (notification: any) => void;
        onAction?: (notification: any) => void;
        onRegistrationError?: (err: { message: string; code?: number }) => void;
        permissions?: { alert?: boolean; badge?: boolean; sound?: boolean };
        popInitialNotification?: boolean;
        requestPermissions?: boolean;
    }

    interface ChannelObject {
        channelId: string;
        channelName: string;
        channelDescription?: string;
        playSound?: boolean;
        soundName?: string;
        importance?: Importance;
        vibrate?: boolean;
    }

    interface LocalNotification {
        channelId?: string;
        title?: string;
        message: string;
        priority?: Priority;
        importance?: Importance;
        userInfo?: Record<string, any>;
        playSound?: boolean;
        soundName?: string;
        smallIcon?: string;
        largeIcon?: string;
        data?: Record<string, any>;
    }

    interface PermissionsResponse {
        alert?: boolean;
        badge?: boolean;
        sound?: boolean;
    }

    interface PushNotificationStatic {
        configure(options: ConfigureOptions): void;
        localNotification(notification: LocalNotification): void;
        createChannel(channel: ChannelObject, callback: (created: boolean) => void): void;
        requestPermissions(permissions?: Array<'alert' | 'badge' | 'sound'>): Promise<PermissionsResponse>;
        cancelAllLocalNotifications(): void;
        removeAllDeliveredNotifications(): void;
    }

    const PushNotification: PushNotificationStatic;
    export default PushNotification;
}
