'use strict';

const { Device } = require('homey');
const haversine = require('haversine-distance');
const { sleep } = require('../../lib/helpers');

class FindMyDevice extends Device {
    async onInit() {
        const settings = this.getSettings();
        const driverManifest = this.driver.manifest;

        this.homey.app.log('[Device] - init =>', this.getName(), driverManifest.id);
        this.firstRun = true;

        await this.enableDevice(true, settings);
    }

    onAdded() {
        this.homey.app.log(`[Device] ${this.getName()} - onAdded`);
        this.homey.app.setDevice(this);
    }

    onDeleted() {
        this.homey.app.log(`[Device] ${this.getName()} - onDeleted`);
        const deviceObject = this.getData();
        this.homey.app.removeDevice(deviceObject.id);
    }

    async enableDevice(checkCapabilities = false) {
        if (checkCapabilities) {
            await this.checkCapabilities();
        }

        await this.setAvailable();
    }

    // ------------- CapabilityListeners -------------
    async setCapabilityListeners(capabilities) {
        const filtered = capabilities.filter((f) => f.includes('send_'));
        await this.registerMultipleCapabilityListener(filtered, this.onCapability_ACTION.bind(this));
    }

    // ----------------- Actions ------------------
    async onCapability_ACTION(value) {
        try {
            this.homey.app.log(`[Device] ${this.getName()} - onCapability_ACTION`, value);

            const findMyDevice = this.homey.app.findMyDeviceList.find((d) => d.getID() === this.getData().id);

            if ('send_message' in value) {
                const val = value.send_message;

                if (findMyDevice) {
                    await findMyDevice.sendMessage(val.text, val.subject);
                }
            }

            if ('send_sound' in value) {
                if (findMyDevice) {
                    await findMyDevice.playSound();
                }
            }

            return Promise.resolve(true);
        } catch (e) {
            this.error(e);
            return Promise.reject(e);
        }
    }

    async checkCapabilities() {
        const driverManifest = this.driver.manifest;
        let driverCapabilities = driverManifest.capabilities;
        let deviceCapabilities = this.getCapabilities();

        this.homey.app.log(`[Device] ${this.getName()} - Found capabilities =>`, deviceCapabilities);

        await this.setCapabilityListeners(driverCapabilities);

        await this.updateCapabilities(driverCapabilities, deviceCapabilities);
    }

    async updateCapabilities(driverCapabilities, deviceCapabilities) {
        try {
            const newC = driverCapabilities.filter((d) => !deviceCapabilities.includes(d));
            const oldC = deviceCapabilities.filter((d) => !driverCapabilities.includes(d));

            this.homey.app.debug(`[Device] ${this.getName()} - Got old capabilities =>`, oldC);
            this.homey.app.debug(`[Device] ${this.getName()} - Got new capabilities =>`, newC);

            oldC.forEach((c) => {
                this.homey.app.log(`[Device] ${this.getName()} - updateCapabilities => Remove `, c);
                this.removeCapability(c).catch((e) => this.homey.app.debug(e));
            });
            await sleep(500);
            newC.forEach((c) => {
                this.homey.app.log(`[Device] ${this.getName()} - updateCapabilities => Add `, c);
                this.addCapability(c).catch((e) => this.homey.app.debug(e));
            });
            await sleep(500);
        } catch (error) {
            this.homey.app.error(error);
        }
    }

    checkAndRemoveCapability(id) {
        if (this.hasCapability(id)) {
            this.removeCapability(id);
        }
    }

    setCapabilityValues() {
        const data = this.homey.app.findMyDeviceList.find((d) => d.getID() === this.getData().id);

        if (data) {
            const settings = this.getSettings();
            const getLocation = data.getLocation();
            const location = getLocation && getLocation.lat ? getLocation : { lat: 0, lon: 0 };
            const batteryStatus = data.getBattery();
            const deviceInfo = data.getRawInfo();

            console.log(`[Device] ${this.getName()} - [setCapabilityValues] batteryStatus`, batteryStatus);
            console.log(`[Device] ${this.getName()} - [setCapabilityValues] Location`, this.homey.app.homeyLocation, { lat: location.lat, lon: location.lon });
            console.log(`[Device] ${this.getName()} - [setCapabilityValues] deviceInfo.isConsideredAccessory`, deviceInfo.isConsideredAccessory);

            const distance = this.checkLocation(this.homey.app.homeyLocation, { lat: location.lat, lon: location.lon });
            const distanceKM = distance / 1000;
            const distanceMI = distance * 0.000621371192;

            const isMoving = this.getCapabilityValue('measure_distance') - distanceKM > 1 || this.getCapabilityValue('measure_distance') - distanceKM < -1;
            const isHome = distance < settings.is_home_radius;
            const isCharging = batteryStatus && batteryStatus.status === 'Charging';
            const batteryPercentage = batteryStatus && batteryStatus.percentage ? Math.round(parseFloat(batteryStatus.percentage)) : null;

            const hasNoBattery = deviceInfo.isConsideredAccessory;

            this.setValue('alarm_is_moving', isMoving);
            this.setValue('measure_distance', distanceKM);
            this.setValue('measure_distance_miles', distanceMI);
            this.setValue('measure_distance_meters', Math.round(parseFloat(distance)));
            this.setValue('measure_latitude', parseFloat(location.lat.toFixed(4)));
            this.setValue('measure_longitude', parseFloat(location.lon.toFixed(4)));

            this.setValue('alarm_is_home', isHome);

            if (batteryPercentage !== null) {
                this.setValue('measure_battery', batteryPercentage);
                this.setValue('measure_percent_battery', batteryPercentage);
                this.setValue('alarm_battery', batteryPercentage < 15);
                this.setValue('alarm_is_charging', isCharging);
            } else if (hasNoBattery) {
                this.checkAndRemoveCapability('measure_battery');
                this.checkAndRemoveCapability('measure_percent_battery');
                this.checkAndRemoveCapability('alarm_battery');
                this.checkAndRemoveCapability('alarm_is_charging');
            }

            this.firstRun = false;
        } else {
            this.homey.app.error(`[Device] ${this.getName()} - [setCapabilityValues] => Data not found`);
        }

        this.setValue('measure_interval', this.homey.app.intervalTime / 1000);
    }

    checkLocation(locationA, locationB) {
        if (locationA === null) {
            return haversine({ lat: this.getCapabilityValue('measure_latitude'), lon: this.getCapabilityValue('measure_longitude') }, locationB);
        }

        return haversine(locationA, locationB);
    }

    async setValue(key, value) {
        if (this.hasCapability(key)) {
            const currentValue = this.getCapabilityValue(key);

            this.homey.app.log(`[Device] ${this.getName()} - setValue - ${key} - ${currentValue} | ${value}`);
            await this.setCapabilityValue(key, value);
        }
    }
}

module.exports = FindMyDevice;
