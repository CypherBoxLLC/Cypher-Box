package io.cypherbox.btc;

import android.content.Context;
import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * WorkManager-backed periodic worker that wakes the headless JS task to
 * run a background Ark VTXO refresh.
 *
 * The actual Bark + JS work happens in ArkRefreshHeadlessTaskService —
 * this worker is a thin wrapper whose only job is to start the headless
 * service. Splitting it this way is the standard React Native pattern
 * for headless work on Android: WorkManager guarantees a wakeup window,
 * the headless service hosts the JS bridge inside that window.
 *
 * Result.success() unconditionally — the headless task itself reports
 * outcomes via the rolling telemetry buffer in AsyncStorage. Returning
 * failure here would have WorkManager retry the worker, which is a
 * different concept from "the refresh round itself failed" and would
 * stack additional wakes on top of our 6h cadence.
 */
public class ArkRefreshWorker extends Worker {

    public ArkRefreshWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        Intent service = new Intent(ctx, ArkRefreshHeadlessTaskService.class);
        ctx.startService(service);
        // Lock acquisition keeps the device CPU on long enough for the
        // headless service to actually fire; HeadlessJsTaskService.acquireWakeLockNow
        // is the supported way.
        com.facebook.react.HeadlessJsTaskService.acquireWakeLockNow(ctx);
        return Result.success();
    }
}
