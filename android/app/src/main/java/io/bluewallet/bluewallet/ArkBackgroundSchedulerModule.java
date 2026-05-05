package io.cypherbox.btc;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.util.concurrent.TimeUnit;

/**
 * JS-callable scheduler for the Ark background refresh on Android.
 *
 * Mirrors the iOS ArkBackgroundScheduler surface: schedule() / cancel().
 * On Android the implementation is a periodic WorkManager request — much
 * simpler than the iOS BGTaskScheduler dance because WorkManager handles
 * its own re-arming and persistence across reboots / app upgrades.
 *
 * Tunables:
 *   - 6h period: matches the iOS earliestBeginDate; WorkManager imposes
 *     a 15-minute floor but our spec is "every 6 hours."
 *   - requiresNetwork CONNECTED: we need to reach the ASP and esplora.
 *   - requiresBatteryNotLow: spec mandate. Avoids draining a low battery
 *     for an opportunistic refresh.
 *
 * Identifier matches the Headless task ID so JS-side AppRegistry pickup
 * is unambiguous.
 */
public class ArkBackgroundSchedulerModule extends ReactContextBaseJavaModule {

    private static final String WORK_NAME = "ark-vtxo-refresh";
    private static final long REPEAT_INTERVAL_MIN = 6 * 60;

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
            Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .setRequiresBatteryNotLow(true)
                .build();

            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                ArkRefreshWorker.class,
                REPEAT_INTERVAL_MIN, TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .build();

            // KEEP policy: re-enabling the toggle does not reset the
            // earliest-fire window if the work is already enqueued. This
            // matters because a user toggling on/off rapidly should not
            // reschedule the 6h clock from zero each time — that would
            // delay the first real wake indefinitely.
            WorkManager.getInstance(getReactApplicationContext())
                .enqueueUniquePeriodicWork(
                    WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    request
                );

            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("schedule_failed", e);
        }
    }

    @ReactMethod
    public void cancel(Promise promise) {
        try {
            WorkManager.getInstance(getReactApplicationContext())
                .cancelUniqueWork(WORK_NAME);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("cancel_failed", e);
        }
    }

    /**
     * iOS parity: on iOS the JS side calls markTaskCompleted(taskId,
     * success) so the OS knows whether the BGTask succeeded. WorkManager
     * doesn't have an equivalent — Result.success() / Result.failure()
     * is decided in the worker itself. We accept the call as a no-op so
     * shared JS code can be platform-agnostic.
     */
    @ReactMethod
    public void markTaskCompleted(String taskId, boolean success) {
        // intentionally empty — see method comment
    }
}
