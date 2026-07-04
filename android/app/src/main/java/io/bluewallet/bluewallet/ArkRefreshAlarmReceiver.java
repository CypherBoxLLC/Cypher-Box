package io.cypherbox.btc;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.facebook.react.HeadlessJsTaskService;

/**
 * Alarm-fired receiver that hosts the Ark background refresh.
 *
 * Why a BroadcastReceiver instead of WorkManager: on Android 14 +
 * Samsung One UI, even an expedited WorkManager worker can't reliably
 * call startForegroundService for the headless task service — the
 * worker's UID stays in TRNB (transient background) state and the
 * system denies background FGS starts (mAllowStartForeground=false).
 *
 * AlarmManager-fired BroadcastReceivers are explicitly exempted from
 * background-start restrictions for the brief window they execute in
 * (see Android's "exempted use cases" for FGS). When this receiver
 * runs, it can call startForegroundService(ArkRefreshHeadlessTaskService)
 * successfully because the alarm-fire path grants the temporary
 * allowlist.
 *
 * The receiver also re-arms the next alarm so the cadence continues
 * after every fire. Cancellation is handled centrally in
 * {@link ArkBackgroundSchedulerModule#cancelAlarm}.
 */
public class ArkRefreshAlarmReceiver extends BroadcastReceiver {

    static final String ACTION_FIRE = "io.cypherbox.btc.ARK_REFRESH_ALARM";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !ACTION_FIRE.equals(intent.getAction())) {
            return;
        }
        android.util.Log.i("ArkRefreshAlarm", "alarm fired, starting headless service");
        try {
            Intent svc = new Intent(ctx, ArkRefreshHeadlessTaskService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(svc);
            } else {
                ctx.startService(svc);
            }
            // Wake-lock keeps the device CPU on long enough for the headless
            // service's onStartCommand to call startForeground and bring up
            // the JS bridge.
            HeadlessJsTaskService.acquireWakeLockNow(ctx);
            android.util.Log.i("ArkRefreshAlarm", "service start dispatched");
        } catch (Exception e) {
            android.util.Log.w("ArkRefreshAlarm", "startForegroundService failed: " + e.getMessage());
        }
        // Re-arm regardless of fire success — a transient failure shouldn't
        // break the cadence.
        ArkBackgroundSchedulerModule.armAlarm(ctx);
    }
}
