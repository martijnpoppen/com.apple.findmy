'use strict';

import Homey from 'homey';
import { encrypt, shortenString } from '../../lib/helpers.mjs';

class FindMyDeviceDriver extends Homey.Driver {
    async onInit() {
        this.homey.app.log('[Driver] - init', this.id);
        this.homey.app.log(`[Driver] - version`, Homey.manifest.version);

        this.FindMy = null;
        this.authData = null;

        this.homey.app.setDevices(this.getDevices());
    }

    deviceType() {
        return 'other';
    }

    async onPair(session) {
        this.type = 'pair';
        this.setPairingSession(session);
    }

    async onRepair(session, device) {
        this.type = 'repair';
        this.setPairingSession(session, device);
    }

    async setPairingSession(session, device = null) {
        session.setHandler('showView', async (view) => {
            this.homey.app.log(`[Driver] ${this.id} - currentView:`, { view, type: this.type });

            if (view === 'loading') {
                try {
                    const userShortened = shortenString(this.loginData.username);
                    this.devices = await this.homey.app.findMyInstances[userShortened].getDevices();

                    if(!this.devices) {
                        throw new Error("Something went wrong, please try login on https://icloud.com/find and try again. Logging in on the website makes sure you're eligbe to use the Find My API");
                    }

                    return session.showView('list_devices');
                } catch (error) {
                    console.error(error);
                    throw new Error(error);
                }
            }
        });

        session.setHandler('login', async (data) => {
            try {
                this.loginData = {
                    username: encrypt(data.username),
                    password: encrypt(data.password)
                };

                const userShortened = shortenString(this.loginData.username);

                if(!this.homey.app.findMyInstances[userShortened]) {
                    // Setup the Find My instance if it doesn't exist
                    await this.homey.app.setupFindMyInstance(this.loginData.username, this.loginData.password);
                }
               
                if(!this.homey.app.findMyInstances[userShortened]) {
                    // If the instance still doesn't exist, throw an error
                    throw new Error("Something went wrong, please try login on https://icloud.com/find and try again. Logging in on the website makes sure you're eligbe to use the Find My API");
                }

                this.homey.app.setDeviceStore(this.loginData.username, this.loginData.password);

                return true;
            } catch (error) {
                console.log(error);
                throw new Error(error);
            }
        });

        session.setHandler('list_devices', async () => {
            const results = this.devices.map((device) => {
                const deviceInfo = device.getRawInfo();
                return {
                    name: `${deviceInfo.deviceDisplayName} - ${deviceInfo.name}`,
                    data: {
                        id: `${deviceInfo.id}`
                    },
                    settings: {
                        deviceClass: deviceInfo.deviceClass
                    },
                    store: {
                        ...this.loginData
                    }
                };
            });

            this.homey.app.log('Found devices - ', results);

            return results;
        });
    }
};

export default FindMyDeviceDriver;