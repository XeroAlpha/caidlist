const adb = require("@devicefarmer/adbkit").Adb;
const { 
    sleepAsync
} = require("./common");

function newAdbClient() {
    return adb.createClient();
}

async function getAnyOnlineDevice(adbClient) {
    let devices = await adbClient.listDevices();
    let onlineDevices = devices.filter(device => device.type != "offline");
    if (onlineDevices.length != 0) {
        return adbClient.getDevice(onlineDevices[0].id);
    } else {
        return null;
    }
}

async function waitForAnyDevice(adbClient) {
    let onlineDevice = await getAnyOnlineDevice(adbClient);
    if (!onlineDevice) {
        let tracker = await adbClient.trackDevices();
        return new Promise((resolve, reject) => {
            tracker.on("changeSet", changes => {
                let checkingDevices = [...changes.added, ...changes.changed];
                checkingDevices = checkingDevices.filter(device => device.type != "offline");
                if (checkingDevices.length != 0) {
                    resolve(adbClient.getDevice(checkingDevices[0].id));
                    tracker.end();
                }
            });
            tracker.on("error", err => reject(err));
        });
    } else {
        return onlineDevice;
    }
}

async function adbShell(device, command) {
    let stream = await device.shell(command);
    let output = await adb.util.readAll(stream);
    stream.destroy();
    return output;
}

async function extractFromShell(device, command, regExp, index) {
    let output = await adbShell(device, command);
    let match = output.toString().match(regExp);
    if (match) {
        return arguments.length > 3 ? match[index] : match;
    }
    return null;
}

async function getDeviceSurfaceOrientation(device) {
    return parseInt(await extractFromShell(device, "dumpsys input", /SurfaceOrientation: (\d+)/, 1));
}

async function getSystemProp(device, propertyName) {
    let output = await adbShell(device, "getprop " + propertyName);
    return output.toString().trim();
}

async function pushWithSync(sync, content, path, mode, onProgress) {
    return new Promise((resolve, reject) => {
        const pushTransfer = sync.push(content, path, mode);
        if (onProgress) pushTransfer.on("progress", onProgress);
        pushTransfer.on("error", reject);
        pushTransfer.on("end", resolve);
    });
}

async function openMonkey(device) {
    const monkeyPort = 11534;
    let monkeyPid = (await adbShell(device, "ps -A | grep com.android.commands.monkey | awk '{print $2}'")).toString().trim();
    if (monkeyPid) { // kill monkey
        await adbShell(device, "kill -9 " + monkeyPid);
        await sleepAsync(1000);
    }
    return device.openMonkey(monkeyPort);
}

function sendMonkeyCommand(monkey, command) {
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

module.exports = {
    newAdbClient,
    getAnyOnlineDevice,
    waitForAnyDevice,
    adbShell,
    extractFromShell,
    getDeviceSurfaceOrientation,
    getSystemProp,
    pushWithSync,
    openMonkey,
    sendMonkeyCommand
};