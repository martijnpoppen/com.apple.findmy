import { Cookie } from 'tough-cookie';
declare const stringToU8Array: (str: string) => Uint8Array;
declare const base64ToU8Array: (str: string) => Uint8Array;
export { base64ToU8Array, stringToU8Array };
export declare function extractiCloudCookies(response: Response): Cookie[];
//# sourceMappingURL=utils.d.ts.map