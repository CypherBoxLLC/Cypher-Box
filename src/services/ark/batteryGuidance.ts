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
            headline: 'Allow Cypher Box to run in the background',
            steps: [
                "In Settings, tap Cypher Box and choose Unrestricted.",
            ],
        };
    }

    if (m.includes('xiaomi') || m.includes('redmi') || m.includes('poco')) {
        return {
            vendor: 'Xiaomi',
            headline: 'Allow Cypher Box to run in the background',
            steps: [
                "In Settings, tap Cypher Box and choose No restrictions.",
                "Then open the Security app → Autostart and enable Cypher Box.",
            ],
        };
    }

    if (m.includes('huawei') || m.includes('honor')) {
        return {
            vendor: 'Huawei',
            headline: 'Allow Cypher Box to run in the background',
            steps: [
                "Settings → Battery → App launch → Cypher Box → set Manual, then enable all three: Auto-launch, Secondary launch, Run in background.",
            ],
        };
    }

    if (m.includes('oppo') || m.includes('realme')) {
        return {
            vendor: 'OPPO / Realme',
            headline: 'Allow Cypher Box to run in the background',
            steps: [
                "In Settings, tap Cypher Box and allow background activity.",
            ],
        };
    }

    if (m.includes('vivo')) {
        return {
            vendor: 'Vivo',
            headline: 'Allow Cypher Box to run in the background',
            steps: [
                "Settings → Battery → Background power → Cypher Box → High.",
                "Settings → Apps → Cypher Box → enable Auto-start.",
            ],
        };
    }

    if (m.includes('oneplus')) {
        return {
            vendor: 'OnePlus',
            headline: 'Allow Cypher Box to run in the background',
            steps: [
                "In Settings, tap Cypher Box and choose Unrestricted.",
            ],
        };
    }

    // Generic / Pixel / stock AOSP — only the standard allowlist toggle
    // is needed. No vendor battery-management layer to wrestle with.
    return {
        vendor: 'Android',
        headline: 'Allow Cypher Box to run in the background',
        steps: [
            "In Settings, tap Cypher Box and choose Don't optimise (or Unrestricted).",
        ],
    };
}
