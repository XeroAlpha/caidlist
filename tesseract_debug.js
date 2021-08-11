const adb = require("adbkit");
const fs = require("fs");
const sharp = require("sharp");
const tesseract = require("node-tesseract-ocr");
const config = require("./config");

async function adbShell(adbClient, deviceSerial, command) {
    let stream = await adbClient.shell(deviceSerial, command);
    return await adb.util.readAll(stream);
}

async function getDeviceSurfaceOrientation(adbClient, deviceSerial) {
    let output = await adbShell(adbClient, deviceSerial, "dumpsys input | grep SurfaceOrientation | awk '{print $2}' | head -n 1");
    return parseInt(output.toString().trim());
}

async function captureScreen(adbClient, deviceSerial) {
    let screenshotPngStream = await adbClient.screencap(deviceSerial);
    return await adb.util.readAll(screenshotPngStream);
}

async function recogizeCommandDebug(screenshotPng, surfaceOrientation) {
    let commandAreaRect = config.commandAreaRect[surfaceOrientation];
    let img = sharp(screenshotPng);
    img.removeAlpha()
        .extract({
            left: commandAreaRect[0],
            top: commandAreaRect[1],
            width: commandAreaRect[2],
            height: commandAreaRect[3]
        })
        .negate()
        .threshold(10);
    let commandTextImage = await img.png().toBuffer();
    fs.writeFileSync("./tstest_input.png", screenshotPng);
    fs.writeFileSync("./tstest_output.png", commandTextImage);
    let commandText = await tesseract.recognize(commandTextImage, {
        ...config.tesseract,
        lang: "eng",
        psm: 7,
        oem: 3
    });
    commandText = commandText.trim();
    return commandText;
}

async function tesseractDebug() {
	let adbClient = adb.createClient();
    let deviceSerial = (await adbClient.listDevices())[0].id;
    let screenPng = await captureScreen(adbClient, deviceSerial);
    let screenOrientation = await getDeviceSurfaceOrientation(adbClient, deviceSerial);
    console.log("screenOrientation = " + screenOrientation);
    console.log(await recogizeCommandDebug(screenPng, screenOrientation));
}

tesseractDebug().catch(err => {
    console.error(err);
    debugger;
});