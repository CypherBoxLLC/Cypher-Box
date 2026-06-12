package io.cypherbox.btc;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

/**
 * Re-arm the Ark background-refresh alarm after device boot or app
 * upgrade.
 *
 * Why this exists: AlarmManager alarms are kept in RAM, not in
 * persistent storage. They evaporate on reboot. Without this receiver,
 * a user who enabled Ark auto-refresh and then rebooted their phone
 * would silently lose the cadence — `setArkBackgroundRefreshEnabled`
 * would still report the toggle as on, but no alarm would actually
 * fire until the user toggled off and back on (or until the app's
 * next foreground sync re-armed it via some other path, which the
 * current architecture does not do).
 *
 * Also handles MY_PACKAGE_REPLACED: when the user updates Cypher Box
 * via Play Store / sideload reinstall, Android kills the old process
 * and clears its alarms. If the user had auto-refresh on, they expect
 * it to keep running across the update. The intent fires once per
 * update.
 *
 * STATE SOURCE: a single SharedPreferences boolean
 * `arkAutoRefreshEnabled` written by
 * {@link ArkBackgroundSchedulerModule#schedule(com.facebook.react.bridge.Promise)}
 * and {@link ArkBackgroundSchedulerModule#cancel(com.facebook.react.bridge.Promise)}.
 * SharedPreferences is the right primitive here:
 *   - Survives reboot (lives in app sandbox /data/data/.../shared_prefs)
 *   - Accessible from a BroadcastReceiver without a JS bridge being
 *     up — the bridge is the whole reason this receiver exists,
 *     since at boot there is no React context yet.
 *   - Doesn't require the app to be alive for the read.
 *
 * Doesn't fire armAlarm immediately on boot — the alarm re-arms with
 * the standard REPEAT_INTERVAL_MIN cadence (6h). A reboot is not a
 * good signal to refresh urgently; what we care about is preserving
 * the regular cadence going forward.
 *
 * Receiver runs on the main thread but does only a SharedPreferences
 * read + a single AlarmManager schedule call, both microsecond-cheap.
 * No risk of an ANR.
 */
public class ArkRefreshBootCompletedReceiver extends BroadcastReceiver {

    private static final String TAG = "ArkRefreshBoot";

    /**
     * SharedPreferences file name. Namespaced so it doesn't collide
     * with any other prefs the app might create. Mirrors the iOS
     * NSUserDefaults suite-name pattern.
     */
    static final String PREFS_NAME = "io.cypherbox.btc.ark_scheduler";

    /**
     * Single boolean — true while the user has auto-refresh enabled.
     * Default false: a fresh install or post-data-clear state means no
     * re-arm should happen.
     */
    static final String PREF_KEY_ENABLED = "arkAutoRefreshEnabled";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        // The manifest registers BOOT_COMPLETED + MY_PACKAGE_REPLACED.
        // Defensive: only act on those exact actions in case the
        // intent-filter is broadened later.
        String action = intent.getAction();
        if (action == null) return;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }

        Context appCtx = context.getApplicationContext();
        SharedPreferences prefs = appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean enabled = prefs.getBoolean(PREF_KEY_ENABLED, false);

        if (!enabled) {
            Log.i(TAG, "received " + action + " but auto-refresh is OFF, no re-arm");
            return;
        }

        Log.i(TAG, "received " + action + ", auto-refresh is ON — re-arming alarm");
        try {
            ArkBackgroundSchedulerModule.armAlarm(appCtx);
        } catch (Throwable t) {
            // Swallow: a failure to re-arm shouldn't crash the receiver
            // (which would fail the boot intent dispatch and could
            // surface as an ANR notification). Logged for diagnostics;
            // user will see the missing cadence on the next foreground
            // open of the app, where the toggle UI re-arms via the
            // normal schedule() path if state drifted.
            Log.e(TAG, "armAlarm threw on boot re-arm", t);
        }
    }
}
