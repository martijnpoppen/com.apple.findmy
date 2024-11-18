import { Cookie } from 'tough-cookie';
import { Response } from 'node-fetch';
import https from 'https';
declare const stringToU8Array: (str: string) => Uint8Array;
declare const base64ToU8Array: (str: string) => Uint8Array;
export { base64ToU8Array, stringToU8Array };
export declare function extractiCloudCookies(response: Response): Cookie[];
export declare const fetchOptions: {
    agent: https.Agent;
};
//# sourceMappingURL=utils.d.ts.map