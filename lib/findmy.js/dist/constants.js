export const CLIENT_ID = 'd39ba9916b7251055b22c7f910e2ea796ee65e98b2ddecea8f5dde8d9d1a815d';
export const OAUTH_STATE = `auth-${crypto.randomUUID()}`;
export const AUTH_ENDPOINT = 'https://idmsa.apple.com/appleauth/auth/';
export const SETUP_ENDPOINT = 'https://setup.icloud.com/setup/ws/1/accountLogin';
export const VALIDATE_ENDPOINT = 'https://setup.icloud.com/setup/ws/1/validate';
export const GET_TERMS_SETUP_ENDPOINT = 'https://setup.icloud.com/setup/ws/1/getTerms';
export const ACCEPT_TERMS_ENDPOINT = 'https://setup.icloud.com/setup/ws/1/repairDone';
export const COOKIE_URL = 'https://www.icloud.com';
export const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    Accept: 'application/json, text/javascript',
    'Content-Type': 'application/json',
    Origin: 'https://www.icloud.com',
};
export const AUTH_HEADERS = Object.assign(Object.assign({}, DEFAULT_HEADERS), { Origin: 'https://idmsa.apple.com', Referer: 'https://idmsa.apple.com/', 'X-Apple-Widget-Key': CLIENT_ID, 'X-Apple-OAuth-Client-Id': CLIENT_ID, 'X-Apple-OAuth-Client-Type': 'firstPartyAuth', 'X-Apple-OAuth-Redirect-URI': 'https://www.icloud.com', 'X-Apple-OAuth-Require-Grant-Code': 'true', 'X-Apple-OAuth-Response-Mode': 'web_message', 'X-Apple-OAuth-Response-Type': 'code', 'X-Apple-OAuth-State': OAUTH_STATE });
//# sourceMappingURL=constants.js.map