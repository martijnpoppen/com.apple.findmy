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
import { AUTH_ENDPOINT, AUTH_HEADERS, COOKIE_URL, DEFAULT_HEADERS, SETUP_ENDPOINT } from './constants.js';
import { GSASRPAuthenticator, } from './gsasrp-authenticator.js';
import { ICloudRequestError } from './errors.js';
import { extractiCloudCookies, fetchOptions } from './utils.js';
import fetch from 'node-fetch';
/**
 * Apple sends each cookie exactly once. `aasp` arrives on signin/init and is
 * NOT repeated on signin/complete once we start echoing it back, so session
 * state has to accumulate across the whole handshake instead of being read
 * off a single response.
 */
class AuthSession {
    constructor() {
        this.cookies = {};
        this.scnt = null;
        this.sid = null;
        this.token = null;
        this.accountCountry = null;
        this.twosvTrustToken = null;
    }
    absorb(res) {
        var _a;
        const raw = res.headers.raw()['set-cookie'] || [];
        for (const line of raw) {
            const pair = (_a = line.split(';')[0]) !== null && _a !== void 0 ? _a : '';
            const i = pair.indexOf('=');
            if (i > 0) {
                this.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
            }
        }
        this.scnt = res.headers.get('scnt') || this.scnt;
        this.sid = res.headers.get('X-Apple-ID-Session-Id') || this.sid;
        this.token = res.headers.get('X-Apple-Session-Token') || this.token;
        this.accountCountry =
            res.headers.get('X-Apple-ID-Account-Country') || this.accountCountry;
        this.twosvTrustToken =
            res.headers.get('X-Apple-TwoSV-Trust-Token') || this.twosvTrustToken;
        return this;
    }
    headers() {
        const h = {};
        if (this.scnt)
            h['scnt'] = this.scnt;
        if (this.sid)
            h['X-Apple-ID-Session-Id'] = this.sid;
        const cookie = Object.entries(this.cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
        if (cookie)
            h['Cookie'] = cookie;
        return h;
    }
}
export function AuthenticateFindMy(username, password, trustToken) {
    return __awaiter(this, void 0, void 0, function* () {
        const authenticator = new GSASRPAuthenticator(username);
        const session = new AuthSession();
        const init = yield AuthInit(authenticator, session);
        yield AuthComplete(authenticator, password, init, session, trustToken);
        return AuthFinish(session, trustToken);
    });
}
function AuthInit(authenticator, session) {
    return __awaiter(this, void 0, void 0, function* () {
        const initData = yield authenticator.getInit();
        const res = yield fetch(AUTH_ENDPOINT + 'signin/init', Object.assign({ headers: AUTH_HEADERS, method: 'POST', body: JSON.stringify(initData) }, fetchOptions));
        session.absorb(res);
        if (!res.ok) {
            throw new Error(`signin/init ${res.status}: ${yield res.text()}`);
        }
        return yield res.json();
    });
}
function AuthComplete(authenticator, password, initResponse, session, trustToken) {
    return __awaiter(this, void 0, void 0, function* () {
        const completeData = yield authenticator.getComplete(password, initResponse);
        // Only opt into remember-me when we actually have a token to present.
        // Without one the previous behaviour is kept verbatim, so a first-time
        // sign-in behaves exactly as it did before.
        const remembered = !!trustToken;
        const res = yield fetch(AUTH_ENDPOINT + 'signin/complete?isRememberMeEnabled=true', Object.assign({ headers: Object.assign(Object.assign({}, AUTH_HEADERS), session.headers()), method: 'POST', body: JSON.stringify(Object.assign(Object.assign({}, completeData), { trustTokens: remembered ? [trustToken] : [], rememberMe: remembered, pause2FA: true })) }, fetchOptions));
        session.absorb(res);
        // 200 = signed in outright.
        // 409 = 2FA would normally be required, but pause2FA still yields a token.
        if (!res.ok && res.status !== 409) {
            throw new Error(`signin/complete ${res.status}: ${yield res.text()}`);
        }
        if (!session.token) {
            throw new Error(`signin/complete ${res.status}: no X-Apple-Session-Token ` +
                `(Apple is enforcing 2FA for this account)`);
        }
        return session;
    });
}
function AuthFinish(session, previousTrustToken) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const trustToken = (_c = (_b = (_a = session.twosvTrustToken) !== null && _a !== void 0 ? _a : session.cookies['aasp']) !== null && _b !== void 0 ? _b : previousTrustToken) !== null && _c !== void 0 ? _c : '';
        const data = Object.assign({ dsWebAuthToken: session.token, trustToken, extended_login: true }, (session.accountCountry
            ? { accountCountryCode: session.accountCountry }
            : {}));
        const response = yield fetch(SETUP_ENDPOINT, Object.assign({ headers: DEFAULT_HEADERS, method: 'POST', body: JSON.stringify(data) }, fetchOptions));
        if (!response.ok) {
            throw new Error(`accountLogin ${response.status}: ${yield response.text()}`);
        }
        session.absorb(response);
        const accountInfo = yield response.json();
        const cookies = new CookieJar();
        for (const cookie of extractiCloudCookies(response)) {
            cookies.setCookieSync(cookie, COOKIE_URL);
        }
        return {
            cookies,
            accountInfo,
            trustToken: (_d = session.twosvTrustToken) !== null && _d !== void 0 ? _d : trustToken,
            sessionToken: (_e = session.token) !== null && _e !== void 0 ? _e : '',
            accountCountry: (_f = session.accountCountry) !== null && _f !== void 0 ? _f : '',
        };
    });
}
/**
 * Mint a fresh set of iCloud cookies from the token the current session was
 * built with, the way pyicloud and icloudpy recover from a 450. This never
 * touches idmsa, so it costs no SRP handshake and no Apple login alert.
 *
 * Returns null when Apple refuses the token — then, and only then, is a real
 * sign-in the answer. Transport failures are thrown so the caller can back off
 * instead of mistaking a flaky connection for a dead token.
 */
export function RenewFindMySession(current) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!current.sessionToken)
            return null;
        const data = Object.assign({ dsWebAuthToken: current.sessionToken, trustToken: (_a = current.trustToken) !== null && _a !== void 0 ? _a : '', extended_login: true }, (current.accountCountry
            ? { accountCountryCode: current.accountCountry }
            : {}));
        const response = yield fetch(SETUP_ENDPOINT, Object.assign({ headers: DEFAULT_HEADERS, method: 'POST', body: JSON.stringify(data) }, fetchOptions));
        if (!response.ok) {
            if (RENEWAL_REFUSED.has(response.status))
                return null;
            throw new ICloudRequestError(SETUP_ENDPOINT, response.status, yield response.text().catch(() => ''));
        }
        const accountInfo = yield response.json();
        const cookies = new CookieJar();
        for (const cookie of extractiCloudCookies(response)) {
            cookies.setCookieSync(cookie, COOKIE_URL);
        }
        return {
            cookies,
            accountInfo,
            trustToken: response.headers.get('X-Apple-TwoSV-Trust-Token') || current.trustToken,
            sessionToken: response.headers.get('X-Apple-Session-Token') || current.sessionToken,
            accountCountry: response.headers.get('X-Apple-ID-Account-Country') ||
                current.accountCountry,
        };
    });
}
const RENEWAL_REFUSED = new Set([401, 403, 421, 450]);
//# sourceMappingURL=findmy-authentication.js.map