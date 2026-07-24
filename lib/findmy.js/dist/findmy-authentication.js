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
export function AuthenticateFindMy(username, password) {
    return __awaiter(this, void 0, void 0, function* () {
        const authenticator = new GSASRPAuthenticator(username);
        const session = new AuthSession();
        const init = yield AuthInit(authenticator, session);
        yield AuthComplete(authenticator, password, init, session);
        return AuthFinish(session);
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
function AuthComplete(authenticator, password, initResponse, session) {
    return __awaiter(this, void 0, void 0, function* () {
        const completeData = yield authenticator.getComplete(password, initResponse);
        const res = yield fetch(AUTH_ENDPOINT + 'signin/complete?isRememberMeEnabled=true', Object.assign({ headers: Object.assign(Object.assign({}, AUTH_HEADERS), session.headers()), method: 'POST', body: JSON.stringify(Object.assign(Object.assign({}, completeData), { trustTokens: [], rememberMe: false, pause2FA: true })) }, fetchOptions));
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
function AuthFinish(session) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const data = {
            dsWebAuthToken: session.token,
            trustToken: (_a = session.cookies['aasp']) !== null && _a !== void 0 ? _a : '',
            extended_login: true,
        };
        const response = yield fetch(SETUP_ENDPOINT, Object.assign({ headers: DEFAULT_HEADERS, method: 'POST', body: JSON.stringify(data) }, fetchOptions));
        if (!response.ok) {
            throw new Error(`accountLogin ${response.status}: ${yield response.text()}`);
        }
        const accountInfo = yield response.json();
        const cookies = new CookieJar();
        for (const cookie of extractiCloudCookies(response)) {
            cookies.setCookieSync(cookie, COOKIE_URL);
        }
        return { cookies, accountInfo };
    });
}
//# sourceMappingURL=findmy-authentication.js.map