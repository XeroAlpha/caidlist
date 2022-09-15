import { writeFileSync } from 'fs';
import { recognize } from 'node-tesseract-ocr';
import sharp from 'sharp';
import { packageVersions } from '../data/config.js';
import { newAdbClient, getDeviceSurfaceOrientation, getAnyOnlineDevice } from './util/adb.js';
import { openMinicap, stopMinicap, readImageFromMinicap } from './util/captureScreen.js';

async function recogizeCommandDebug(cx, screenImage, surfaceOrientation) {
    const commandAreaRect = cx.commandAreaRect[surfaceOrientation];
    const img = sharp(screenImage);
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
            fit: 'fill',
            kernel: 'nearest'
        });
    }
    const commandTextImage = await img.png().toBuffer();
    writeFileSync('./tstest_input.jpg', screenImage); // maybe jpg
    writeFileSync('./tstest_output.png', commandTextImage);
    let commandText = await recognize(commandTextImage, {
        ...cx.tesseractOptions,
        lang: 'eng',
        psm: 7,
        oem: 3
    });
    commandText = commandText.trim();
    return commandText;
}

async function tesseractDebug([versionType]) {
    const cx = packageVersions[versionType].config;
    const adbClient = newAdbClient();
    const device = await getAnyOnlineDevice(adbClient);
    const minicap = await openMinicap(device);
    const screenImage = await readImageFromMinicap(minicap);
    // const screenPng = await captureScreen(device);
    const screenOrientation = await getDeviceSurfaceOrientation(device);
    console.log(`screenOrientation = ${screenOrientation}`);
    console.log(await recogizeCommandDebug(cx, screenImage, screenOrientation));
    await stopMinicap(device, minicap);
}

tesseractDebug(process.argv.slice(2)).catch((err) => {
    console.error(err);
    debugger;
});
