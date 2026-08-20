'use strict';

import Homey from 'homey';
import flowActions from './lib/flows/actions.mjs';
import flowConditions from './lib/flows/conditions.mjs';
import { sleep, decrypt, encrypt, shortenString } from './lib/helpers.mjs';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FindMySession, RetryLaterError } from './lib/findmy.js/dist/index.js';

const DEFAULT_INTERVAL = 60000;
const PERSISTENT_DIR = '/userdata/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class FindMyApp extends Homey.App {
    trace() {
        console.log.bind(this, '[trace]').apply(this, arguments);
    }

    debug() {
        console.debug.bind(this, '[debug]').apply(this, arguments);
    }

    info() {
        console.log.bind(this, '[info]').apply(this, arguments);
    }

    log() {
        console.log.bind(this, '[log]').apply(this, arguments);
    }

    warn() {
        console.warn.bind(this, '[warn]').apply(this, arguments);
    }

    error() {
        console.error.bind(this, '[error]').apply(this, arguments);
    }

    fatal() {
        console.error.bind(this, '[fatal]').apply(this, arguments);
    }

    // -------------------- INIT ----------------------

    async onInit() {
        this.log(`${this.homey.manifest.id} - ${this.homey.manifest.version} started...`);

        this.homeyDeviceList = [];
        this.findMyDeviceList = [];

        this.driversInitialized = false;
        // Keyed by account. Each value is a FindMySession, which looks after
        // its own reconnects, backoff and stored session.
        this.findMyInstances = {};

        await this.getIntervalTime();
        await this.getShouldLocate();
    }

    async initApp() {
        this.log(`${this.homey.manifest.id} - ${this.homey.manifest.version} initalized...`);

        await flowActions(this.homey);
        await flowConditions(this.homey);

        await this.sendNotifications();
        await this.setHomeyLocation();
        await this.runApiInterval();
    }

    async sendNotifications() {
        try {
            // const ntfy2023100401 = `[Whatsapp] (1/2) - Good news. This app version doesn't require the cloud server anymore`;
            // const ntfy2023100402 = `[Whatsapp] (2/2) - The complete connection is now running natevely on your Homey.`;
            // await this.homey.notifications.createNotification({
            //     excerpt: ntfy2023100402
            // });
            // await this.homey.notifications.createNotification({
            //     excerpt: ntfy2023100401
            // });
        } catch (error) {
            this.log('sendNotifications - error', console.error());
        }
    }

    // ---------------- DEVICES ----------------

    async setDevice(device) {
        this.log('setDevice - New device');
        this.homeyDeviceList = [...this.homeyDeviceList, device];
    }

    async setDevices(devices) {
        this.log('setDevices - New devices');
        this.homeyDeviceList = [...this.homeyDeviceList, ...devices];

        if (!this.driversInitialized) {
            this.driversInitialized = true;
            await sleep(2000);
            this.initApp();
        }
    }

    async removeDevice(deviceId) {
        try {
            this.log('removeDevice', deviceId);

            const filteredList = this.homeyDeviceList.filter((dl) => {
                const data = dl.getData();
                return data.id !== deviceId;
            });

            this.homeyDeviceList = filteredList;
        } catch (error) {
            this.error(error);
        }
    }

    async getDevicesByStore() {
        // Get all unique devices
        // Multiple devices can have the same username and password
        // We only need to authenticate once
        // So we only need to get the unique devices

        const uniqueDevices = {};
        this.homeyDeviceList.forEach((device) => {
            const store = device.getStore();

            if (store.username && store.password) {
                const userShortened = shortenString(store.username);

                uniqueDevices[userShortened] = {
                    username: store.username,
                    password: store.password
                };
            }
        });

        this.log('getDevicesByStore', uniqueDevices);

        return Object.values(uniqueDevices);
    }

    getDevicesByStoreKeyValue(key, value) {
        // Get all devices by store key value
        // This is used to get all devices with the same username
        // So we can authenticate once and get all devices
        return [...this.homeyDeviceList].filter((device) => device.getStoreValue(key) === value);
    }

    async setDeviceStore(username, password) {
        const devices = this.getDevicesByStoreKeyValue('username', username);

        if (devices && devices.length) {
            devices.forEach((device) => {
                device.setStoreValue('username', username);
                device.setStoreValue('password', password);
            });
        }
    }

    // ---------------- SESSION STORAGE ----------------
    // findmy.js decides when it is safe to sign in; this only says where the
    // session lives. The cookies in it are as good as a password, so they are
    // encrypted with the same key as the stored credentials.

    sessionFilePath(key) {
        return path.resolve(PERSISTENT_DIR, `session-${key}.json`);
    }

    get sessionStore() {
        return {
            load: (key) => JSON.parse(decrypt(readFileSync(this.sessionFilePath(key), 'utf8'))),
            save: (key, session) => writeFileSync(this.sessionFilePath(key), encrypt(JSON.stringify(session)), 'utf8'),
            // Already gone is already clear; the library would log a
            // failure here on a perfectly normal path.
            clear: (key) => {
                try {
                    unlinkSync(this.sessionFilePath(key));
                } catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                }
            }
        };
    }

    // ---------------- API ----------------

    async setupFindMyInstance(username, password) {
        const userShortened = shortenString(username);
        this.log('setupFindMyInstance', userShortened);

        const decryptedUsername = decrypt(username);
        const sanitizedUsername = decryptedUsername.replace(/\s/g, '').toLowerCase();
        const decryptedPassword = decrypt(password);
        const sanitizedPassword = decryptedPassword.replace(/\s/g, '');

        this.log('setupFindMyInstance - authenticate - decryptedUsername', decryptedUsername);
        this.log('setupFindMyInstance - authenticate - sanitizedUsername', sanitizedUsername);

        let session = this.findMyInstances[userShortened];

        if (session) {
            // Pairing or repair with fresh credentials. Handing them over
            // clears any backoff, so a corrected password is tried at once.
            session.setCredentials(sanitizedUsername, sanitizedPassword);
        } else {
            session = new FindMySession({
                key: userShortened,
                username: sanitizedUsername,
                password: sanitizedPassword,
                store: this.sessionStore,
                logger: (...args) => this.log(...args)
            });

            // Registered before connecting on purpose. The session carries the
            // backoff, so throwing it away on a failed connect would hand the
            // next interval a fresh one that signs in immediately.
            this.findMyInstances[userShortened] = session;
        }

        await session.connect();

        await sleep(1000);

        return session;
    }

    async runApiInterval() {
        while (true) {
            if (parseInt(this.intervalTime) === 0) {
                this.log('runApiInterval - Interval is OFF. Wait 5 seconds and check again', this.intervalTime, DEFAULT_INTERVAL);

                await sleep(DEFAULT_INTERVAL);
            } else {
                await this.updateData();

                this.log('runApiInterval = waiting for:', this.intervalTime);

                await sleep(this.intervalTime);
            }
        }
    }

    async updateData() {
        // Clear the device list to prevent duplicates on each interval
        this.findMyDeviceList = [];

        this.log('updateData, instances: ', Object.keys(this.findMyInstances));

        const uniqueDevices = await this.getDevicesByStore();
        for (let index = 0; index < uniqueDevices.length; index++) {
            const username = uniqueDevices[index].username;
            const password = uniqueDevices[index].password;
            const userShortened = shortenString(username);

            if (!this.findMyInstances[userShortened]) {
                this.log('updateData - setup new instance');
                try {
                    await this.setupFindMyInstance(username, password);
                } catch (error) {
                    this.logAccountError(userShortened, error, 'setup');

                    continue;
                }
            }

            await this.updateDateMethod(uniqueDevices[index], { username, password });
        }
    }

    async updateDateMethod(uniqueDevice, loginData) {
        const userShortened = shortenString(loginData.username);

        try {
            const homeyDevices = this.getDevicesByStoreKeyValue('username', uniqueDevice.username);
            const session = this.findMyInstances[userShortened];

            if (!session) {
                throw new Error('updateDateMethod - No Find My instance found for ' + userShortened);
            }

            if (session.termsUpdateNeeded()) {
                homeyDevices.forEach((device) => {
                    if (device) device.setUnavailable('Your Apple ID requires a terms and conditions update. Please login on https://icloud.com/find and accept the updated terms and conditions.');
                });
            }

            const findMyDeviceList = await session.getDevices(this.shouldLocate);

            this.findMyDeviceList = [...this.findMyDeviceList, ...findMyDeviceList];

            this.debug(this.findMyDeviceList);

            homeyDevices.forEach((device) => {
                if (device) device.setCapabilityValues();
            });
        } catch (error) {
            this.logAccountError(userShortened, error, 'refresh');
        }
    }

    /**
     * The session decides what a failure means and when to try again; the app
     * only reports it. A RetryLaterError is expected - it means the session is
     * still good and this round should simply be skipped.
     */
    logAccountError(userShortened, error, phase) {
        if (error instanceof RetryLaterError) {
            const waitSeconds = Math.round((error.nextAttemptAt - Date.now()) / 1000);

            this.log('updateDateMethod - skipping', userShortened, `retrying in ${waitSeconds}s`, error.message);

            return;
        }

        this.error('updateDateMethod', error);
        this.error('updateDateMethod - failure', userShortened, { phase, status: error && error.status });
    }

    // ---------------- LOCATION ----------------
    async setHomeyLocation() {
        try {
            const HomeyLat = this.homey.geolocation.getLatitude();
            const HomeyLng = this.homey.geolocation.getLongitude();

            this.homeyLocation = { lat: HomeyLat, lon: HomeyLng };
        } catch (error) {
            this.error(error);
        }
    }

    // ---------------- INTERVAL ----------------
    setIntervalTime(time) {
        this.intervalTime = parseInt(time);

        const persistentDir = path.resolve(__dirname, '/userdata/');
        const intervalTime = { intervalTime: parseInt(time) };

        this.log('setIntervalTime', time);

        return writeFileSync(`${persistentDir}/intervalTime.json`, JSON.stringify(intervalTime));
    }

    getIntervalTime() {
        try {
            const persistentDir = path.resolve(__dirname, '/userdata/');
            const timeFile = readFileSync(`${persistentDir}/intervalTime.json`, 'utf8');
            const timeEntry = JSON.parse(timeFile);
            const time = 'intervalTime' in timeEntry ? timeEntry.intervalTime : DEFAULT_INTERVAL;

            this.log('getIntervalTime', timeEntry, timeEntry.intervalTime);

            this.setIntervalTime(time);
        } catch (error) {
            // this.error(error);

            this.setIntervalTime(DEFAULT_INTERVAL);
        }
    }

    setShouldLocate(shouldLocate) {
        this.shouldLocate = shouldLocate;

        const persistentDir = path.resolve(__dirname, '/userdata/');
        const shouldLocateFile = { shouldLocate };

        this.log('setShouldLocate', shouldLocate);

        return writeFileSync(`${persistentDir}/shouldLocate.json`, JSON.stringify(shouldLocateFile));
    }

    getShouldLocate() {
        try {
            const persistentDir = path.resolve(__dirname, '/userdata/');
            const shouldLocateFile = readFileSync(`${persistentDir}/shouldLocate.json`, 'utf8');
            const shouldLocateEntry = JSON.parse(shouldLocateFile);

            this.log('getShouldLocate', shouldLocateEntry, shouldLocateEntry.shouldLocate);

            return 'shouldLocate' in shouldLocateEntry ? shouldLocateEntry.shouldLocate : false;
        } catch (error) {
            // this.error(error);

            this.setShouldLocate(true);
        }
    }
}

export default FindMyApp;
