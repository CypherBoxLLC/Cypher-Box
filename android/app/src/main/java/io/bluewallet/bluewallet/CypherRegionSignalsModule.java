package io.cypherbox.btc;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.res.Resources;
import android.os.Build;
import android.telephony.TelephonyManager;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Country signals for the Strike and CoinOS region gates on Android
 * (src/services/featureFlags.ts). Android has no App Store storefront to read,
 * so the gate combines what the phone itself reports:
 *
 *   language      country of the phone's first language ("English (United
 *                 States)" gives US); null when the language names no country
 *   vendorRegion  Xiaomi's own region setting (ro.miui.region); null on other
 *                 phones
 *   sim           country of the SIM provider; null without a SIM
 *   network       country of the mobile network each modem is on or can see,
 *                 which Android reports even without a SIM; empty when no
 *                 network is in reach (airplane mode, Wi-Fi-only tablets)
 *
 * Every value is an upper-case ISO 3166-1 alpha-2 code or null. A signal that
 * cannot be read is reported as missing, never guessed, so the JS gate can
 * fail closed when nothing is known. react-native-localize is not used here
 * because its getCountry() answers "US" when the language names no country.
 *
 * Nothing here needs a permission or touches the network.
 *
 * JS surface (NativeModules.CypherRegionSignals):
 *   constants { language, vendorRegion, sim, network }  read when JS first
 *                                                       touches the module
 *   getSignals() -> Promise<same shape>                 read again on demand
 */
public class CypherRegionSignalsModule extends ReactContextBaseJavaModule {

    private static final String NAME = "CypherRegionSignals";

    public CypherRegionSignalsModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    // Read once so the JS gate can answer synchronously during render.
    @Override
    public Map<String, Object> getConstants() {
        return readSignals(getReactApplicationContext());
    }

    // Read again on demand: the network country can arrive after launch and
    // changes when the phone moves to another country.
    @ReactMethod
    public void getSignals(Promise promise) {
        try {
            promise.resolve(Arguments.makeNativeMap(readSignals(getReactApplicationContext())));
        } catch (Exception e) {
            promise.reject("E_REGION_SIGNALS", e);
        }
    }

    private static Map<String, Object> readSignals(Context context) {
        Map<String, Object> signals = new HashMap<>();
        signals.put("language", languageCountry());
        signals.put("vendorRegion", countryCode(systemProperty("ro.miui.region")));

        TelephonyManager telephony = null;
        try {
            telephony = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
        } catch (Exception ignored) {
            // No telephony service: the SIM and network stay unknown.
        }
        signals.put("sim", telephony == null ? null : simCountry(telephony));
        signals.put("network", telephony == null ? new ArrayList<String>() : networkCountries(telephony));
        return signals;
    }

    // The phone's own language list, not the app's: a per-app language must
    // not stand in for the user's region.
    @Nullable
    private static String languageCountry() {
        try {
            return countryCode(Resources.getSystem().getConfiguration().getLocales().get(0).getCountry());
        } catch (Exception ignored) {
            return null;
        }
    }

    @Nullable
    private static String simCountry(@NonNull TelephonyManager telephony) {
        try {
            return countryCode(telephony.getSimCountryIso());
        } catch (Exception ignored) {
            // Android 15+ throws on devices without SIM support.
            return null;
        }
    }

    private static ArrayList<String> networkCountries(@NonNull TelephonyManager telephony) {
        Set<String> countries = new LinkedHashSet<>();
        try {
            addCountry(countries, telephony.getNetworkCountryIso());
        } catch (Exception ignored) {
            // Android 15+ throws on devices without a cellular radio.
        }
        // Dual-SIM phones can see a different network on each modem, for
        // example near a border. Reading a slot needs no permission (API 30).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            int modems = 0;
            try {
                modems = telephony.getActiveModemCount();
            } catch (Exception ignored) {
                // Keep the default network's answer only.
            }
            for (int slot = 0; slot < modems; slot++) {
                try {
                    addCountry(countries, telephony.getNetworkCountryIso(slot));
                } catch (Exception ignored) {
                    // An invalid or idle slot tells us nothing.
                }
            }
        }
        return new ArrayList<>(countries);
    }

    private static void addCountry(Set<String> countries, @Nullable String value) {
        String code = countryCode(value);
        if (code != null) countries.add(code);
    }

    /** Upper-case ISO 3166-1 alpha-2, or null for anything else ("", "419", "GLOBAL"). */
    @Nullable
    private static String countryCode(@Nullable String value) {
        if (value == null) return null;
        String code = value.trim().toUpperCase(Locale.ROOT);
        return code.matches("[A-Z]{2}") ? code : null;
    }

    // Same read react-native-localize makes for the Xiaomi region.
    @Nullable
    private static String systemProperty(String key) {
        try {
            @SuppressLint("PrivateApi")
            Class<?> properties = Class.forName("android.os.SystemProperties");
            Object value = properties.getMethod("get", String.class).invoke(null, key);
            return value instanceof String ? (String) value : null;
        } catch (Exception ignored) {
            return null;
        }
    }
}
