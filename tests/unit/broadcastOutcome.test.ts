/**
 * A broadcast whose connection drops before the server answers may already be on the network: the app has to say so
 * rather than show a plain failure that invites a second send. A refusal by the server is a real failure and is
 * passed on unchanged.
 */

import { isConnectionLostError } from '../../src/helpers/broadcastOutcome';

describe('isConnectionLostError', () => {
    it('recognises a connection that went before the answer', () => {
        for (const message of ['close connect', 'read ECONNRESET', 'write EPIPE', 'connect ETIMEDOUT 1.2.3.4:50002', 'socket hang up']) {
            expect(isConnectionLostError(new Error(message))).toBe(true);
        }
    });

    it('leaves a refusal from the server alone', () => {
        for (const message of [
            'the transaction was rejected by network rules.\n\nbad-txns-inputs-missingorspent',
            'min relay fee not met, 110 < 141',
            'Transaction already in block chain',
            'Electrum client is not connected',
        ]) {
            expect(isConnectionLostError(new Error(message))).toBe(false);
        }
    });

    it('copes with odd values', () => {
        expect(isConnectionLostError(undefined)).toBe(false);
        expect(isConnectionLostError('close connect')).toBe(true);
    });
});
