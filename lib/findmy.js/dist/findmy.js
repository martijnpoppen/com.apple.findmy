var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { CookieJar } from 'tough-cookie';
import { COOKIE_URL, DEFAULT_HEADERS, VALIDATE_ENDPOINT } from './constants.js';
import { FindMyDevice } from './device.js';
import { AuthenticateFindMy, RenewFindMySession, } from './findmy-authentication.js';
import { ICloudRequestError, SessionExpiredError, UnauthenticatedError, } from './errors.js';
import { extractiCloudCookies, fetchOptions } from './utils.js';
import fetch from 'node-fetch';
export const SESSION_FORMAT_VERSION = 1;
export class FindMy {
    constructor() {
        this.authenticatedData = null;
        this.sessionCreatedAt = null;
    }
    authenticate(username, password, trustToken) {
        return __awaiter(this, void 0, void 0, function* () {
            this.authenticatedData = yield AuthenticateFindMy(username, password, trustToken);
            this.sessionCreatedAt = Date.now();
        });
    }
    deauthenticate() {
        this.authenticatedData = null;
        this.sessionCreatedAt = null;
    }
    /**
     * Dump the live session so the caller can store it and hand it back after
     * a restart instead of signing in again.
     */
    exportSession() {
        var _a;
        if (!this.authenticatedData)
            return null;
        return {
            version: SESSION_FORMAT_VERSION,
            cookies: this.authenticatedData.cookies.toJSON(),
            accountInfo: this.authenticatedData.accountInfo,
            trustToken: this.authenticatedData.trustToken,
            sessionToken: this.authenticatedData.sessionToken,
            accountCountry: this.authenticatedData.accountCountry,
            createdAt: (_a = this.sessionCreatedAt) !== null && _a !== void 0 ? _a : Date.now(),
        };
    }
    /**
     * Restore a previously exported session. This does not talk to Apple —
     * call `validateSession()` afterwards to confirm iCloud still accepts it.
     */
    importSession(session) {
        var _a, _b, _c, _d, _e;
        if (!session || session.version !== SESSION_FORMAT_VERSION) {
            throw new SessionExpiredError('Unsupported stored session format');
        }
        if (!session.cookies || !((_a = session.accountInfo) === null || _a === void 0 ? void 0 : _a.webservices)) {
            throw new SessionExpiredError('Stored session is incomplete');
        }
        this.authenticatedData = {
            cookies: CookieJar.fromJSON(session.cookies),
            accountInfo: session.accountInfo,
            trustToken: (_b = session.trustToken) !== null && _b !== void 0 ? _b : '',
            sessionToken: (_c = session.sessionToken) !== null && _c !== void 0 ? _c : '',
            accountCountry: (_d = session.accountCountry) !== null && _d !== void 0 ? _d : '',
        };
        this.sessionCreatedAt = (_e = session.createdAt) !== null && _e !== void 0 ? _e : Date.now();
    }
    /**
     * Cheap round trip that tells us whether the restored cookies are still
     * good, the same way pyicloud validates a stored token before falling
     * back to a credential sign-in. Returns false on 401/421/450; anything
     * else (a DNS failure, a 503) is rethrown so callers can back off rather
     * than mistake it for an expired session.
     */
    validateSession() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.authenticatedData)
                return false;
            try {
                const accountInfo = (yield this.sendRequest(VALIDATE_ENDPOINT, null));
                if (accountInfo === null || accountInfo === void 0 ? void 0 : accountInfo.webservices) {
                    this.authenticatedData.accountInfo = accountInfo;
                }
                return true;
            }
            catch (error) {
                if (error instanceof ICloudRequestError && error.isAuthError) {
                    return false;
                }
                throw error;
            }
        });
    }
    /**
     * Mint fresh cookies from the token this session was built with. This is
     * the right answer to a 450 from Find My: iCloud is asking for the session
     * to be re-established, not for the account to sign in again, and doing it
     * this way costs no Apple login alert.
     *
     * Returns false when Apple refuses the token, which is the only case where
     * a real sign-in is warranted.
     */
    renewWithToken() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!((_a = this.authenticatedData) === null || _a === void 0 ? void 0 : _a.sessionToken))
                return false;
            const renewed = yield RenewFindMySession(this.authenticatedData);
            if (!renewed)
                return false;
            this.authenticatedData = renewed;
            this.sessionCreatedAt = Date.now();
            return true;
        });
    }
    /** Age of the current session in milliseconds, or null when there is none. */
    getSessionAge() {
        return this.sessionCreatedAt === null
            ? null
            : Date.now() - this.sessionCreatedAt;
    }
    getTrustToken() {
        var _a;
        return ((_a = this.authenticatedData) === null || _a === void 0 ? void 0 : _a.trustToken) || null;
    }
    termsUpdateNeeded() {
        var _a;
        if (!this.authenticatedData)
            return false;
        return !!((_a = this.authenticatedData.accountInfo) === null || _a === void 0 ? void 0 : _a.termsUpdateNeeded);
    }
    isAuthenticated() {
        return !!this.authenticatedData;
    }
    getRawAccountInfo() {
        return this.authOrThrow.accountInfo;
    }
    getUserInfo() {
        const data = this.authOrThrow.accountInfo;
        return {
            appleId: {
                main: data.dsInfo.appleId,
                alias: data.dsInfo.appleIdAliases,
            },
            email: data.dsInfo.primaryEmail,
            localization: {
                language: data.dsInfo.languageCode,
                locale: data.dsInfo.locale,
                country: data.dsInfo.countryCode,
            },
            name: {
                full: data.dsInfo.fullName,
                first: data.dsInfo.firstName,
                last: data.dsInfo.lastName,
            },
        };
    }
    getDevices() {
        return __awaiter(this, arguments, void 0, function* (shouldLocate = true) {
            const result = (yield this.sendICloudRequest('findme', '/fmipservice/client/web/refreshClient', {
                clientContext: {
                    fmly: true,
                    shouldLocate,
                    deviceListVersion: 1,
                    selectedDevice: 'all',
                },
            }));
            if (!result || !result.content) {
                throw new Error('Failed to get devices');
            }
            return result.content.map((device) => new FindMyDevice(this, device));
        });
    }
    sendICloudRequest(service, endpoint, request) {
        return __awaiter(this, void 0, void 0, function* () {
            const serviceURI = this.authOrThrow.accountInfo.webservices[service].url;
            return this.sendRequest(serviceURI + endpoint, request);
        });
    }
    sendRequest(fullEndpoint, request) {
        return __awaiter(this, void 0, void 0, function* () {
            const authenticatedData = this.authOrThrow;
            const headers = this.getHeaders(authenticatedData.cookies);
            const response = yield fetch(fullEndpoint, Object.assign({ headers: headers, method: 'POST', body: request === null ? 'null' : JSON.stringify(request) }, fetchOptions));
            if (!response.ok) {
                // Carry the status through. Without it callers cannot tell an
                // expired session (re-authenticate) from a server wobble (retry),
                // and re-authenticating on a wobble is what spams the account
                // holder with Apple login alerts.
                throw new ICloudRequestError(fullEndpoint, response.status, yield response.text().catch(() => ''));
            }
            // /validate answers without cookies when nothing changed.
            try {
                for (const cookie of extractiCloudCookies(response)) {
                    authenticatedData.cookies.setCookieSync(cookie, COOKIE_URL);
                }
            }
            catch (_a) {
                // No Set-Cookie on this response; the jar stays as it is.
            }
            return yield response.json();
        });
    }
    getHeaders(jar) {
        const cookies = jar.getCookiesSync(COOKIE_URL);
        return Object.assign(Object.assign({}, DEFAULT_HEADERS), { Cookie: cookies
                .filter((a) => a.value)
                .map((cookie) => cookie.cookieString())
                .join('; ') });
    }
    get authOrThrow() {
        if (!this.authenticatedData) {
            throw new UnauthenticatedError();
        }
        return this.authenticatedData;
    }
}
//# sourceMappingURL=findmy.js.map