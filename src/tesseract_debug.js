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

async function recogizeCommandDebug(screenImage, surfaceOrientation) {
    let commandAreaRect = config.commandAreaRect[surfaceOrientation];
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
    let commandTextImage = await img.png().toBuffer();
    fs.writeFileSync("./tstest_input.jpg", screenImage); // maybe jpg
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
	let adbClient = newAdbClient();
    let device = await getAnyOnlineDevice(adbClient);
    let minicap = await openMinicap(device);
    let screenImage = await peekImageFromMinicap(minicap);
    // let screenPng = await captureScreen(device);
    let screenOrientation = await getDeviceSurfaceOrientation(device);
    console.log("screenOrientation = " + screenOrientation);
    console.log(await recogizeCommandDebug(screenImage, screenOrientation));
    await stopMinicap(device, minicap);
}

tesseractDebug().catch(err => {
    console.error(err);
    debugger;
});