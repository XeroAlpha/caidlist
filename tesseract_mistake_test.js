const adb = require("adbkit");
const fs = require("fs");
const sharp = require("sharp");
const tesseract = require("node-tesseract-ocr");
const config = require("./config");

async function recogizeCommand(adbClient, deviceSerial) {
    let screenshotPngStream = await adbClient.screencap(deviceSerial);
    let screenshotPng = await adb.util.readAll(screenshotPngStream);
    let img = sharp(screenshotPng);
    img.removeAlpha()
        .extract({
            left: config.commandAreaRect["1"][0],
            top: config.commandAreaRect["1"][1],
            width: config.commandAreaRect["1"][2],
            height: config.commandAreaRect["1"][3]
        })
        .negate()
        .threshold(10);
    let commandTextImage = await img.png().toBuffer();
    fs.writeFileSync("./test.png", commandTextImage);
    let commandText = await tesseract.recognize(commandTextImage, {
        ...config.tesseract,
        lang: "eng",
        psm: 7,
        oem: 3
    });
    commandText = commandText.trim();
    return commandText;
}

async function tesseractMistakeTest() {
	let adbClient = adb.createClient();
    let deviceSerial = (await adbClient.listDevices())[0].id;
    console.log(await recogizeCommand(adbClient, deviceSerial));
}

tesseractMistakeTest().catch(err => {
    console.error(err);
    debugger;
});