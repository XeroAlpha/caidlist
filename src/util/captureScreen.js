const adb = require("@devicefarmer/adbkit").Adb;
const minicap = require("./minicap");
const { 
    eventTriggered
} = require("./common");

async function captureScreen(device) {
    let screenshotPngStream = await device.screencap();
    return await adb.util.readAll(screenshotPngStream);
}

async function openMinicap(device) {
    await minicap.install(device);
    return await minicap.start(device);
}

async function stopMinicap(device, handler) {
    await minicap.stop(device, handler);
    await minicap.uninstall(device);
}

async function peekImageFromMinicap(minicapHandler) {
    return await eventTriggered(minicapHandler, "frame");
}

module.exports = {
    captureScreen,
    openMinicap,
    stopMinicap,
    peekImageFromMinicap
};