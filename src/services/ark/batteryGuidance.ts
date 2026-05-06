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
                "1. In the page that opens: tap Cypher Box → Don't optimise.",
                "2. Then Settings → Apps → Cypher Box → Battery → Unrestricted.",
            ],
        };
    }

    if (m.includes('xiaomi') || m.includes('redmi') || m.includes('poco')) {
        return {
            vendor: 'Xiaomi',
            headline: 'Allow Cypher Box to run in the background',
            steps: [
                "1. In the page that opens: Cypher Box → No restrictions.",
                "2. Security app → Autostart → enable Cypher Box.",
                "3. Recent apps → swipe Cypher Box card down → tap the lock icon.",
            ],
        };
    }

    if (m.includes('huawei') || m.includes('honor')) {
        return {
            vendor: 'Huawei',
            headline: 'Allow Cypher Box to run in the background',
            steps: [
                "1. Settings → Battery → App launch → Cypher Box → switch to Manual, enable Auto-launch, Secondary launch, Run in background.",
                "2. Recent apps → drag Cypher Box card down → padlock icon.",
            ],
        };
    }

    if (m.includes('oppo') || m.includes('realme')) {
        return {
            vendor: 'OPPO / Realme',
            headline: 'Allow Cypher Box to run in the background',
            steps: [
                "1. In the page that opens: Cypher Box → Allow background activity.",
                "2. Recent apps → padlock the Cypher Box card.",
            ],
        };
    }

    if (m.includes('vivo')) {
        return {
            vendor: 'Vivo',
            headline: 'Allow Cypher Box to run in the background',
            steps: [
                "1. Settings → Battery → Background power → Cypher Box → High.",
                "2. Settings → Apps → Cypher Box → enable Auto-start.",
            ],
        };
    }

    if (m.includes('oneplus')) {
        return {
            vendor: 'OnePlus',
            headline: 'Allow Cypher Box to run in the background',
            steps: [
                "1. In the page that opens: Cypher Box → Don't optimise.",
                "2. Settings → Apps → Cypher Box → Battery → Unrestricted.",
            ],
        };
    }

    // Generic / Pixel / stock AOSP — only the standard allowlist toggle
    // is needed. No vendor battery-management layer to wrestle with.
    return {
        vendor: 'Android',
        headline: 'Allow Cypher Box to run in the background',
        steps: [
            "1. In the page that opens: Cypher Box → Don't optimise / Unrestricted.",
        ],
    };
}
