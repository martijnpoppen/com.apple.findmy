var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class FindMyDevice {
    constructor(findmy, info) {
        this.findmy = findmy;
        this.info = info;
    }
    getRawInfo() {
        return this.info;
    }
    getName() {
        return this.info.name;
    }
    getID() {
        return this.info.id;
    }
    getModel() {
        return {
            name: this.info.modelDisplayName,
            exact: this.info.deviceModel,
        };
    }
    getBattery() {
        return {
            percentage: this.info.batteryLevel * 100,
            status: this.info.batteryStatus,
        };
    }
    getLocation() {
        if (!this.info.location)
            return null;
        if (this.info.location.latitude === 0 || this.info.location.longitude === 0)
            return null;
        return {
            lat: this.info.location.latitude,
            lon: this.info.location.longitude,
            alt: this.info.location.altitude,
            accuracy: this.info.location.horizontalAccuracy,
            verticalAccuracy: this.info.location.verticalAccuracy,
        };
    }
    isLocked() {
        return this.info.activationLocked;
    }
    isLost() {
        return this.info.lostModeCapable;
    }
    playSound() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const result = (yield this.findmy.sendICloudRequest('findme', '/fmipservice/client/web/playSound', {
                device: this.info.id,
                subject: 'Find My iPhone Alert',
                clientContext: {
                    appVersion: '1.0',
                    contextApp: 'com.icloud.web.fmf',
                },
            }));
            this.info = (_a = result.content[0]) !== null && _a !== void 0 ? _a : this.info;
        });
    }
    sendMessage() {
        return __awaiter(this, arguments, void 0, function* (text = 'Hello findmy.js', subject = 'Find My iPhone Alert') {
            var _a;
            const result = (yield this.findmy.sendICloudRequest('findme', '/fmipservice/client/web/sendMessage', {
                device: this.info.id,
                clientContext: {
                    appVersion: '1.0',
                    contextApp: 'com.icloud.web.fmf',
                },
                vibrate: true,
                userText: true,
                sound: false,
                subject,
                text,
            }));
            this.info = (_a = result.content[0]) !== null && _a !== void 0 ? _a : this.info;
        });
    }
    startLostMode(message, phoneNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const result = (yield this.findmy.sendICloudRequest('findme', '/fmipservice/client/web/lostDevice', {
                device: this.info.id,
                clientContext: {
                    appVersion: '1.0',
                    contextApp: 'com.icloud.web.fmf',
                },
                emailUpdates: true,
                lostModeEnabled: true,
                ownerNbr: phoneNumber,
                text: message,
                trackingEnabled: true,
                userText: true,
            }));
            this.info = (_a = result.content[0]) !== null && _a !== void 0 ? _a : this.info;
        });
    }
    stopLostMode() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const result = (yield this.findmy.sendICloudRequest('findme', '/fmipservice/client/web/lostDevice', {
                device: this.info.id,
                clientContext: {
                    appVersion: '1.0',
                    contextApp: 'com.icloud.web.fmf',
                },
                lostModeEnabled: false,
                emailUpdates: false,
                trackingEnabled: false,
                userText: false,
            }));
            this.info = (_a = result.content[0]) !== null && _a !== void 0 ? _a : this.info;
        });
    }
}
//# sourceMappingURL=device.js.map