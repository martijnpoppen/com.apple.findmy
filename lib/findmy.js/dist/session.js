var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { isAuthenticationError, isTransientNetworkError } from './errors.js';
import { FindMy } from './findmy.js';
/**
 * Apple emails the account holder a login alert for every new iCloud web
 * session, which makes a sign-in the most expensive thing this library can
 * do. A network failure therefore waits and keeps the session, and repeated
 * sign-ins slow down hard so a wrong password cannot turn into a stream of
 * alerts.
 */
export const DEFAULT_BACKOFF = {
    transient: [60000, 120000, 300000, 600000, 900000],
    reauth: [0, 300000, 900000, 1800000, 3600000],
};
export const DEFAULT_SESSION_SAVE_INTERVAL = 30 * 60 * 1000;
const pick = (schedule, attempt) => {
    var _a;
    if (schedule.length === 0)
        return 0;
    const index = Math.min(Math.max(attempt, 0), schedule.length - 1);
    return (_a = schedule[index]) !== null && _a !== void 0 ? _a : 0;
};
/**
 * Thrown when the call could not be served but the session is still worth
 * keeping. Callers should skip this account until `nextAttemptAt` and must
 * not treat it as a reason to sign in again.
 */
export class RetryLaterError extends Error {
    constructor(message, nextAttemptAt, reason) {
        super(message);
        this.name = 'RetryLaterError';
        this.nextAttemptAt = nextAttemptAt;
        this.reason = reason;
    }
}
/**
 * A Find My connection that looks after itself: it restores a stored session
 * instead of signing in, tells an expired session apart from a flaky network,
 * and backs off rather than reconnecting in a loop.
 */
export class FindMySession {
    constructor(options) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        this.findmy = null;
        this.credentialsUnproven = false;
        /**
         * Last trust token seen for this account. Held on the session rather than
         * read off the stored file, because a forced sign-in has no stored file to
         * read and would otherwise present itself to Apple as a brand new browser.
         */
        this.trustToken = null;
        this.health = {
            errorCount: 0,
            reauths: 0,
            nextAttemptAt: 0,
            lastSessionSave: 0,
            lastError: null,
        };
        this.key = options.key;
        this.username = options.username;
        this.password = options.password;
        this.store = (_a = options.store) !== null && _a !== void 0 ? _a : null;
        this.backoff = {
            transient: (_c = (_b = options.backoff) === null || _b === void 0 ? void 0 : _b.transient) !== null && _c !== void 0 ? _c : DEFAULT_BACKOFF.transient,
            reauth: (_e = (_d = options.backoff) === null || _d === void 0 ? void 0 : _d.reauth) !== null && _e !== void 0 ? _e : DEFAULT_BACKOFF.reauth,
        };
        this.sessionSaveInterval =
            (_f = options.sessionSaveInterval) !== null && _f !== void 0 ? _f : DEFAULT_SESSION_SAVE_INTERVAL;
        this.log = (_g = options.logger) !== null && _g !== void 0 ? _g : (() => { });
        this.now = (_h = options.now) !== null && _h !== void 0 ? _h : (() => Date.now());
        this.createClient = (_j = options.createClient) !== null && _j !== void 0 ? _j : (() => new FindMy());
    }
    /** The underlying client, for calls this wrapper does not cover. */
    get client() {
        return this.findmy;
    }
    get isConnected() {
        var _a;
        return !!((_a = this.findmy) === null || _a === void 0 ? void 0 : _a.isAuthenticated());
    }
    get nextAttemptAt() {
        return this.health.nextAttemptAt;
    }
    get isBackingOff() {
        return this.health.nextAttemptAt > this.now();
    }
    get lastError() {
        return this.health.lastError;
    }
    setCredentials(username, password) {
        if (username === this.username && password === this.password)
            return;
        this.username = username;
        this.password = password;
        // New credentials are new information. An account that was waiting
        // out a rejected password should not keep waiting on the old one.
        this.health.errorCount = 0;
        this.health.reauths = 0;
        this.health.nextAttemptAt = 0;
        this.health.lastError = null;
        // A stored session that still works would otherwise let a wrong
        // password pair successfully and fail later. Drop the live one too,
        // or the next call would just keep using it. The trust token is kept:
        // it identifies the client, not the password.
        this.credentialsUnproven = true;
        this.findmy = null;
    }
    termsUpdateNeeded() {
        var _a;
        return !!((_a = this.findmy) === null || _a === void 0 ? void 0 : _a.termsUpdateNeeded());
    }
    /**
     * Restore the stored session, and sign in only when there is nothing to
     * restore. Whether iCloud still accepts it is answered by the first real
     * call rather than by a pre-flight, so a restore never costs a request and
     * never produces a false negative worth an Apple login alert.
     */
    connect() {
        return __awaiter(this, arguments, void 0, function* ({ forceLogin = false } = {}) {
            var _a;
            const findmy = this.createClient();
            const skipStored = forceLogin || this.credentialsUnproven;
            const stored = skipStored ? null : yield this.loadStored();
            if (stored) {
                try {
                    findmy.importSession(stored);
                    this.trustToken = stored.trustToken || this.trustToken;
                    const ageHours = Math.round((this.now() - stored.createdAt) / 3600000);
                    this.log(`findmy: reusing the stored session (${ageHours}h old), no sign-in needed`);
                    // Deliberately not pre-flighted. Asking a second endpoint
                    // whether the session works risks a false negative that costs
                    // a sign-in and an Apple login alert, and the first real call
                    // answers the same question for free: a rejected session comes
                    // back 401/421/450 and getDevices() signs in and retries.
                    this.findmy = findmy;
                    this.markConnected();
                    return;
                }
                catch (error) {
                    this.log('findmy: stored session unusable', error.message);
                }
            }
            yield this.clearStored();
            // Counted here because this is the only place a sign-in happens, and
            // the count is what paces them.
            this.health.reauths = this.health.reauths + 1;
            this.log('findmy: signing in. This creates a new iCloud web session and ' +
                'Apple will send the account holder a login alert for it.');
            try {
                // Replaying the previous trust token marks this as a client Apple
                // has already seen rather than a brand new browser.
                yield findmy.authenticate(this.username, this.password, (_a = this.trustToken) !== null && _a !== void 0 ? _a : undefined);
            }
            catch (error) {
                this.findmy = null;
                if (isTransientNetworkError(error)) {
                    throw this.noteTransient(error, 'signin');
                }
                throw this.noteReauth(error, 'signin');
            }
            this.findmy = findmy;
            this.trustToken = findmy.getTrustToken() || this.trustToken;
            this.credentialsUnproven = false;
            this.markConnected();
            yield this.persist({ force: true });
        });
    }
    /**
     * Fetch the account's devices, connecting or reconnecting as needed.
     * Raises RetryLaterError when the caller should skip this round instead
     * of trying harder.
     */
    getDevices() {
        return __awaiter(this, arguments, void 0, function* (shouldLocate = true) {
            if (this.isBackingOff) {
                throw new RetryLaterError('Still backing off', this.health.nextAttemptAt, this.health.lastError);
            }
            if (!this.isConnected) {
                yield this.connect();
            }
            for (;;) {
                try {
                    const devices = yield this.findmy.getDevices(shouldLocate);
                    this.markHealthy();
                    yield this.persist();
                    return devices;
                }
                catch (error) {
                    if (!isAuthenticationError(error)) {
                        // Transient, or something we do not recognise. Either way
                        // the session is still the best one we have, so keep it.
                        throw this.noteTransient(error, 'refresh');
                    }
                    this.findmy = null;
                    yield this.clearStored();
                    this.health.errorCount = this.health.errorCount + 1;
                    this.health.lastError = describe(error);
                    // A session that has been serving fine may simply have aged
                    // out, so the first rejection buys an immediate sign-in. A
                    // rejection right after one does not: that is iCloud refusing
                    // a brand new session, and signing in again only produces
                    // another login alert.
                    const wait = pick(this.backoff.reauth, this.health.reauths);
                    if (wait > 0) {
                        this.health.nextAttemptAt = this.now() + wait;
                        throw new RetryLaterError('Session rejected; waiting before signing in again', this.health.nextAttemptAt, error);
                    }
                    this.log('findmy: session rejected by iCloud, signing in again', this.health.lastError);
                    yield this.connect({ forceLogin: true });
                }
            }
        });
    }
    /** Drop the in-memory session but keep the stored one. */
    disconnect() {
        var _a;
        (_a = this.findmy) === null || _a === void 0 ? void 0 : _a.deauthenticate();
        this.findmy = null;
    }
    /** Drop the session and forget it, so the next connect signs in. */
    forget() {
        return __awaiter(this, void 0, void 0, function* () {
            this.disconnect();
            yield this.clearStored();
        });
    }
    // ---------------- internals ----------------
    /** Connected, but not yet proven to actually serve data. */
    markConnected() {
        this.health.errorCount = 0;
        this.health.nextAttemptAt = 0;
        this.health.lastError = null;
    }
    /**
     * A completed round trip. Only this clears the sign-in counter — clearing
     * it on connect would let a session that is rejected immediately after
     * every sign-in earn a fresh sign-in every round.
     */
    markHealthy() {
        this.markConnected();
        this.health.reauths = 0;
    }
    noteTransient(error, phase) {
        this.health.errorCount = this.health.errorCount + 1;
        this.health.lastError = describe(error);
        this.health.nextAttemptAt =
            this.now() + pick(this.backoff.transient, this.health.errorCount - 1);
        this.log(`findmy: ${phase} failed, keeping the session`, this.health.lastError, `retrying in ${Math.round((this.health.nextAttemptAt - this.now()) / 1000)}s`);
        return new RetryLaterError(this.health.lastError, this.health.nextAttemptAt, error);
    }
    noteReauth(error, phase) {
        this.health.errorCount = this.health.errorCount + 1;
        this.health.lastError = describe(error);
        this.health.nextAttemptAt =
            this.now() + pick(this.backoff.reauth, this.health.reauths);
        this.log(`findmy: ${phase} failed`, this.health.lastError);
        return error;
    }
    loadStored() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.store)
                return null;
            try {
                return (_a = (yield this.store.load(this.key))) !== null && _a !== void 0 ? _a : null;
            }
            catch (error) {
                this.log('findmy: could not read the stored session', describe(error));
                return null;
            }
        });
    }
    persist() {
        return __awaiter(this, arguments, void 0, function* ({ force = false } = {}) {
            if (!this.store || !this.findmy)
                return false;
            if (!force && this.now() - this.health.lastSessionSave < this.sessionSaveInterval) {
                return false;
            }
            const session = this.findmy.exportSession();
            if (!session)
                return false;
            try {
                yield this.store.save(this.key, session);
                this.health.lastSessionSave = this.now();
                return true;
            }
            catch (error) {
                this.log('findmy: could not store the session', describe(error));
                return false;
            }
        });
    }
    clearStored() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.store)
                return;
            try {
                yield this.store.clear(this.key);
            }
            catch (error) {
                this.log('findmy: could not clear the stored session', describe(error));
            }
        });
    }
}
const describe = (error) => (error instanceof Error && error.message) || String(error);
//# sourceMappingURL=session.js.map