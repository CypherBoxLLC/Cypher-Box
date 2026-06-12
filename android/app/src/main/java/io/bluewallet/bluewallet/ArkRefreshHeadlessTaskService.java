package io.cypherbox.btc;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.facebook.react.HeadlessJsTaskService;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;

/**
 * Headless JS task that hosts the Ark background refresh on Android.
 *
 * Spun up by the WorkManager-backed ArkRefreshWorker. The task key
 * "ArkBackgroundRefresh" matches the AppRegistry.registerHeadlessTask
 * call on the JS side (see index.js).
 *
 * Foreground-service status: required on Android 14+. The worker calls
 * startForegroundService() (not startService()) — Android then expects
 * onStartCommand to call startForeground(...) within ~5 seconds or it
 * crashes the process with ForegroundServiceDidNotStartInTimeException.
 * We satisfy that immediately, then chain to the standard headless task
 * lifecycle. Service exits when the JS task completes (or hits the 30s
 * timeout) and HeadlessJsTaskService.stopSelf is called.
 *
 * Timeout 30s — matches our iOS budget so the JS-side runBackgroundRefresh
 * implementation is symmetric across platforms. WorkManager itself gives
 * us up to 10 minutes for a single Worker, so the bottleneck is the JS
 * task config below, not the worker.
 *
 * allowedInForeground=false: if the app happens to be foregrounded when
 * a wake fires we let the existing useArkSync pipeline handle it. Two
 * concurrent refresh paths would race on the wallet handle.
 */
public class ArkRefreshHeadlessTaskService extends HeadlessJsTaskService {

    private static final String CHANNEL_ID = "ark-bg-refresh";
    private static final int NOTIFICATION_ID = 1043;

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        // Promote to foreground service immediately so Android 14+ doesn't
        // crash us with ForegroundServiceDidNotStartInTimeException. The
        // dataSync type matches our FOREGROUND_SERVICE_DATA_SYNC permission
        // and the manifest declaration on this service.
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return super.onStartCommand(intent, flags, startId);
    }

    private Notification buildNotification() {
        Context ctx = getApplicationContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                "Ark background refresh",
                NotificationManager.IMPORTANCE_LOW
            );
            ch.setDescription("Brief refresh of Ark VTXO state");
            nm.createNotificationChannel(ch);
        }
        return new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setContentTitle("Refreshing Ark wallet")
            .setContentText("Updating VTXO state")
            .setSmallIcon(R.mipmap.logonew)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    @Override
    @Nullable
    protected HeadlessJsTaskConfig getTaskConfig(@NonNull Intent intent) {
        Bundle extras = intent.getExtras();
        return new HeadlessJsTaskConfig(
            "ArkBackgroundRefresh",
            extras != null ? Arguments.fromBundle(extras) : Arguments.createMap(),
            30000,    // 30s timeout
            false     // allowedInForeground
        );
    }
}
