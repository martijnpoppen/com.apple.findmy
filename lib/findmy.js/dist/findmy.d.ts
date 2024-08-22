import { FindMyDevice } from './device.js';
import { iCloudAccountInfo } from './types/account.types.js';
export declare class FindMy {
    private authenticatedData;
    authenticate(username: string, password: string): Promise<void>;
    deauthenticate(): void;
    isAuthenticated(): boolean;
    getRawAccountInfo(): iCloudAccountInfo;
    getUserInfo(): {
        appleId: {
            main: string;
            alias: string[];
        };
        email: string;
        localization: {
            language: string;
            locale: string;
            country: string;
        };
        name: {
            full: string;
            first: string;
            last: string;
        };
    };
    getDevices(shouldLocate?: boolean): Promise<Array<FindMyDevice>>;
    sendICloudRequest(service: keyof iCloudAccountInfo['webservices'], endpoint: string, request: Record<string, unknown>): Promise<any>;
    private getHeaders;
    private get authOrThrow();
}
//# sourceMappingURL=findmy.d.ts.map