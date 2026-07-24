import { CookieJar } from 'tough-cookie';
import { iCloudAccountInfo } from './types/account.types.js';
export interface AuthenticatedData {
    cookies: CookieJar;
    accountInfo: iCloudAccountInfo;
}
export declare function AuthenticateFindMy(username: string, password: string): Promise<AuthenticatedData>;
//# sourceMappingURL=findmy-authentication.d.ts.map