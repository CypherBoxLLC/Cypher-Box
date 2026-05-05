package io.cypherbox.btc;

import android.content.Intent;
import android.os.Bundle;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

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
