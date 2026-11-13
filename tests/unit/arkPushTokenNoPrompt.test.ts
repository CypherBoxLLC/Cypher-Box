/**
 * Bark create must not show the OS notification dialog.
 *
 * `ensurePushTokenForArk({ prompt: false })` is how the create flow, and the
 * Home backfill that runs underneath it, mint the push token for the capsule
 * wake. While the permission is undecided it must not reach
 * requestNotifications(): that call IS the OS dialog. It used to fire during
 * create, before the "Bark Vault Created" screen had explained reminders.
 * 611dc6a stopped the explicit permission request there and missed this one,
 * and nothing failed when it did. That screen asks in its own words and mints
 * after a "Yes", through this same no-prompt path.
 */

jest.mock('react-native-permissions', () => ({
    checkNotifications: jest.fn(),
    requestNotifications: jest.fn(),
}));
jest.mock('react-native-push-notification', () => ({
    configure: jest.fn(),
    setApplicationIconBadgeNumber: jest.fn(),
    removeAllDeliveredNotifications: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const TOKEN = { os: 'ios', token: 'test-token' };

function load(status: string) {
    jest.resetModules();
    const permissions = require('react-native-permissions');
    const PushNotification = require('react-native-push-notification');
    permissions.checkNotifications.mockResolvedValue({ status, settings: {} });
    permissions.requestNotifications.mockResolvedValue({ status: 'granted', settings: {} });
    // A configured app gets its token back straight away.
    PushNotification.configure.mockImplementation((opts: any) => {
        void opts.onRegister?.(TOKEN);
    });
    const Notifications = require('../../blue_modules/notifications').default;
    Notifications({});
    return { Notifications, permissions, PushNotification };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('ensurePushTokenForArk({ prompt: false })', () => {
    it.each(['denied', 'blocked', 'limited', 'unavailable'])(
        'does not ask while the permission is %s',
        async (status) => {
            const { Notifications, permissions, PushNotification } = load(status);
            await expect(Notifications.ensurePushTokenForArk({ prompt: false })).resolves.toBe(false);
            expect(permissions.requestNotifications).not.toHaveBeenCalled();
            expect(PushNotification.configure).not.toHaveBeenCalled();
        },
    );

    it('mints once the permission is granted', async () => {
        const { Notifications, PushNotification } = load('granted');
        await expect(Notifications.ensurePushTokenForArk({ prompt: false })).resolves.toBe(true);
        expect(PushNotification.configure).toHaveBeenCalledTimes(1);
        expect(await Notifications.getPushToken()).toEqual(TOKEN);
    });

    it('does not opt the device into onchain address uploads', async () => {
        const { Notifications } = load('granted');
        await Notifications.ensurePushTokenForArk({ prompt: false });
        expect(await Notifications.isOnchainSubscriptionEnabled()).toBe(false);
    });

    it('shares one mint between the created screen and the Home backfill', async () => {
        const { Notifications, PushNotification } = load('granted');
        let register: (token: unknown) => unknown = () => undefined;
        PushNotification.configure.mockImplementation((opts: any) => {
            register = opts.onRegister;
        });
        const first = Notifications.ensurePushTokenForArk({ prompt: false });
        const second = Notifications.ensurePushTokenForArk({ prompt: false });
        for (let i = 0; i < 20 && PushNotification.configure.mock.calls.length === 0; i++) await tick();
        for (let i = 0; i < 5; i++) await tick();
        await register(TOKEN);
        await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
        expect(PushNotification.configure).toHaveBeenCalledTimes(1);
    });
});

describe('ensurePushTokenForArk() with the default prompt', () => {
    it('still asks, for the reminders toggle in Settings', async () => {
        const { Notifications, permissions } = load('denied');
        await expect(Notifications.ensurePushTokenForArk()).resolves.toBe(true);
        expect(permissions.requestNotifications).toHaveBeenCalledTimes(1);
    });
});
