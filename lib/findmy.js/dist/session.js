var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { AccountLockedError, isAuthenticationError, isTransientNetworkError, } from './errors.js';
import { FindMy, SESSION_FORMAT_VERSION, } from './findmy.js';
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
/**
 * How many times signing in may fail to produce a session iCloud accepts
 * before the account is treated as locked. Apple throttles an account that is
 * signed into too often, and past that point every further sign-in extends the
 * lockout instead of fixing it.
 */
export const DEFAULT_LOCKOUT_THRESHOLD = 3;
/**
 * Only backoffs at least this long are written to disk. Below it a restart
 * losing the wait is harmless; above it, losing the wait means a sign-in.
 */
const PERSIST_BACKOFF_ABOVE = 5 * 60 * 1000;
/** How long to leave a locked account alone before probing it once more. */
export const DEFAULT_LOCKOUT_COOLDOWN = 6 * 60 * 60 * 1000;
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
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        this.findmy = null;
        this.credentialsUnproven = false;
        /**
         * Last trust token seen for this account. Held on the session rather than
         * read off the stored file, because a forced sign-in has no stored file to
         * read and would otherwise present itself to Apple as a brand new browser.
         */
        this.trustToken = null;
        /**
         * Kept alongside the trust token and deliberately NOT discarded when
         * iCloud rejects the cookies. These are what allow a silent recovery;
         * throwing them away leaves a full sign-in as the only way back.
         */
        this.sessionToken = null;
        this.accountCountry = null;
        this.healthLoaded = false;
        this.health = {
            errorCount: 0,
            reauths: 0,
            nextAttemptAt: 0,
            lastSessionSave: 0,
            lastError: null,
            signinFailures: 0,
            lockedUntil: 0,
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
        this.lockoutThreshold =
            (_g = options.lockoutThreshold) !== null && _g !== void 0 ? _g : DEFAULT_LOCKOUT_THRESHOLD;
        this.lockoutCooldown =
            (_h = options.lockoutCooldown) !== null && _h !== void 0 ? _h : DEFAULT_LOCKOUT_COOLDOWN;
        this.log = (_j = options.logger) !== null && _j !== void 0 ? _j : (() => { });
        this.now = (_k = options.now) !== null && _k !== void 0 ? _k : (() => Date.now());
        this.createClient = (_l = options.createClient) !== null && _l !== void 0 ? _l : (() => new FindMy());
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
        this.health.signinFailures = 0;
        this.health.lockedUntil = 0;
        // This reset is authoritative from here on: without it the next
        // connect would read the old backoff straight back off disk.
        this.healthLoaded = true;
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
            var _a, _b, _c, _d;
            const stored = yield this.loadStored();
            // Adopt the stored backoff before anything else. Without this a
            // restart starts from zero and signs in immediately, however deep the
            // backoff had got before the process died.
            this.adoptStored(stored);
            this.assertNotLockedOut();
            const findmy = this.createClient();
            const fresh = forceLogin || this.credentialsUnproven;
            const usable = !fresh && stored && stored.cookies && ((_a = stored.accountInfo) === null || _a === void 0 ? void 0 : _a.webservices);
            if (usable) {
                try {
                    findmy.importSession(stored);
                    const ageHours = Math.round((this.now() - stored.createdAt) / 3600000);
                    this.log(`findmy: reusing the stored session (${ageHours}h old), no sign-in needed`);
                    // Deliberately not pre-flighted. Asking a second endpoint
                    // whether the session works risks a false negative that costs
                    // a sign-in and an Apple login alert, and the first real call
                    // answers the same question for free: a rejected session comes
                    // back 401/421/450 and getDevices() recovers from there.
                    this.findmy = findmy;
                    this.markConnected();
                    return;
                }
                catch (error) {
                    this.log('findmy: stored session unusable', error.message);
                }
            }
            // The cookies are gone but the token they were minted from may still
            // be good. Replaying it rebuilds the session without touching idmsa,
            // so it costs no login alert — always worth trying before signing in.
            if (!fresh && this.sessionToken) {
                let rebuilt = false;
                try {
                    rebuilt = yield findmy.renewFromTokens({
                        sessionToken: this.sessionToken,
                        trustToken: (_b = this.trustToken) !== null && _b !== void 0 ? _b : '',
                        accountCountry: (_c = this.accountCountry) !== null && _c !== void 0 ? _c : '',
                    });
                }
                catch (error) {
                    if (isTransientNetworkError(error)) {
                        throw this.noteTransient(error, 'renew');
                    }
                    this.log('findmy: could not rebuild from the stored token', describe(error));
                }
                if (rebuilt) {
                    this.log('findmy: session rebuilt from the stored token, no sign-in needed');
                    this.findmy = findmy;
                    this.captureTokens();
                    this.markConnected();
                    yield this.persist({ force: true });
                    return;
                }
                this.log('findmy: the stored token was refused, a sign-in is needed');
            }
            // Everything cheap has been tried. A sign-in is the expensive option,
            // so it answers to the backoff we just restored from disk.
            if (this.isBackingOff) {
                throw new RetryLaterError('Waiting before signing in again', this.health.nextAttemptAt, this.health.lastError);
            }
            // Counted here because this is the only place a sign-in happens, and
            // the count is what paces them.
            this.health.reauths = this.health.reauths + 1;
            this.log('findmy: signing in. This creates a new iCloud web session and ' +
                'Apple will send the account holder a login alert for it.');
            try {
                // Replaying the previous trust token marks this as a client Apple
                // has already seen rather than a brand new browser.
                yield findmy.authenticate(this.username, this.password, (_d = this.trustToken) !== null && _d !== void 0 ? _d : undefined);
            }
            catch (error) {
                this.findmy = null;
                if (isTransientNetworkError(error)) {
                    throw this.noteTransient(error, 'signin');
                }
                const failure = this.noteReauth(error, 'signin');
                yield this.persist({ force: true });
                throw failure;
            }
            this.findmy = findmy;
            this.captureTokens();
            this.credentialsUnproven = false;
            this.markConnected();
            yield this.persist({ force: true });
        });
    }
    getDevices() {
        return __awaiter(this, arguments, void 0, function* (shouldLocate = true) {
            this.assertNotLockedOut();
            if (this.isBackingOff) {
                throw new RetryLaterError('Still backing off', this.health.nextAttemptAt, this.health.lastError);
            }
            if (!this.isConnected) {
                yield this.connect();
            }
            let renewed = false;
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
                    this.health.errorCount = this.health.errorCount + 1;
                    this.health.lastError = describe(error);
                    // iCloud asking for the session to be re-established is not
                    // the same as asking the account to sign in. Replaying the
                    // token we already hold mints fresh cookies without touching
                    // idmsa, so it costs no login alert. Only once for this call.
                    if (!renewed && this.findmy) {
                        renewed = true;
                        let ok = false;
                        try {
                            ok = yield this.findmy.renewWithToken();
                        }
                        catch (renewError) {
                            throw this.noteTransient(renewError, 'renew');
                        }
                        if (ok) {
                            this.log('findmy: session renewed from the stored token, no sign-in needed');
                            this.markConnected();
                            yield this.persist({ force: true });
                            continue;
                        }
                        this.log('findmy: the stored token was refused, a sign-in is needed');
                    }
                    // Drop the dead cookies but KEEP the tokens: they are the
                    // only way back that does not cost a login alert, and
                    // deleting them is what turned one bad night into a sign-in
                    // on every restart.
                    this.findmy = null;
                    if (this.health.reauths > 0) {
                        // We signed in and iCloud rejected the result anyway.
                        // Enough of those in a row means the account is throttled,
                        // and more sign-ins will only keep it that way.
                        this.health.signinFailures = this.health.signinFailures + 1;
                    }
                    const locked = this.armLockoutIfExhausted();
                    // A session that has been serving fine may simply have aged
                    // out, so the first rejection buys an immediate sign-in. A
                    // rejection right after one does not: that is iCloud refusing
                    // a brand new session, and signing in again only produces
                    // another login alert.
                    const wait = locked
                        ? 0
                        : pick(this.backoff.reauth, this.health.reauths);
                    if (wait > 0) {
                        this.health.nextAttemptAt = this.now() + wait;
                    }
                    // Written only now that the wait is on the clock. Persisting
                    // before this stored a zero, and the next process read that
                    // zero as "go ahead and sign in".
                    yield this.persist({ force: true });
                    if (locked)
                        throw locked;
                    if (wait > 0) {
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
    /**
     * Take the stored tokens and backoff onto this object. Called on every
     * connect so a freshly constructed session (a restart) inherits where the
     * previous process had got to instead of starting clean.
     */
    adoptStored(stored) {
        var _a, _b, _c, _d, _e;
        if (!stored)
            return;
        this.trustToken = stored.trustToken || this.trustToken;
        this.sessionToken = stored.sessionToken || this.sessionToken;
        this.accountCountry = stored.accountCountry || this.accountCountry;
        if (!stored.health || this.healthLoaded)
            return;
        this.healthLoaded = true;
        this.health.reauths = (_a = stored.health.reauths) !== null && _a !== void 0 ? _a : 0;
        this.health.nextAttemptAt = (_b = stored.health.nextAttemptAt) !== null && _b !== void 0 ? _b : 0;
        this.health.signinFailures = (_c = stored.health.signinFailures) !== null && _c !== void 0 ? _c : 0;
        this.health.lockedUntil = (_d = stored.health.lockedUntil) !== null && _d !== void 0 ? _d : 0;
        this.health.lastError = (_e = stored.health.lastError) !== null && _e !== void 0 ? _e : null;
        if (this.isBackingOff) {
            const seconds = Math.round((this.health.nextAttemptAt - this.now()) / 1000);
            this.log(`findmy: resuming the stored backoff, ${seconds}s left`);
        }
    }
    captureTokens() {
        if (!this.findmy)
            return;
        const session = this.findmy.exportSession();
        if (!session)
            return;
        this.trustToken = session.trustToken || this.trustToken;
        this.sessionToken = session.sessionToken || this.sessionToken;
        this.accountCountry = session.accountCountry || this.accountCountry;
    }
    snapshotHealth() {
        return {
            reauths: this.health.reauths,
            nextAttemptAt: this.health.nextAttemptAt,
            signinFailures: this.health.signinFailures,
            lockedUntil: this.health.lockedUntil,
            lastError: this.health.lastError,
        };
    }
    assertNotLockedOut() {
        if (this.health.lockedUntil <= this.now())
            return;
        throw new AccountLockedError('Apple is refusing new sessions for this account. Sign in at ' +
            'https://icloud.com/find to clear it; signing in from here again ' +
            'would only extend the lockout.', this.health.lockedUntil);
    }
    /** Arms the breaker once sign-ins have stopped helping. */
    armLockoutIfExhausted() {
        if (this.health.signinFailures < this.lockoutThreshold)
            return null;
        this.health.lockedUntil = this.now() + this.lockoutCooldown;
        this.health.nextAttemptAt = this.health.lockedUntil;
        const hours = Math.round(this.lockoutCooldown / 3600000);
        this.log(`findmy: ${this.health.signinFailures} sign-ins in a row produced a ` +
            `session iCloud rejected. Treating the account as locked and ` +
            `leaving it alone for ${hours}h.`);
        try {
            this.assertNotLockedOut();
        }
        catch (error) {
            return error;
        }
        return null;
    }
    /** True while the breaker is holding sign-ins off. */
    get isLockedOut() {
        return this.health.lockedUntil > this.now();
    }
    get lockedUntil() {
        return this.health.lockedUntil;
    }
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
        this.health.signinFailures = 0;
        this.health.lockedUntil = 0;
    }
    noteTransient(error, phase) {
        this.health.errorCount = this.health.errorCount + 1;
        this.health.lastError = describe(error);
        this.health.nextAttemptAt =
            this.now() + pick(this.backoff.transient, this.health.errorCount - 1);
        this.log(`findmy: ${phase} failed, keeping the session`, this.health.lastError, `retrying in ${Math.round((this.health.nextAttemptAt - this.now()) / 1000)}s`);
        // Only once the wait is long enough to matter. A minute lost to a
        // restart costs nothing, but an hour-deep outage backoff that resets
        // to zero is how a restart turns into a sign-in.
        if (this.health.nextAttemptAt - this.now() >= PERSIST_BACKOFF_ABOVE) {
            void this.persist({ force: true });
        }
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
            if (!this.store)
                return false;
            if (!force && this.now() - this.health.lastSessionSave < this.sessionSaveInterval) {
                return false;
            }
            const session = this.buildRecord();
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
    /**
     * The record to write. With a live session that is the session itself;
     * without one it is still worth writing, because the tokens and the
     * backoff are exactly what the next process needs in order not to sign in.
     */
    buildRecord() {
        var _a, _b, _c, _d, _e;
        const live = (_b = (_a = this.findmy) === null || _a === void 0 ? void 0 : _a.exportSession()) !== null && _b !== void 0 ? _b : null;
        if (live)
            return Object.assign(Object.assign({}, live), { health: this.snapshotHealth() });
        if (!this.sessionToken && !this.trustToken && !this.health.nextAttemptAt) {
            return null;
        }
        return {
            version: SESSION_FORMAT_VERSION,
            cookies: null,
            accountInfo: null,
            trustToken: (_c = this.trustToken) !== null && _c !== void 0 ? _c : '',
            sessionToken: (_d = this.sessionToken) !== null && _d !== void 0 ? _d : '',
            accountCountry: (_e = this.accountCountry) !== null && _e !== void 0 ? _e : '',
            createdAt: this.now(),
            health: this.snapshotHealth(),
        };
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