/**
 * The fee selector must never render as a dead control.
 *
 * Field report 2026-08-25: on a second withdrawal the Select Fee button "did
 * nothing", only the chevron animated. The sheet was opening correctly; the
 * component was rendering `Object.entries([]).map(...)`, which produces no rows
 * and no explanation, because the fee lookup had not landed. See the note in
 * FeeSelection.tsx.
 */

import React from 'react';
import renderer from 'react-test-renderer';
import { FeeSelection } from '../../src/screens/ReviewWithdrawal/FeeSelection/FeeSelection';

const TIERS = { fastestFee: 20, halfHourFee: 12, hourFee: 8, economyFee: 4, minimumFee: 1 };

const textOf = (tree: any): string => {
    const out: string[] = [];
    const walk = (n: any) => {
        if (n == null) return;
        if (typeof n === 'string') { out.push(n); return; }
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (n.children) n.children.forEach(walk);
    };
    walk(tree);
    return out.join(' ');
};

const render = (fees: any) =>
    renderer.create(
        <FeeSelection
            fees={fees}
            disabled={false}
            selectedName={null}
            onFeeSelect={() => {}}
            onSelectFeeName={() => {}}
        />,
    ).toJSON();

describe('an empty fee table', () => {
    it('explains itself instead of rendering nothing', () => {
        // This is the exact regression: [] is the initial state of the caller.
        const text = textOf(render([]));
        expect(text).toMatch(/loading|connection/i);
        expect(text.trim().length).toBeGreaterThan(0);
    });

    it('survives undefined and null without throwing', () => {
        expect(() => render(undefined)).not.toThrow();
        expect(() => render(null)).not.toThrow();
        expect(textOf(render(undefined))).toMatch(/loading|connection/i);
    });

    it('does not render an option row when there is nothing to pick', () => {
        expect(textOf(render([]))).not.toMatch(/Fastest|Slow/);
    });
});

describe('a populated fee table', () => {
    it('renders every tier except minimumFee', () => {
        const text = textOf(render(TIERS));
        for (const name of ['Fastest', 'Fast', 'Medium', 'Slow']) {
            expect(text).toContain(name);
        }
        // minimumFee has no display name, so a row for it would read "undefined".
        expect(text).not.toContain('undefined');
    });

    it('labels rates as sat/vB, and carries no em dash', () => {
        const text = textOf(render(TIERS));
        expect(text).toContain('sat/vB');
        expect(text).not.toContain('—');
    });

    it('drops a tier whose value is not a number rather than showing NaN', () => {
        const text = textOf(render({ ...TIERS, halfHourFee: null }));
        expect(text).toContain('Fastest');
        expect(text).not.toContain('Fast:');
        expect(text).not.toContain('NaN');
    });
});
