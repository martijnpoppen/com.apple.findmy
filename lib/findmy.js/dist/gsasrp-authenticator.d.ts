export type SRPProtocol = 's2k' | 's2k_fo';
export interface ServerSRPInitRequest {
    a: string;
    accountName: string;
    protocols: SRPProtocol[];
}
export interface ServerSRPInitResponse {
    iteration: number;
    salt: string;
    protocol: SRPProtocol;
    b: string;
    c: string;
}
export interface ServerSRPCompleteRequest {
    accountName: string;
    c: string;
    m1: string;
    m2: string;
    rememberMe: boolean;
    pause2FA: boolean;
    trustTokens: string[];
}
export declare class GSASRPAuthenticator {
    private username;
    constructor(username: string);
    private srpClient?;
    private derivePassword;
    getInit(): Promise<ServerSRPInitRequest>;
    getComplete(password: string, serverData: ServerSRPInitResponse): Promise<Pick<ServerSRPCompleteRequest, 'm1' | 'm2' | 'c' | 'accountName'>>;
}
//# sourceMappingURL=gsasrp-authenticator.d.ts.map