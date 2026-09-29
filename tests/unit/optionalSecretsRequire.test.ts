/**
 * The gitignored secrets module is loaded from one file, and that file loads
 * nothing else.
 *
 * What this protects: blue_modules/secrets.ts is per-machine and routinely
 * missing. Metro still builds, treating a require inside try/catch as
 * optional, but it leaves the missing module out of the requiring file's
 * dependency list while the code keeps its original positions, so every later
 * require in that file loads the wrong module. On the phone that showed as
 * "Requiring unknown module undefined" at launch, while CoinOS payment
 * notifications and the event log were quietly handed the wrong modules.
 * Jest resolves modules its own way and cannot reproduce it, so this checks
 * the shape that makes it impossible.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const KEY_MODULE = 'src/services/relayApiKey.ts';

/** A require or import of the secrets module, however the path is spelled. */
const LOADS_SECRETS = /(?:require\(\s*|from\s+)['"](?:[^'"]*\/blue_modules\/secrets|\.\/secrets)['"]/;

/** Tracked and new source files; gitignored ones, the secrets file among them, stay out. */
const trackedSources = (): string[] =>
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'blue_modules'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((f) => /\.(ts|tsx|js)$/.test(f));

describe('the gitignored secrets module', () => {
    it(`is loaded from ${KEY_MODULE} and nowhere else`, () => {
        const loaders = trackedSources().filter((rel) =>
            LOADS_SECRETS.test(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')),
        );
        expect(loaders).toEqual([KEY_MODULE]);
    });

    it('is the only module that file loads, so nothing after it can shift', () => {
        const code = fs
            .readFileSync(path.join(REPO_ROOT, KEY_MODULE), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
        expect(code.match(/\brequire\(|^\s*import\s|^\s*export\s[^;]*\sfrom\s/gm) ?? []).toHaveLength(1);
    });
});
