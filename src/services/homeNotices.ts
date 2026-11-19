import type { ReactNode } from 'react';

/**
 * Home's contextual notices, drawn as a row of small coloured icons
 * (components/HomeNotices). Tapping an icon shows its message, tapping it
 * again hides it.
 *
 *   red     critical: funds can be lost soon. Never ignorable.
 *   yellow  a warning worth acting on.
 *   green   a tip.
 *
 * Ignore on a yellow or green notice stores the notice's `situation`. The
 * notice stays hidden only while its situation is the same, so it comes back
 * when something about it changes: new dust capsules, low fees on a later
 * day, a new backup to export, the vault going offline again.
 */
export type HomeNoticeSeverity = 'red' | 'yellow' | 'green';

export type HomeNotice = {
    /** Stable for a kind of notice. Keys the Ignore record. */
    id: string;
    severity: HomeNoticeSeverity;
    /** Ionicons glyph for the icon. */
    icon: string;
    /** What Ignore is pinned to: an ignored notice returns once this changes. */
    situation: string;
    /** The message. Not drawn when `content` is given. */
    text?: string;
    /** Part of `text` drawn underlined, as the hint that the message is a tap target. */
    linkText?: string;
    /** Runs when the message is tapped. */
    onPress?: () => void;
    /** Other things to do, drawn as underlined links under the message. */
    actions?: ReadonlyArray<{ label: string; onPress: () => void }>;
    /** A message with its own controls, drawn instead of `text`. */
    content?: ReactNode;
    /** Spoken name of the icon. Defaults to `text`. */
    accessibilityLabel?: string;
};

const SEVERITY_ORDER: HomeNoticeSeverity[] = ['red', 'yellow', 'green'];

/** Bark notice ids start with this, so deleting the vault can drop their Ignore records. */
export const ARK_NOTICE_PREFIX = 'ark-';

export function isIgnorable(notice: Pick<HomeNotice, 'severity'>): boolean {
    return notice.severity !== 'red';
}

/**
 * The notices to draw: red ones always, the others unless they were ignored
 * in their current situation. Red first, then yellow, then green, keeping the
 * caller's order within a colour. A repeated id keeps its first entry.
 */
export function visibleHomeNotices<T extends HomeNotice>(
    notices: ReadonlyArray<T | null | undefined | false>,
    ignored: Readonly<Record<string, string>> | null | undefined,
): T[] {
    const seen = new Set<string>();
    const shown: T[] = [];
    for (const notice of notices) {
        if (!notice || seen.has(notice.id)) continue;
        seen.add(notice.id);
        if (isIgnorable(notice) && ignored?.[notice.id] === notice.situation) continue;
        shown.push(notice);
    }
    return SEVERITY_ORDER.flatMap((severity) => shown.filter((n) => n.severity === severity));
}

/** The Ignore record without the Bark notices, for when the Bark vault goes away. */
export function withoutArkNoticeIgnores(
    ignored: Readonly<Record<string, string>> | null | undefined,
): Record<string, string> {
    const kept: Record<string, string> = {};
    for (const [id, situation] of Object.entries(ignored ?? {})) {
        if (!id.startsWith(ARK_NOTICE_PREFIX)) kept[id] = situation;
    }
    return kept;
}

/** Today's date as a situation, for a notice that should come back on a later day. */
export function daySituation(now: Date = new Date()): string {
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/**
 * A count as a situation that only changes in steps of `step`, so a value that
 * drifts a little (a fee estimate) does not bring an ignored notice back.
 */
export function stepSituation(value: number, step: number): string {
    if (!Number.isFinite(value) || step <= 0) return '0';
    return String(Math.ceil(value / step));
}
