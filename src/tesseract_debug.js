const fs = require("fs");
const sharp = require("sharp");
const tesseract = require("node-tesseract-ocr");
const config = require("../data/config");
const {
    newAdbClient,
    getDeviceSurfaceOrientation,
    getAnyOnlineDevice
} = require("./util/adb");
const {
    openMinicap,
    stopMinicap,
    peekImageFromMinicap
} = require("./util/captureScreen");

async function recogizeCommandDebug(cx, screenImage, surfaceOrientation) {
    let commandAreaRect = cx.commandAreaRect[surfaceOrientation];
    let img = sharp(screenImage);
    img.removeAlpha()
        .extract({
            left: commandAreaRect[0],
            top: commandAreaRect[1],
            width: commandAreaRect[2],
            height: commandAreaRect[3]
        })
        .negate()
        .threshold(60);
    if (cx.dpiScale) {
        img.resize({
            width: commandAreaRect[2] * cx.dpiScale,
            height: commandAreaRect[3] * cx.dpiScale,
            fit: "fill",
            kernel: "nearest"
        });
    }
    let commandTextImage = await img.png().toBuffer();
    fs.writeFileSync("./tstest_input.jpg", screenImage); // maybe jpg
    fs.writeFileSync("./tstest_output.png", commandTextImage);
    let commandText = await tesseract.recognize(commandTextImage, {
        ...cx.tesseractOptions,
        lang: "eng",
        psm: 7,
        oem: 3
    });
    commandText = commandText.trim();
    return commandText;
}

async function tesseractDebug([ versionType ]) {
    const cx = config.packageVersions[versionType].config;
	let adbClient = newAdbClient();
    let device = await getAnyOnlineDevice(adbClient);
    let minicap = await openMinicap(device);
    let screenImage = await peekImageFromMinicap(minicap);
    // let screenPng = await captureScreen(device);
    let screenOrientation = await getDeviceSurfaceOrientation(device);
    console.log("screenOrientation = " + screenOrientation);
    console.log(await recogizeCommandDebug(cx, screenImage, screenOrientation));
    await stopMinicap(device, minicap);
}

tesseractDebug(process.argv.slice(2)).catch(err => {
    console.error(err);
    debugger;
});