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
import fetch from 'cross-fetch';
import { AUTH_ENDPOINT, AUTH_HEADERS, COOKIE_URL, DEFAULT_HEADERS, SETUP_ENDPOINT, } from './constants.js';
import { GSASRPAuthenticator, } from './gsasrp-authenticator.js';
import { extractiCloudCookies } from './utils.js';
export function AuthenticateFindMy(username, password) {
    return __awaiter(this, void 0, void 0, function* () {
        const gsasrpAuthenticator = new GSASRPAuthenticator(username);
        const init = yield AuthInit(gsasrpAuthenticator);
        const complete = yield AuthComplete(gsasrpAuthenticator, password, init);
        const result = yield AuthFinish(complete);
        return result;
    });
}
function AuthInit(authenticator) {
    return __awaiter(this, void 0, void 0, function* () {
        const initData = yield authenticator.getInit();
        const initResponse = yield fetch(AUTH_ENDPOINT + 'signin/init', {
            headers: AUTH_HEADERS,
            method: 'POST',
            body: JSON.stringify(initData),
        });
        if (!initResponse.ok) {
            console.log('authInit failed', initResponse);
            throw new Error('Failed to authenticate');
        }
        return yield initResponse.json();
    });
}
function AuthComplete(authenticator, password, initResponse) {
    return __awaiter(this, void 0, void 0, function* () {
        const completeData = yield authenticator.getComplete(password, initResponse);
        const authData = Object.assign(Object.assign({}, completeData), { trustTokens: [], rememberMe: false, pause2FA: true });
        const completeResponse = yield fetch(AUTH_ENDPOINT + 'signin/complete?isRememberMeEnabled=true', {
            headers: AUTH_HEADERS,
            method: 'POST',
            body: JSON.stringify(authData),
        });
        // Both 200 and 409 are valid responses
        if (!completeResponse.ok && completeResponse.status !== 409) {
            console.log('authComplete failed', completeResponse);
            throw new Error('Failed to authenticate');
        }
        return extractAuthData(completeResponse);
    });
}
function extractAuthData(response) {
    var _a;
    try {
        const sessionId = response.headers.get('X-Apple-Session-Token');
        const sessionToken = sessionId;
        const scnt = response.headers.get('scnt');
        const headers = Array.from(response.headers.values());
        const aaspCookie = headers.find((v) => v.includes('aasp='));
        const aasp = (_a = aaspCookie === null || aaspCookie === void 0 ? void 0 : aaspCookie.split('aasp=')[1]) === null || _a === void 0 ? void 0 : _a.split(';')[0];
        if (!sessionId || !sessionToken || !scnt || !aasp) {
            throw new Error('Failed to extract auth data');
        }
        return { sessionId, sessionToken, scnt, aasp };
    }
    catch (e) {
        throw new Error('Failed to extract auth data');
    }
}
function AuthFinish(authData) {
    return __awaiter(this, void 0, void 0, function* () {
        const data = {
            dsWebAuthToken: authData.sessionId,
            trustToken: authData.aasp,
        };
        const response = yield fetch(SETUP_ENDPOINT, {
            headers: DEFAULT_HEADERS,
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            throw new Error('Failed to finish iCloud authentication');
        }
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