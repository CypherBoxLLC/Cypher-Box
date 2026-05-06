/**
 * Vendor-specific onboarding text for the Android battery-optimisation
 * exclusion. The standard Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS
 * intent opens the right system page, but most major Android OEMs ship
 * an additional layer of vendor battery-management on top of the AOSP
 * allowlist. Without flipping the vendor-side toggle as well, AlarmManager
 * fires can still be deferred indefinitely.
 *
 * Each vendor maps to a list of plain-text steps the user should take
 * AFTER the Settings page opens — Samsung's "Battery → Unrestricted"
 * flow is different from Xiaomi's "Auto-start + Battery saver
 * exclusion", which is different again from Huawei's "App Lock + Manual
 * launch management". Generic Android with no vendor layer (Pixel,
 * stock AOSP) only needs the standard allowlist.
 *
 * No native code here — purely a copy lookup. The `manufacturer` string
 * is what `Build.MANUFACTURER.toLowerCase()` returns.
 */

export type VendorGuidance = {
    /** Display name for the vendor in the onboarding text. */
    vendor: string;
    /** One-line headline describing the action set. */
    headline: string;
    /**
     * Ordered, plain-text steps. Each line ~50–80 chars, no Markdown
     * (rendered into a native Alert which doesn't parse formatting).
     */
    steps: string[];
};

/**
 * Map a `Build.MANUFACTURER` value to vendor-specific guidance. Falls
 * through to the generic Android path for anything we don't recognise
 * — better than showing nothing.
 */
export function vendorGuidance(manufacturer: string): VendorGuidance {
    const m = (manufacturer || '').toLowerCase();

    if (m.includes('samsung')) {
        return {
            vendor: 'Samsung',
            headline: 'Samsung One UI — battery + sleeping apps',
            steps: [
                "1. The Settings page that opens lets you toggle Cypher Box off the optimisation list. Tap 'Cypher Box' → 'Don't optimise' (or 'Unrestricted' on newer One UI).",
                "2. Then go back to Settings → Battery → Background usage limits → Sleeping apps. If Cypher Box is in the list, remove it.",
                "3. Settings → Apps → Cypher Box → Battery → set to Unrestricted.",
                "Without all three, Samsung will defer the refresh alarm during sleep regardless of what AOSP says.",
            ],
        };
    }

    if (m.includes('xiaomi') || m.includes('redmi') || m.includes('poco')) {
        return {
            vendor: 'Xiaomi',
            headline: 'Xiaomi MIUI / HyperOS — autostart + battery saver',
            steps: [
                "1. The Settings page that opens lets you mark Cypher Box as 'No restrictions'.",
                "2. Then open Security app → Permissions → Autostart → enable Cypher Box. MIUI blocks all background work for apps not on the autostart list.",
                "3. Recent apps screen → swipe Cypher Box card down → tap the lock icon so MIUI doesn't kill it on memory pressure.",
                "4. Settings → Battery → Battery saver → exclude Cypher Box.",
            ],
        };
    }

    if (m.includes('huawei') || m.includes('honor')) {
        return {
            vendor: 'Huawei',
            headline: 'Huawei EMUI / Magic UI — app lock + manual launch',
            steps: [
                "1. Settings → Battery → App launch → Cypher Box → switch from Auto-manage to Manual, then enable all three: Auto-launch, Secondary launch, Run in background.",
                "2. Settings → Apps → Cypher Box → Battery → keep running in background.",
                "3. Recent apps → drag Cypher Box card down → padlock icon.",
            ],
        };
    }

    if (m.includes('oppo') || m.includes('realme')) {
        return {
            vendor: 'OPPO / Realme',
            headline: 'OPPO ColorOS / Realme UI — auto-start + background',
            steps: [
                "1. Settings → Battery → Cypher Box → set to 'No restrictions' / 'Allow background activity'.",
                "2. Settings → Apps → App management → Cypher Box → permissions → Allow auto-start + background activity.",
                "3. Recent apps → padlock the Cypher Box card.",
            ],
        };
    }

    if (m.includes('vivo')) {
        return {
            vendor: 'Vivo',
            headline: 'Vivo FunTouch OS / OriginOS — background + auto-start',
            steps: [
                "1. Settings → Battery → Background power consumption → Cypher Box → 'High background power consumption'.",
                "2. iManager / Settings → Apps → Cypher Box → enable Auto-start.",
                "3. Recent apps → padlock the Cypher Box card.",
            ],
        };
    }

    if (m.includes('oneplus')) {
        return {
            vendor: 'OnePlus',
            headline: 'OnePlus OxygenOS — battery + advanced optimisation',
            steps: [
                "1. The Settings page that opens lets you mark Cypher Box as 'Don't optimise' / 'Unrestricted'.",
                "2. Settings → Battery → Battery optimisation → Cypher Box → 'Don't optimise'.",
                "3. Settings → Apps → Cypher Box → Battery → 'Unrestricted'.",
            ],
        };
    }

    // Generic / Pixel / stock AOSP — only the standard allowlist toggle
    // is needed. No vendor battery-management layer to wrestle with.
    return {
        vendor: 'Android',
        headline: "Add Cypher Box to the battery-optimisation allowlist",
        steps: [
            "1. The Settings page that opens shows a list of all apps and their battery-optimisation state.",
            "2. Find Cypher Box and switch it to 'Don't optimise' / 'Allow' / 'Unrestricted' (the exact label varies by Android version).",
            "Without this, the OS may defer the refresh alarm during deep sleep, especially after the phone has been idle for several hours.",
        ],
    };
}
