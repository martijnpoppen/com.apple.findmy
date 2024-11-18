var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { COOKIE_URL, DEFAULT_HEADERS } from './constants.js';
import { FindMyDevice } from './device.js';
import { AuthenticateFindMy, } from './findmy-authentication.js';
import { extractiCloudCookies, fetchOptions } from './utils.js';
import fetch from 'node-fetch';
export class FindMy {
    constructor() {
        this.authenticatedData = null;
    }
    authenticate(username, password) {
        return __awaiter(this, void 0, void 0, function* () {
            // const resp1 = await fetch('https://ip6.me/api/', {
            //     method: 'GET',
            //     ...fetchOptions
            // });
            // const resp2 = await fetch('https://ip6.me/api/', {});
            // console.log('[Authenticate] ipv4', await resp1.text());
            // console.log('[Authenticate] ipv6', await resp2.text());
            this.authenticatedData = yield AuthenticateFindMy(username, password);
        });
    }
    deauthenticate() {
        this.authenticatedData = null;
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
            if (!this.authenticatedData) {
                throw new Error('Unauthenticated');
            }
            const serviceURI = this.authenticatedData.accountInfo.webservices[service].url;
            const fullEndpoint = serviceURI + endpoint;
            const headers = this.getHeaders(this.authenticatedData.cookies);
            const response = yield fetch(fullEndpoint, Object.assign({ headers: headers, method: 'POST', body: JSON.stringify(request) }, fetchOptions));
            if (!response.ok) {
                throw new Error('Failed to send request');
            }
            const cookies = extractiCloudCookies(response);
            for (let cookie of cookies) {
                this.authenticatedData.cookies.setCookieSync(cookie, COOKIE_URL);
            }
            const reply = yield response.json();
            return reply;
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
            throw new Error('Unauthenticated');
        }
        return this.authenticatedData;
    }
}
//# sourceMappingURL=findmy.js.map