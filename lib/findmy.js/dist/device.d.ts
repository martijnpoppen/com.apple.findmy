import { FindMy } from './findmy.js';
import { iCloudFindMyDeviceInfo } from './types/findmy.types.js';
export declare class FindMyDevice {
    private findmy;
    private info;
    constructor(findmy: FindMy, info: iCloudFindMyDeviceInfo);
    getRawInfo(): iCloudFindMyDeviceInfo;
    getName(): string;
    getID(): string;
    getModel(): {
        name: string;
        exact: string;
    };
    getBattery(): {
        percentage: number;
        status: string;
    };
    getLocation(): {
        lat: number;
        lon: number;
        alt: number;
        accuracy: number;
        verticalAccuracy: number;
    } | null;
    isLocked(): boolean;
    isLost(): boolean;
    playSound(): Promise<void>;
    sendMessage(text?: string, subject?: string): Promise<void>;
    startLostMode(message: string, phoneNumber: string): Promise<void>;
    stopLostMode(): Promise<void>;
}
//# sourceMappingURL=device.d.ts.map