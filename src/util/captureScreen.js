const adb = require('@devicefarmer/adbkit').Adb;
const minicap = require('./minicap');
const {
    eventTriggered
} = require('./common');

async function captureScreen(device) {
    const screenshotPngStream = await device.screencap();
    return adb.util.readAll(screenshotPngStream);
}

async function openMinicap(device) {
    await minicap.install(device);
    return minicap.start(device);
}

async function stopMinicap(device, imageStream) {
    await minicap.stop(device, imageStream);
    await minicap.uninstall(device);
}

async function readImageFromMinicap(imageStream) {
    return eventTriggered(imageStream, 'data');
}

module.exports = {
    captureScreen,
    openMinicap,
    stopMinicap,
    readImageFromMinicap
};
