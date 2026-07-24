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
export function collectSetCookie(res) {
    const raw = res.headers.raw ? res.headers.raw()['set-cookie']
        : res.headers.getSetCookie ? res.headers.getSetCookie()
            : [];
    return (raw || []).map((c) => c.split(';')[0]).join('; ');
}
export function sessionHeaders(res) {
    const h = {};
    const scnt = res.headers.get('scnt');
    const sid = res.headers.get('X-Apple-ID-Session-Id');
    const cookie = collectSetCookie(res);
    if (scnt)
        h['scnt'] = scnt;
    if (sid)
        h['X-Apple-ID-Session-Id'] = sid;
    if (cookie)
        h['Cookie'] = cookie;
    return h;
}
export function AuthenticateFindMy(username, password) {
    return __awaiter(this, void 0, void 0, function* () {
        const auth = new GSASRPAuthenticator(username);
        const { init, session } = yield AuthInit(auth);
        const complete = yield AuthComplete(auth, password, init, session);
        return AuthFinish(complete);
    });
}
function AuthInit(authenticator) {
    return __awaiter(this, void 0, void 0, function* () {
        const initData = yield authenticator.getInit();
        const res = yield fetch(AUTH_ENDPOINT + 'signin/init', Object.assign({ headers: AUTH_HEADERS, method: 'POST', body: JSON.stringify(initData) }, fetchOptions));
        if (!res.ok) {
            throw new Error(`signin/init ${res.status}: ${yield res.text()}`);
        }
        return { init: yield res.json(), session: sessionHeaders(res) };
    });
}
function AuthComplete(authenticator, password, initResponse, session) {
    return __awaiter(this, void 0, void 0, function* () {
        const completeData = yield authenticator.getComplete(password, initResponse);
        const res = yield fetch(AUTH_ENDPOINT + 'signin/complete?isRememberMeEnabled=true', Object.assign({ headers: Object.assign(Object.assign({}, AUTH_HEADERS), session), method: 'POST', body: JSON.stringify(Object.assign(Object.assign({}, completeData), { trustTokens: [], rememberMe: true, pause2FA: true })) }, fetchOptions));
        if (res.status === 409 && !res.headers.get('X-Apple-Session-Token')) {
            throw new Error('2FA_REQUIRED'); // only then prompt for a code
        }
        // Both 200 and 409 are valid responses
        if (!res.ok && res.status !== 409) {
            throw new Error('Failed to authenticate');
        }
        return extractAuthData(res);
    });
}
function extractAuthData(response) {
    var _a, _b;
    const sessionId = response.headers.get('X-Apple-Session-Token');
    const scnt = response.headers.get('scnt');
    const cookies = response.headers.raw()['set-cookie'] || [];
    const aasp = (_b = (_a = cookies.find(c => c.startsWith('aasp='))) === null || _a === void 0 ? void 0 : _a.split('aasp=')[1]) === null || _b === void 0 ? void 0 : _b.split(';')[0];
    if (response.status === 409)
        throw new Error('2FA_REQUIRED');
    if (response.status === 412)
        throw new Error('ACCOUNT_REPAIR_REQUIRED');
    if (!sessionId || !scnt || !aasp) {
        throw new Error(`missing auth data (status ${response.status}) ` +
            `token=${!!sessionId} scnt=${!!scnt} aasp=${!!aasp}`);
    }
    return { sessionId, sessionToken: sessionId, scnt, aasp };
}
function AuthFinish(authData) {
    return __awaiter(this, void 0, void 0, function* () {
        const data = {
            dsWebAuthToken: authData.sessionId,
            trustToken: authData.aasp,
        };
        const response = yield fetch(SETUP_ENDPOINT, Object.assign({ headers: DEFAULT_HEADERS, method: 'POST', body: JSON.stringify(data) }, fetchOptions));
        if (!response.ok || !response) {
            throw new Error('Failed to finish iCloud authentication');
        }
        // @ts-ignore
        const accountInfo = yield response.json();
        const cookies = new CookieJar();
        for (let cookie of extractiCloudCookies(response)) {
            cookies.setCookieSync(cookie, COOKIE_URL);
        }
        return {
            cookies,
            accountInfo,
        };
    });
}
//# sourceMappingURL=findmy-authentication.js.map