package io.cypherbox.btc;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

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
