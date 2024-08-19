import { Cookie } from 'tough-cookie';
const stringToU8Array = (str) => new TextEncoder().encode(str);
const base64ToU8Array = (str) => Uint8Array.from(Buffer.from(str, 'base64'));
export { base64ToU8Array, stringToU8Array };
export function extractiCloudCookies(response) {
    const cookies = Array.from(response.headers.entries())
        .filter((v) => v[0].toLowerCase() == 'set-cookie')
        .map((v) => v[1].split(', '))
        .reduce((a, b) => a.concat(b), [])
        .map((v) => Cookie.parse(v))
        .filter((v) => !!v);
    if (cookies.length === 0) {
        throw new Error('Failed to extract iCloud cookies');
    }
    return cookies;
}
//# sourceMappingURL=utils.js.map