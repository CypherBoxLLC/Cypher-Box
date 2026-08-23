/**
 * Auto-board is the only thing that moves the on-chain balance without the user
 * asking, and that balance is where unilateral-exit CPFP fees come from. Board
 * the wrong amount and the exit is disarmed, silently.
 */
import { decideAutoBoard, AutoBoardInput } from '../../src/services/ark/autoBoardDecision';

const MIN_BOARD = 50_000;
const HEADROOM = 1_500;

const base = (over: Partial<AutoBoardInput> = {}): AutoBoardInput => ({
    confirmedSats: 0,
    pendingBoardSats: 0,
    exitInProgress: false,
    armedReserveSats: 0,
    recommendedReserveSats: null,
    minBoardSats: MIN_BOARD,
    boardFeeHeadroomSats: HEADROOM,
    ...over,
});

describe('decideAutoBoard', () => {
    it('boards nothing at all while an exit is in progress', () => {
        const d = decideAutoBoard(base({ confirmedSats: 500_000, exitInProgress: true }));
        expect(d).toEqual({ action: 'skip', reason: 'exit-in-progress' });
    });

    it('skips when a board is already in flight, which would otherwise double-board', () => {
        const d = decideAutoBoard(base({ confirmedSats: 500_000, pendingBoardSats: 60_000 }));
        expect(d).toEqual({ action: 'skip', reason: 'board-in-flight' });
    });

    it('skips when there is nothing on-chain', () => {
        expect(decideAutoBoard(base({ confirmedSats: 0 }))).toEqual({
            action: 'skip', reason: 'nothing-onchain',
        });
    });

    describe('THE BUG: a funded reserve above the armed value', () => {
        // Device figures, 2026-08-20: armed 3,654 while the estimate said
        // 233,120. Funding to the recommendation by external deposit used to
        // leave everything above 3,654 eligible for boarding.
        const funded = base({
            confirmedSats: 233_120,
            armedReserveSats: 3_654,
            recommendedReserveSats: 233_120,
        });

        it('holds the full recommendation, not the stale armed value', () => {
            const d = decideAutoBoard(funded);
            expect(d.action).toBe('hold');
            expect((d as any).holdSats).toBe(233_120);
        });

        it('would have boarded 227,966 sats away under the old armed-only rule', () => {
            // What the previous logic computed: confirmed - armed - headroom.
            const oldExcess = 233_120 - 3_654 - HEADROOM;
            expect(oldExcess).toBe(227_966);
            expect(oldExcess).toBeGreaterThanOrEqual(MIN_BOARD); // so it WOULD have fired
            const d = decideAutoBoard(funded);
            expect(d.action).not.toBe('board-amount');
        });
    });

    it('boards a genuine surplus above the hold target', () => {
        const d = decideAutoBoard(base({
            confirmedSats: 300_000,
            armedReserveSats: 3_654,
            recommendedReserveSats: 233_120,
        }));
        expect(d).toEqual({ action: 'board-amount', sats: 300_000 - 233_120 - HEADROOM, holdSats: 233_120 });
    });

    it('honours an armed reserve larger than the recommendation', () => {
        const d = decideAutoBoard(base({
            confirmedSats: 400_000,
            armedReserveSats: 350_000,
            recommendedReserveSats: 233_120,
        }));
        expect((d as any).holdSats).toBe(350_000);
    });

    describe('the unarmed path', () => {
        it('boards everything when nothing needs holding', () => {
            const d = decideAutoBoard(base({ confirmedSats: 60_000 }));
            expect(d).toEqual({ action: 'board-all', holdSats: 0 });
        });

        it('THE SECOND BUG: holds instead of retrying a board that can never succeed', () => {
            // 6,259 on-chain against a 50,000 minimum. The old code called
            // boardAll here every sync tick, forever.
            const d = decideAutoBoard(base({ confirmedSats: 6_259 }));
            expect(d).toEqual({
                action: 'hold', reason: 'below-board-minimum', surplusSats: 6_259, holdSats: 0,
            });
        });
    });

    it('never boards a surplus below the server minimum', () => {
        const d = decideAutoBoard(base({
            confirmedSats: 60_000,
            armedReserveSats: 20_000,
            recommendedReserveSats: null,
        }));
        // 60,000 - 20,000 - 1,500 = 38,500, under the 50,000 minimum.
        expect(d).toEqual({
            action: 'hold', reason: 'below-board-minimum', surplusSats: 38_500, holdSats: 20_000,
        });
    });

    it('leaves the headroom so boardAmount fees cannot dip below the hold', () => {
        const d = decideAutoBoard(base({ confirmedSats: 151_500, armedReserveSats: 100_000 }));
        expect(d).toEqual({ action: 'board-amount', sats: 50_000, holdSats: 100_000 });
    });
});
