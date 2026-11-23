/**
 * Google Drive backup on a phone without Google Play services (GrapheneOS and other Google-free Android builds).
 * Before, "Connect & save backup" let the sign-in library show Google's own dialog, "Cypher Box won't run without
 * Google Play services, which are not supported by your device", which is false, and then failed with a bare
 * "Play services not available". Now the option is known to be unavailable up front, the library is never asked (so
 * that dialog cannot appear), and the failure has a class and a sentence that says what to do instead.
 */

// The module under test is imported after the mocks below.
/* eslint-disable import/first */

const mockHasPlayServices = jest.fn();
const mockSignIn = jest.fn();

jest.mock('react-native', () => ({
    Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
}));
jest.mock('@react-native-google-signin/google-signin', () => ({
    GoogleSignin: {
        configure: jest.fn(),
        hasPlayServices: (...args: unknown[]) => mockHasPlayServices(...args),
        signIn: (...args: unknown[]) => mockSignIn(...args),
    },
}));
jest.mock('../../loc', () => ({
    __esModule: true,
    default: {
        cypherbox: {
            services: {
                google_drive: {
                    no_play_services: 'no play services: save to a folder instead',
                    auth_not_configured: 'not configured',
                    unknown: 'unknown',
                },
            },
        },
    },
}));
jest.mock('../../src/services/ark/backup', () => ({ peekBackupHeader: jest.fn() }));
jest.mock('../../src/services/ark/backupInstance', () => ({ buildArkBackupFilename: jest.fn() }));
jest.mock('../../src/services/ark/backupCandidates', () => ({ pickBestBackupCandidate: jest.fn() }));

import { hasGmsSync } from 'react-native-device-info';

import {
    classifyDriveError,
    connectGoogleDrive,
    isGoogleDriveAvailable,
    messageForDriveError,
} from '../../src/services/ark/googleDrive';

const gms = hasGmsSync as jest.Mock;

describe('Google Drive without Google Play services', () => {
    beforeEach(() => {
        mockHasPlayServices.mockReset();
        mockSignIn.mockReset();
    });

    it('is unavailable without Play services and available with them', () => {
        gms.mockReturnValue(false);
        expect(isGoogleDriveAvailable()).toBe(false);
        gms.mockReturnValue(true);
        expect(isGoogleDriveAvailable()).toBe(true);
    });

    it("classifies the library's code and its message, with a sentence that says what to do", () => {
        expect(classifyDriveError({ code: 'PLAY_SERVICES_NOT_AVAILABLE', message: 'Play services not available' })).toBe('no-play-services');
        expect(classifyDriveError(new Error('Play services not available'))).toBe('no-play-services');
        expect(messageForDriveError('no-play-services')).toBe('no play services: save to a folder instead');
    });

    it('never asks the sign-in library on a phone without Play services, so its dialog cannot appear', async () => {
        gms.mockReturnValue(false);
        await expect(connectGoogleDrive()).rejects.toMatchObject({
            code: 'PLAY_SERVICES_NOT_AVAILABLE',
            message: 'no play services: save to a folder instead',
        });
        expect(mockHasPlayServices).not.toHaveBeenCalled();
        expect(mockSignIn).not.toHaveBeenCalled();
    });

    it("with Play services present, asks the library without Google's update dialog and signs in", async () => {
        gms.mockReturnValue(true);
        mockHasPlayServices.mockResolvedValue(true);
        mockSignIn.mockResolvedValue({ type: 'success', data: {} });
        await expect(connectGoogleDrive()).resolves.toBe(true);
        expect(mockHasPlayServices).toHaveBeenCalledWith({ showPlayServicesUpdateDialog: false });
    });

    it('reports an outdated Play services through the same class instead of a dialog', async () => {
        gms.mockReturnValue(true);
        mockHasPlayServices.mockRejectedValue(Object.assign(new Error('Play services not available'), { code: 'PLAY_SERVICES_NOT_AVAILABLE' }));
        let thrown: unknown;
        await connectGoogleDrive().catch(e => (thrown = e));
        expect(classifyDriveError(thrown)).toBe('no-play-services');
        expect(mockSignIn).not.toHaveBeenCalled();
    });
});
