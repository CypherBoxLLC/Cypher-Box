/**
 * The CoinOS relay's API key, or undefined when this checkout has none.
 *
 * It lives in blue_modules/secrets.ts, which is gitignored and per-machine, so
 * it is routinely absent in a worktree, a fresh clone or CI. Its absence only
 * means this build does not register for CoinOS payment push notifications.
 * To enable push, `cp blue_modules/secrets.example.ts blue_modules/secrets.ts`
 * and paste the real key from a checkout that has it.
 *
 * Why this is a file of its own: Metro still builds when the secrets file is
 * missing, because a require inside try/catch counts as optional. But it then
 * leaves the missing module out of the file's dependency list while the code
 * keeps its original positions, so every require after it in the same file
 * loads the wrong module. When this lived in coinosSocket.ts, the relay URI
 * lookup became "Requiring unknown module undefined" at launch, and payment
 * notifications and the event log were quietly handed each other's modules.
 * Alone here, there is nothing after it to shift: the lookup throws, the catch
 * takes it, and the key is simply absent.
 *
 * Keep this file free of any other import or require.
 */
let key: string | undefined;
try {
    key = require('../../blue_modules/secrets')?.RELAY_API_KEY;
} catch {
    key = undefined;
}

export const RELAY_API_KEY: string | undefined = key;
