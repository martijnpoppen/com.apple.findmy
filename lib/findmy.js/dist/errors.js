/**
 * Transport-level failure codes. These mean "we never got an answer from
 * Apple", not "Apple rejected us" — the session is still perfectly valid and
 * the only correct response is to back off and try the same session again.
 */
const TRANSIENT_CODES = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EPIPE',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENETDOWN',
    'EPROTO',
    'ERR_SOCKET_CONNECTION_TIMEOUT',
    'UND_ERR_CONNECT_TIMEOUT',
]);
/**
 * Statuses on which iCloud expects the caller to re-run the full sign-in.
 * Mirrors what pyicloud/icloudpy treat as "session is dead": 421 and 450 are
 * iCloud's re-auth signals, 401 is a plain rejected cookie set.
 */
const AUTH_STATUSES = new Set([401, 421, 450]);
/**
 * An error carrying the HTTP status iCloud replied with, so callers can tell
 * "session expired, sign in again" apart from "iCloud is having a moment".
 * Throwing a bare Error here loses that distinction and makes every hiccup
 * look like an expired session.
 */
export class ICloudRequestError extends Error {
    constructor(endpoint, status, body) {
        super(`iCloud request to ${endpoint} failed with status ${status}`);
        this.name = 'ICloudRequestError';
        this.status = status;
        this.body = body;
        this.endpoint = endpoint;
    }
    /** Session is no longer accepted — a fresh sign-in is the only way forward. */
    get isAuthError() {
        return AUTH_STATUSES.has(this.status);
    }
    /** Server-side wobble — retry the same session later. */
    get isTransient() {
        return this.status === 429 || this.status >= 500;
    }
}
/** Thrown when a request is attempted without a session at all. */
export class UnauthenticatedError extends Error {
    constructor(message = 'Unauthenticated') {
        super(message);
        this.name = 'UnauthenticatedError';
    }
}
/** Thrown when a stored session was restored but iCloud no longer accepts it. */
export class SessionExpiredError extends Error {
    constructor(message = 'Stored session is no longer valid') {
        super(message);
        this.name = 'SessionExpiredError';
    }
}
/**
 * True for DNS/socket failures and aborts — anything where retrying the
 * existing session is the right move and re-authenticating is actively wrong,
 * because every re-authentication mints a new iCloud web session and Apple
 * emails the account holder a login alert for it.
 */
export function isTransientNetworkError(error) {
    if (!error || typeof error !== 'object')
        return false;
    if (error instanceof ICloudRequestError)
        return error.isTransient;
    const candidate = error;
    for (const value of [candidate.code, candidate.errno]) {
        if (typeof value === 'string' && TRANSIENT_CODES.has(value))
            return true;
    }
    // node-fetch wraps DNS/socket failures as FetchError { type: 'system' }.
    if (candidate.type === 'system')
        return true;
    if (candidate.name === 'AbortError' || candidate.name === 'FetchError')
        return true;
    if (candidate.cause)
        return isTransientNetworkError(candidate.cause);
    return false;
}
/**
 * True when the failure means the session itself is gone. Only these justify
 * throwing the session away and signing in again.
 */
export function isAuthenticationError(error) {
    if (error instanceof UnauthenticatedError)
        return true;
    if (error instanceof SessionExpiredError)
        return true;
    if (error instanceof ICloudRequestError)
        return error.isAuthError;
    return false;
}
//# sourceMappingURL=errors.js.map