import { Cookie } from 'tough-cookie';
import https from 'https';
const agent = new https.Agent({ family: 4 });
const stringToU8Array = (str) => new TextEncoder().encode(str);
const base64ToU8Array = (str) => Uint8Array.from(Buffer.from(str, 'base64'));
export { base64ToU8Array, stringToU8Array };
export function extractiCloudCookies(response) {
    const cookies = Array.from(response.headers.entries())
        .filter((v) => v[0].toLowerCase() == 'set-cookie')
        .map((v) => v[1].split(', '))
        .reduce((a, b) => a.concat(b), [])
        .map((v) => Cookie.parse(v))
        .filter((v) => !!v);
    if (cookies.length === 0) {
        throw new Error('Failed to extract iCloud cookies');
    }
    return cookies;
}
/**
 * How long one request to Apple may take, body included. Without a deadline a
 * request that stalls - before the headers or halfway through the body - never
 * settles, and the caller's refresh loop stops with it until the app restarts.
 * The abort surfaces as an AbortError, which isTransientNetworkError() treats
 * like any other network blip: retry later, session kept.
 */
export const REQUEST_TIMEOUT_MS = 30000;
/**
 * Options for every fetch to Apple. A function, not a constant: the timeout
 * signal starts counting when it is created, so each request needs its own.
 */
export function fetchOptions() {
    return {
        agent,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
}
//# sourceMappingURL=utils.js.map