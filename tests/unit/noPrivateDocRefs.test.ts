/**
 * Tracked files must not point at local-only tooling paths.
 *
 * Such a reference is a broken link for everyone except its author, because the
 * target exists only in their working copy. It reads as a live pointer and
 * resolves to nothing on a fresh clone, which makes it easy to add and hard to
 * notice.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const MAX_SCAN_BYTES = 2_000_000;

const LOCAL_ONLY = [/\.claude\//];

/** Exactly the set of files that ends up in a clone. */
const trackedFiles = (): string[] =>
    execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        // .gitignore has to name the directory in order to ignore it, and this
        // test has to name it in order to look for it.
        .filter((f) => f !== '.gitignore' && !f.endsWith('noPrivateDocRefs.test.ts'));

describe('tracked files do not point at local-only paths', () => {
    it('finds none, anywhere', () => {
        const offenders: string[] = [];
        for (const rel of trackedFiles()) {
            const abs = path.join(REPO_ROOT, rel);
            let body: string;
            try {
                if (fs.statSync(abs).size > MAX_SCAN_BYTES) continue;
                body = fs.readFileSync(abs, 'utf8');
            } catch {
                continue; // unreadable or binary
            }
            body.split('\n').forEach((line, i) => {
                if (LOCAL_ONLY.some((rx) => rx.test(line))) offenders.push(`${rel}:${i + 1}`);
            });
        }
        expect(offenders).toEqual([]);
    });
});
