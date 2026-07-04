package io.cypherbox.btc;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
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
    /** DEMO-ONLY: separate channel ID so the demo notification can run
     *  at IMPORTANCE_HIGH (heads-up + expanded body text). The existing
     *  ark-bg-refresh channel was created at IMPORTANCE_LOW on existing
     *  installs and Android freezes channel importance after creation,
     *  so a new channel ID is the only path to a visible demo. */
    private static final String DEMO_CHANNEL_ID = "ark-fgs-demo";
    private static final int NOTIFICATION_ID = 1043;

    /** DEMO-ONLY intent extra: if > 0, the service holds the FGS
     *  notification visible for that many ms without running the JS
     *  task. Used by ArkBackgroundSchedulerModule.debugFireRefresh for
     *  the Play Console FGS_DATA_SYNC submission video. Remove with
     *  the rest of the debug path before next release. */
    public static final String EXTRA_DEMO_HOLD_MS = "DEMO_HOLD_MS";

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        boolean demoMode = intent != null
            && intent.getLongExtra(EXTRA_DEMO_HOLD_MS, 0L) > 0;
        // Promote to foreground service immediately so Android 14+ doesn't
        // crash us with ForegroundServiceDidNotStartInTimeException. The
        // dataSync type matches our FOREGROUND_SERVICE_DATA_SYNC permission
        // and the manifest declaration on this service.
        Notification notification = buildNotification(demoMode);
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // DEMO-ONLY: hold the notification visible for the requested
        // duration without running the JS task. Skips the
        // HeadlessJsTaskContext.startTask path entirely (which would
        // collide with an in-flight refresh round and bail in ~0.4 s,
        // taking the notification with it).
        if (intent != null) {
            long demoHoldMs = intent.getLongExtra(EXTRA_DEMO_HOLD_MS, 0L);
            if (demoHoldMs > 0) {
                android.util.Log.i("ArkRefreshAlarm",
                    "service: DEMO hold mode, keeping FGS up for " + demoHoldMs + "ms");
                new android.os.Handler(android.os.Looper.getMainLooper())
                    .postDelayed(this::stopSelf, demoHoldMs);
                return START_NOT_STICKY;
            }
        }

        return super.onStartCommand(intent, flags, startId);
    }

    private Notification buildNotification(boolean demoMode) {
        Context ctx = getApplicationContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        String channelId = demoMode ? DEMO_CHANNEL_ID : CHANNEL_ID;
        if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (demoMode) {
                NotificationChannel demoCh = new NotificationChannel(
                    DEMO_CHANNEL_ID,
                    "Bark capsule refresh (demo)",
                    NotificationManager.IMPORTANCE_HIGH
                );
                demoCh.setDescription("Heads-up demo of the foreground sync notification");
                demoCh.enableVibration(true);
                nm.createNotificationChannel(demoCh);
            } else {
                NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID,
                    "Ark background refresh",
                    NotificationManager.IMPORTANCE_LOW
                );
                ch.setDescription("Brief refresh of Ark VTXO state");
                nm.createNotificationChannel(ch);
            }
        }
        // Tap target: bring the app to foreground. Without a contentIntent
        // tapping the FGS notification does nothing, which both feels broken
        // to users and looks broken to Play reviewers.
        PendingIntent tapPi = null;
        Intent launchIntent = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            tapPi = PendingIntent.getActivity(
                ctx, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channelId)
            .setContentTitle("Bark capsule refresh")
            .setContentText("Syncing wallet state and uploading encrypted backup")
            .setStyle(new NotificationCompat.BigTextStyle()
                .bigText("Cypher Box is syncing Bark capsule state with the Ark server and uploading the encrypted wallet backup to your connected Google Drive. Tap to open."))
            .setSmallIcon(R.mipmap.logonew)
            .setOngoing(true)
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis())
            .setPriority(demoMode ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_LOW);
        if (tapPi != null) b.setContentIntent(tapPi);
        return b.build();
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
