const adb = require('@devicefarmer/adbkit').Adb;
const pEvent = require('p-event');
const minicap = require('./minicap');

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
    return pEvent(imageStream, 'data');
}

module.exports = {
    captureScreen,
    openMinicap,
    stopMinicap,
    readImageFromMinicap
};
