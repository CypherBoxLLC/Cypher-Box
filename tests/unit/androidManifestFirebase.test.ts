/**
 * Firebase registers for push at every launch unless told not to: FirebaseInstanceId's auto-init ran 25 ms after
 * start, before any JavaScript and before anyone asked for notifications, on a seed-signer too. On a phone with
 * Google Play services that mints a token and talks to Google; without them it fails locally. The manifest turns the
 * auto-init off; react-native-push-notification asks for a token itself when the user opts in, which still works.
 */

import fs from 'fs';
import path from 'path';

const manifest = fs.readFileSync(path.resolve(__dirname, '../../android/app/src/main/AndroidManifest.xml'), 'utf8');

describe('Android manifest', () => {
    it('keeps Firebase from registering for push on its own', () => {
        const tag = manifest.match(/<meta-data[^>]*android:name="firebase_messaging_auto_init_enabled"[^>]*\/>/s);
        expect(tag).not.toBeNull();
        expect(tag![0]).toMatch(/android:value="false"/);
    });
});
