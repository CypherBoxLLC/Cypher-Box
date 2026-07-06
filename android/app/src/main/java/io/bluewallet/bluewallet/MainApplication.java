package io.cypherbox.btc;

import android.app.Application;
import androidx.annotation.NonNull;
import androidx.work.Configuration;
import com.facebook.react.PackageList;
import com.facebook.react.ReactApplication;
import com.facebook.react.ReactHost;
import com.facebook.react.ReactNativeHost;
import com.facebook.react.ReactPackage;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactHost;
import com.facebook.react.defaults.DefaultReactNativeHost;
import com.facebook.react.soloader.OpenSourceMergedSoMapping;
import com.facebook.soloader.SoLoader;
import com.facebook.react.modules.i18nmanager.I18nUtil;
import java.util.List;
import com.bugsnag.android.Bugsnag;

public class MainApplication extends Application implements ReactApplication, Configuration.Provider {

  private final ReactNativeHost mReactNativeHost =
      new DefaultReactNativeHost(this) {
        @Override
        public boolean getUseDeveloperSupport() {
          return BuildConfig.DEBUG;
        }

        @Override
        protected List<ReactPackage> getPackages() {
          List<ReactPackage> packages = new PackageList(this).getPackages();
          // Hand-registered: not auto-linked because the package lives in
          // app/src/main/java rather than a published RN module.
          packages.add(new ArkSafBackupPackage());
          return packages;
        }

        @Override
        protected String getJSMainModuleName() {
          return "index";
        }

        @Override
        protected boolean isNewArchEnabled() {
          return BuildConfig.IS_NEW_ARCHITECTURE_ENABLED;
        }

        @Override
        protected Boolean isHermesEnabled() {
          return BuildConfig.IS_HERMES_ENABLED;
        }
      };

  @Override
  public ReactNativeHost getReactNativeHost() {
    return mReactNativeHost;
  }

  @Override
  public ReactHost getReactHost() {
    return null;
  }

  @Override
  public void onCreate() {
    super.onCreate();
    Bugsnag.start(this);

    I18nUtil sharedI18nUtilInstance = I18nUtil.getInstance();
    sharedI18nUtilInstance.allowRTL(getApplicationContext(), true);

    try {
      SoLoader.init(this, OpenSourceMergedSoMapping.INSTANCE);
    } catch (java.io.IOException e) {
      throw new RuntimeException(e);
    }

    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      DefaultNewArchitectureEntryPoint.load(true, true, false);
    }
  }

  // On-demand WorkManager initialization. Paired with the
  // tools:node="remove" of androidx.work.WorkManagerInitializer in
  // AndroidManifest.xml, this prevents WM from initializing eagerly via
  // androidx.startup's ContentProvider. WM is no longer used for the Ark
  // background-refresh scheduler (now AlarmManager-based), but keeping
  // on-demand init is defensive against any other dep that pulls WM in:
  // eager init can race with cold-spawn JobScheduler dispatches, see
  // issuetracker.google.com/170529030.
  @NonNull
  @Override
  public Configuration getWorkManagerConfiguration() {
    return new Configuration.Builder()
        .setMinimumLoggingLevel(android.util.Log.INFO)
        .build();
  }
}
