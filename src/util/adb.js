import AdbKit from '@u4/adbkit';
import { setStatus, log, sleepAsync } from './common.js';

const { Adb } = AdbKit;

/**
 * @typedef {import('@u4/adbkit').Client} Client
 * @typedef {import('@u4/adbkit').DeviceClient} DeviceClient
 * @typedef {import('@u4/adbkit').Sync} Sync
 * @typedef {import('@u4/adbkit').Pushtransfer} PushTransfer
 */

/** @returns {Client} */
export function newAdbClient() {
    return Adb.createClient();
}

/** @param {Client} adbClient */
export async function getAnyOnlineDevice(adbClient) {
    const devices = await adbClient.listDevices();
    const onlineDevices = devices.filter((device) => device.type !== 'offline');
    if (onlineDevices.length !== 0) {
        const preferDeviceSerial = process.env.DEVICE_SERIAL;
        let preferDevice = onlineDevices[0];
        if (preferDeviceSerial) {
            preferDevice = onlineDevices.find((device) => device.id === preferDeviceSerial);
        }
        if (preferDevice) {
            return adbClient.getDevice(preferDevice.id);
        }
    }
    return undefined;
}

/**
 * @param {Client} adbClient
 * @returns {Promise<DeviceClient>}
 */
export async function waitForAnyDevice(adbClient) {
    const onlineDevice = await getAnyOnlineDevice(adbClient);
    if (!onlineDevice) {
        const tracker = await adbClient.trackDevices();
        return new Promise((resolve, reject) => {
            tracker.on('changeSet', (changes) => {
                let checkingDevices = [...changes.added, ...changes.changed];
                checkingDevices = checkingDevices.filter((device) => device.type !== 'offline');
                if (checkingDevices.length !== 0) {
                    const preferDeviceSerial = process.env.DEVICE_SERIAL;
                    let foundDevice = checkingDevices[0];
                    if (preferDeviceSerial) {
                        foundDevice = checkingDevices.find((device) => device.id === preferDeviceSerial);
                    }
                    if (foundDevice) {
                        resolve(adbClient.getDevice(foundDevice.id));
                        tracker.end();
                    }
                }
            });
            tracker.on('error', (err) => reject(err));
        });
    }
    return onlineDevice;
}

export async function getDeviceOrWait() {
    const adbClient = newAdbClient();
    let device = await getAnyOnlineDevice(adbClient);
    if (!device) {
        setStatus('Please plug in the device...');
        device = await waitForAnyDevice(adbClient);
        setStatus('');
        await sleepAsync(1000);
    }
    log(`Device connected: ${device.serial}`);
    return device;
}

/**
 * @param {DeviceClient} device
 * @param {string} command
 * @returns {Promise<Buffer>}
 */
export async function adbShell(device, command) {
    const stream = await device.shell(command);
    const output = await Adb.util.readAll(stream);
    stream.destroy();
    return output;
}

/**
 * @param {DeviceClient} device
 * @param {string} command
 * @param {RegExp} regExp
 * @param {number} [index]
 */
export async function extractFromShell(device, command, regExp, index) {
    const output = await adbShell(device, command);
    const match = output.toString().match(regExp);
    if (match) {
        return index !== undefined ? match[index] : match;
    }
    return null;
}

/**
 * @deprecated
 * @param {DeviceClient} device
 */
export async function getDeviceSurfaceOrientation(device) {
    return Number(await extractFromShell(device, 'dumpsys input', /SurfaceOrientation: (\d+)/, 1));
}

/**
 * @param {DeviceClient} device
 * @param {string} propertyName
 */
export async function getSystemProp(device, propertyName) {
    const output = await adbShell(device, `getprop ${propertyName}`);
    return output.toString().trim();
}

/**
 * @param {Sync} sync
 * @param {string} sourcePath
 * @param {string} destPath
 * @param {number} mode
 * @param {(stats: PushTransfer['stats']) => void} onProgress
 */
export async function pushWithSync(sync, sourcePath, destPath, mode, onProgress) {
    const pushTransfer = await sync.push(sourcePath, destPath, mode);
    if (onProgress) pushTransfer.on('progress', onProgress);
    return pushTransfer.waitForEnd();
}

export async function openMonkey(device) {
    const monkeyPort = 11534;
    const monkeyPid = (await adbShell(device, 'ps -A | grep com.android.commands.monkey | awk \'{print $2}\'')).toString().trim();
    if (monkeyPid) { // kill monkey
        await adbShell(device, `kill -9 ${monkeyPid}`);
        await sleepAsync(1000);
    }
    return device.openMonkey(monkeyPort);
}

export function sendMonkeyCommand(monkey, command) {
    return new Promise((resolve, reject) => {
        monkey.send(command, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

export function isMonkeyAlive(monkey) {
    return monkey && monkey.stream && monkey.stream.readable && monkey.stream.writable;
}
