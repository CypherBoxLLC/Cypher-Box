/**
 * Whether a broadcast failed because the connection to the Electrum server went away before it answered, rather than
 * because the server refused the transaction. Then the transaction may or may not have reached the network: the
 * raw "close connect" read like a plain failure, and a user who built a second send (spending other capsules) could
 * pay twice.
 */
const CONNECTION_LOST = /^close connect$|ECONNRESET|EPIPE|ETIMEDOUT|socket hang up|socket closed|connection (closed|lost)/i;

export function isConnectionLostError(error: unknown): boolean {
    const message = (error as { message?: unknown } | null)?.message;
    return CONNECTION_LOST.test(typeof message === 'string' ? message : String(error ?? ''));
}
