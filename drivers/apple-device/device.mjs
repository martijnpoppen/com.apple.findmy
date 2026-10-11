'use strict';

import Homey from 'homey';
import haversine from 'haversine-distance';
import { sleep } from '../../lib/helpers.mjs';


class FindMyDevice extends Homey.Device {
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
        this.homey.app.updateData();
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

            // Apple answers 500 when it cannot deliver the command to the
            // device - asleep, offline, or reachable only over the Find My
            // network. Nothing is wrong with the account, and a raw iCloud
            // status in a Flow error tells the user none of that.
            if (e && e.status === 500) {
                return Promise.reject(
                    new Error(
                        `Apple could not deliver this to ${this.getName()}. ` +
                        'The device is most likely offline or asleep - try again when it is back online.'
                    )
                );
            }

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

    /** True when iCloud listed this device; false when it is not there. */
    setCapabilityValues() {
        const data = this.homey.app.findMyDeviceList.find((d) => d.getID() === this.getData().id);

        if (data) {
            const settings = this.getSettings();
            const getLocation = data.getLocation();
            const location = getLocation && getLocation.lat ? getLocation : { lat: 0, lon: 0 };
            const batteryStatus = data.getBattery();
            const deviceInfo = data.getRawInfo();

            this.homey.app.log(`[Device] ${this.getName()} - [setCapabilityValues] batteryStatus`, batteryStatus);
            this.homey.app.log(`[Device] ${this.getName()} - [setCapabilityValues] Location`, this.homey.app.homeyLocation, { lat: location.lat, lon: location.lon });
            // this.homey.app.log(`[Device] ${this.getName()} - [setCapabilityValues] deviceInfo`, deviceInfo);

            const distance = this.checkLocation(this.homey.app.homeyLocation, { lat: location.lat, lon: location.lon });
            // GPS jitter moves this by centimetres on every poll even for a
            // device lying still. Storing the full precision made Homey see a
            // change every time, so "last updated" ticked on km and miles
            // while the rounded meters value sat unchanged - the same distance
            // looking fresh in one unit and stale in another. Round each unit
            // to the precision its capability shows, so an update means the
            // number on screen actually moved.
            const distanceM = Math.round(distance);
            const distanceKM = parseFloat((distance / 1000).toFixed(2));
            const distanceMI = parseFloat((distance * 0.000621371192).toFixed(2));

            const isMoving = this.getCapabilityValue('measure_distance') - distanceKM > 1 || this.getCapabilityValue('measure_distance') - distanceKM < -1;
            const isHome = distance < settings.is_home_radius;
            const isCharging = batteryStatus && batteryStatus.status === 'Charging';
            // A reported 0% is a real reading, not a missing one, so this
            // checks for the value being there rather than being truthy.
            const reportedPercentage =
                batteryStatus && batteryStatus.percentage !== undefined && batteryStatus.percentage !== null
                    ? Math.round(parseFloat(batteryStatus.percentage))
                    : null;
            const batteryPercentage = Number.isFinite(reportedPercentage) ? reportedPercentage : null;

            const hasNoBattery = deviceInfo.deviceClass === 'Accessory' || deviceInfo.deviceClass === 'AirPods' || deviceInfo.deviceClass === 'AirTag';

            this.setValue('alarm_is_moving', isMoving);
            this.setValue('measure_distance', distanceKM);
            this.setValue('measure_distance_miles', distanceMI);
            this.setValue('measure_distance_meters', distanceM);
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
            } else {
                // A device that does have a battery, in a refresh that did not
                // carry one. The last reading stays put - there is nothing
                // better to show - but silently keeping it is what made this
                // look like a frozen battery next to a location that kept
                // moving, with nothing in the report to say why.
                this.homey.app.log(
                    `[Device] ${this.getName()} - [setCapabilityValues] no battery in this refresh, keeping the last reading`,
                    batteryStatus
                );
            }

            this.firstRun = false;
        } else {
            this.homey.app.error(`[Device] ${this.getName()} - [setCapabilityValues] => Data not found`);
        }

        this.setValue('measure_interval', this.homey.app.intervalTime / 1000);

        return !!data;
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

            // Only what moved. Every capability of every device on every
            // refresh is thirteen lines a device a poll, nearly all of them
            // restating a value that did not change - which is what flushes
            // the diagnostics ring buffer. One report sent to show a problem
            // from hours earlier covered eight minutes.
            //
            // The value is still written either way: a repeat write is what
            // keeps a capability's "last updated" honest for something that
            // genuinely has not moved, and skipping it is what made the
            // distances disagree about when they were last seen.
            if (currentValue !== value) {
                this.homey.app.log(`[Device] ${this.getName()} - setValue - ${key} - ${currentValue} | ${value}`);
            }

            await this.setCapabilityValue(key, value);
        }
    }
}

export default FindMyDevice;
