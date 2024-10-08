'use strict';

const Homey = require('homey');
const flowActions = require('./lib/flows/actions');
const flowConditions = require('./lib/flows/conditions');
const { sleep, decrypt } = require('./lib/helpers');
const { readFileSync, writeFileSync } = require('fs');
const path = require('path');
const DEFAULT_INTERVAL = 60000;

class FindMy extends Homey.App {
    trace() {
        console.trace.bind(this, '[log]').apply(this, arguments);
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
        this.findMyInstances = {};

        await this.getIntervalTime();
        await this.getShouldLocate();

        this.FindMyLib = await import('./lib/findmy.js/dist/index.js');
    }

    async initApp() {
        this.log(`${this.homey.manifest.id} - ${this.homey.manifest.version} initalized...`);

        await flowActions.init(this.homey);
        await flowConditions.init(this.homey);

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
            this.homey.app.log('removeDevice', deviceId);

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
        const uniqueDevices = {};
        this.homeyDeviceList.forEach((device) => {
            const store = device.getStore();

            if (store.username && store.password) {
                uniqueDevices[store.username] = {
                    username: store.username,
                    password: store.password
                };
            }
        });

        return Object.values(uniqueDevices);
    }

    getDevicesByStoreKeyValue(key, value) {
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

    // ---------------- API ----------------

    async setupFindMyInstance(username, password, overwrite = false) {
        try {
            if (!overwrite && this.findMyInstances[username]) {
                return this.findMyInstances[username];
            }

            this.homey.app.log('setupFindMyInstance - Setup new instance');

            const { FindMy } = this.FindMyLib;
            this.findMyInstances[username] = new FindMy();

            await this.findMyInstances[username].authenticate(decrypt(username), decrypt(password));

            return this.findMyInstances[username];
        } catch (error) {
            this.error(error);
        }
    }

    async runApiInterval() {
        if (parseInt(this.intervalTime) === 0) {
            this.log('runApiInterval - Interval is OFF. Wait 5 seconds and check again', this.intervalTime, DEFAULT_INTERVAL);

            await sleep(DEFAULT_INTERVAL);
        } else {
            await this.updateData();

            this.log('runApiInterval = waiting for:', this.intervalTime);

            await sleep(this.intervalTime);
        }

        return this.runApiInterval();
    }


    async updateData(uniqueDevice = null) {
        this.findMyDeviceList = [];

        if (uniqueDevice !== null) {
            const FindMy = await this.setupFindMyInstance(uniqueDevice.username, uniqueDevice.password, true);
            return this.updateDateMethod(FindMy, uniqueDevice);
        } else {
            const uniqueDevices = await this.getDevicesByStore();
            return this.updateDataMultiple(uniqueDevices);
        }
    }

    async updateDataMultiple(uniqueDevices) {
        for (let index = 0; index < uniqueDevices.length; index++) {
            const FindMy = await this.setupFindMyInstance(uniqueDevices[index].username, uniqueDevices[index].password);

            this.updateDateMethod(FindMy, uniqueDevices[index], true);
        }
    }

    async updateDateMethod(FindMy, uniqueDevice, retryOnFail = null) {
        try {
            console.log('retryOnFail', retryOnFail);
            const findMyDeviceList = await FindMy.getDevices(this.shouldLocate);
                
            this.findMyDeviceList = [...this.findMyDeviceList, ...findMyDeviceList];

            const devices = this.getDevicesByStoreKeyValue('username', uniqueDevice.username);

            devices.forEach((device) => {
                if (device) device.setCapabilityValues();
            });
        } catch (error) {
            this.error(error);

            if(retryOnFail) {
                await this.updateData(uniqueDevice)
            }       
        }
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
            this.error(error);

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
            this.error(error);

            this.setShouldLocate(true);
        }
    }
}

module.exports = FindMy;
