package io.cypherbox.btc;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;

import androidx.annotation.NonNull;
import androidx.work.WorkManager;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/**
 * JS-callable scheduler for the Ark background refresh on Android.
 *
 * Mirrors the iOS ArkBackgroundScheduler surface: schedule() / cancel().
 *
 * Why AlarmManager (not WorkManager):
 *   On Android 14 + Samsung One UI, neither plain nor expedited
 *   WorkManager workers can reliably start a foreground service from a
 *   cold-spawned dispatch. The worker runs but its UID stays in TRNB
 *   (transient background) state, and startForegroundService() to the
 *   headless task is denied by ActivityManager
 *   ("mAllowStartForeground false"). Documented Android 14 restriction
 *   on background FGS starts.
 *
 *   AlarmManager-fired BroadcastReceivers are an explicit exemption to
 *   that restriction — they get a short-lived allowlist that permits
 *   startForegroundService. We use setAndAllowWhileIdle so the alarm
 *   fires even during Doze maintenance windows.
 *
 *   See {@link ArkRefreshAlarmReceiver} for the fire path.
 *
 * Tunables:
 *   - REPEAT_INTERVAL_MIN: cadence between refreshes.
 *   - setAndAllowWhileIdle: inexact, doesn't require SCHEDULE_EXACT_ALARM
 *     permission. Android may delay the fire by up to ~9 min in deep Doze
 *     but won't suppress it indefinitely.
 *
 * Persistence across reboot: NOT YET HANDLED. AlarmManager alarms are
 * cleared on reboot. Follow-up: add a BOOT_COMPLETED receiver that
 * checks a SharedPreferences flag and re-arms.
 */
public class ArkBackgroundSchedulerModule extends ReactContextBaseJavaModule {

    static final long REPEAT_INTERVAL_MIN = 6 * 60;

    private static final int REQ_CODE = 0xA1010F;

    public ArkBackgroundSchedulerModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return "ArkBackgroundScheduler";
    }

    @ReactMethod
    public void schedule(Promise promise) {
        try {
            Context ctx = getReactApplicationContext();
            // Sweep any leftover WorkManager state from earlier scheduler
            // implementations so stale workspecs don't try to fire.
            cancelLegacyWorkManagerJobs(ctx);
            armAlarm(ctx);
            // Persist enable-state for the boot receiver to read.
            // AlarmManager alarms vanish on reboot; this is the single
            // source of truth that survives reboot + app upgrade.
            // See ArkRefreshBootCompletedReceiver.
            setEnabledFlag(ctx, true);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("schedule_failed", e);
        }
    }

    @ReactMethod
    public void cancel(Promise promise) {
        try {
            Context ctx = getReactApplicationContext();
            cancelAlarm(ctx);
            cancelLegacyWorkManagerJobs(ctx);
            // Mirror of the schedule() write — boot receiver reads this
            // and won't re-arm if it's false. See receiver class doc.
            setEnabledFlag(ctx, false);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("cancel_failed", e);
        }
    }

    /**
     * iOS parity: on iOS the JS side calls markTaskCompleted(taskId,
     * success). Android has no equivalent — the headless task lifecycle
     * is managed by HeadlessJsTaskService. No-op so shared JS code
     * stays platform-agnostic.
     */
    @ReactMethod
    public void markTaskCompleted(String taskId, boolean success) {
        // intentionally empty — see method comment
    }

    /**
     * Returns true when this app is on the OS battery-optimisation
     * allowlist for its package. False means the OS may aggressively
     * defer or suppress our AlarmManager fires under Doze, especially
     * after multi-hour idle stretches — which is exactly the scenario
     * cold-process refresh has to survive.
     *
     * Used by the JS-side onboarding to detect the bad state on
     * toggle-ON and walk the user to Settings to flip it. Probe-only,
     * no side effects.
     *
     * Pre-Marshmallow (API 23) had no Doze mode → no allowlist concept
     * → resolves true (we have no reason to think we're throttled).
     * That codepath effectively never runs since this app's minSdk is
     * higher, but defensive.
     */
    @ReactMethod
    public void isIgnoringBatteryOptimizations(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                promise.resolve(true);
                return;
            }
            Context ctx = getReactApplicationContext();
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm == null) {
                promise.resolve(false);
                return;
            }
            promise.resolve(pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        } catch (Exception e) {
            promise.reject("battery_probe_failed", e);
        }
    }

    /**
     * Open the system "Add this app to the battery-optimisation
     * allowlist?" prompt for our package.
     *
     * Two intent actions are involved:
     *   - ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS: shows a small
     *     "yes/no" dialog asking the user to confirm. Requires the
     *     REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission, which
     *     Google Play has restricted heavily — apps using it can be
     *     rejected from Play Store unless they justify the use. We
     *     deliberately do NOT use it; the rejection-risk isn't worth
     *     the marginally smoother UX.
     *   - ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS: opens the
     *     full system Settings list of all apps' allowlist state.
     *     The user finds Cypher Box and toggles it. Slightly less
     *     direct but doesn't require the restricted permission.
     *
     * We use the latter. If the user is on a vendor with a non-
     * standard battery-management UI (Samsung One UI, Xiaomi MIUI,
     * Huawei EMUI), the system Settings still routes through it,
     * just inside vendor chrome.
     *
     * Not all OEMs honour the standard intent — we fall through to
     * the generic Settings.ACTION_SETTINGS as a last resort so the
     * user doesn't get a no-op tap.
     */
    @ReactMethod
    public void openBatteryOptimizationSettings(Promise promise) {
        try {
            Context ctx = getReactApplicationContext();
            Activity activity = getCurrentActivity();
            // Try the dedicated Settings page first.
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            // Hint at our package so OEM Settings UIs can scroll-to /
            // highlight us in their per-app list. Honoured on stock
            // Android; vendors may ignore it but no harm done.
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                if (activity != null) {
                    activity.startActivity(intent);
                } else {
                    ctx.startActivity(intent);
                }
                promise.resolve(null);
                return;
            } catch (Exception openErr) {
                // Fall through to generic Settings if the device doesn't
                // recognise the action (rare, mostly in custom ROMs).
            }

            Intent fallback = new Intent(Settings.ACTION_SETTINGS);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (activity != null) {
                activity.startActivity(fallback);
            } else {
                ctx.startActivity(fallback);
            }
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("battery_settings_open_failed", e);
        }
    }

    /**
     * Returns the device manufacturer string (Build.MANUFACTURER —
     * e.g. "samsung", "Xiaomi", "HUAWEI"). Lower-cased for
     * normalisation. JS uses this to pick vendor-specific battery /
     * background-restriction guidance copy without having to embed
     * a JNI getter or use a third-party device-info package on this
     * narrow code path.
     */
    @ReactMethod
    public void getDeviceManufacturer(Promise promise) {
        try {
            String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
            promise.resolve(m);
        } catch (Exception e) {
            promise.reject("manufacturer_probe_failed", e);
        }
    }

    /**
     * DEMO-ONLY: synthesise the alarm-fire broadcast from inside the app's
     * own UID. ArkRefreshAlarmReceiver is exported=false, so adb shell can't
     * reach it; an in-process sendBroadcast is the only on-demand way to
     * exercise the AlarmManager -> Receiver -> startForegroundService ->
     * persistent notification path for the Play Console FGS_DATA_SYNC video.
     *
     * The broadcast is delayed until AFTER the activity is backgrounded
     * because RN's HeadlessJsTaskContext.startTask throws IllegalStateException
     * if the app is in foreground (it refuses to launch a second JS context
     * alongside the live one). Backgrounding first matches the demo UX
     * anyway: user "leaves the app", FGS notification appears in the shade.
     *
     * MUST BE REMOVED before next release. Not gated by BuildConfig.DEBUG
     * because the demo is filmed on the release build that ships to Play.
     */
    @ReactMethod
    public void debugFireRefresh(Promise promise) {
        try {
            final Context ctx = getReactApplicationContext();
            android.app.Activity activity = getCurrentActivity();
            if (activity != null) {
                activity.moveTaskToBack(true);
            }
            // Skip the receiver -> JS-task chain (the JS task bails in
            // ~0.4 s when a real refresh round is in flight, killing the
            // FGS notification before the camera can see it). Start the
            // service directly in DEMO hold mode so the notification
            // stays up for the full duration we're recording.
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                Intent svcIntent = new Intent(ctx, ArkRefreshHeadlessTaskService.class);
                svcIntent.putExtra(ArkRefreshHeadlessTaskService.EXTRA_DEMO_HOLD_MS, 60_000L);
                ctx.startForegroundService(svcIntent);
                android.util.Log.i("ArkRefreshAlarm",
                    "debugFireRefresh: FGS started directly in DEMO hold mode (60s)");
            }, 1500);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("debug_fire_failed", e);
        }
    }

    /**
     * Schedule the next alarm. Called both from {@link #schedule} on
     * initial enable and from {@link ArkRefreshAlarmReceiver} after each
     * fire to maintain cadence.
     */
    static void armAlarm(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) {
            android.util.Log.w("ArkRefreshAlarm", "AlarmManager unavailable");
            return;
        }
        long triggerAt = SystemClock.elapsedRealtime() + (REPEAT_INTERVAL_MIN * 60_000L);
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, buildPendingIntent(ctx, false));
        android.util.Log.i("ArkRefreshAlarm",
            "armed alarm to fire in " + REPEAT_INTERVAL_MIN + "min (allowWhileIdle)");
    }

    /**
     * Cancel any pending alarm. Safe to call when no alarm is set.
     */
    static void cancelAlarm(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = buildPendingIntent(ctx, true);
        if (pi != null) {
            am.cancel(pi);
            pi.cancel();
            android.util.Log.i("ArkRefreshAlarm", "alarm cancelled");
        }
    }

    private static PendingIntent buildPendingIntent(Context ctx, boolean noCreate) {
        Intent intent = new Intent(ctx, ArkRefreshAlarmReceiver.class)
            .setAction(ArkRefreshAlarmReceiver.ACTION_FIRE);
        int flags = PendingIntent.FLAG_IMMUTABLE
            | (noCreate ? PendingIntent.FLAG_NO_CREATE : PendingIntent.FLAG_UPDATE_CURRENT);
        return PendingIntent.getBroadcast(ctx, REQ_CODE, intent, flags);
    }

    /**
     * Persist the enable flag to SharedPreferences. Used by both
     * schedule() (write true) and cancel() (write false). The
     * BOOT_COMPLETED / MY_PACKAGE_REPLACED receiver reads this same
     * file + key to decide whether to re-arm the alarm after the
     * system clears it. SharedPreferences is the right primitive
     * because it's the only persistent store accessible from a
     * BroadcastReceiver before any JS bridge is up.
     */
    private static void setEnabledFlag(Context ctx, boolean enabled) {
        SharedPreferences prefs = ctx.getSharedPreferences(
                ArkRefreshBootCompletedReceiver.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .putBoolean(ArkRefreshBootCompletedReceiver.PREF_KEY_ENABLED, enabled)
                .apply();
    }

    /**
     * One-time cleanup of WorkManager-based scheduling artifacts left
     * over from previous implementations of this module. Cheap and
     * idempotent — safe to call on every schedule()/cancel().
     */
    private static void cancelLegacyWorkManagerJobs(Context ctx) {
        try {
            WorkManager wm = WorkManager.getInstance(ctx);
            wm.cancelUniqueWork("ark-vtxo-refresh");
            wm.cancelUniqueWork("ark-vtxo-rearm");
        } catch (Exception ignored) {
            // WM may not be initialized in this process; that's fine —
            // there's nothing to cancel if it never ran.
        }
    }
}
