/* eslint-disable no-console */
import { writeFileSync } from 'fs';
import { recognize } from 'node-tesseract-ocr';
import { pEvent } from 'p-event';
import sharp from 'sharp';
import { packageVersions } from '../data/config.js';
import { newAdbClient, getAnyOnlineDevice } from './util/adb.js';
import { ScrcpyPNGStream, ScrcpyRawStream, openScrcpy, stopScrcpy, waitForScrcpyReady } from './util/scrcpy.js';

async function preprocessImageDebugSharp(cx, screenImage) {
    const { commandAreaRect } = cx;
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
    return commandTextImage;
}

async function recogizeCommandDebug(cx, commandTextImage) {
    let commandText = await recognize(commandTextImage, {
        ...cx.tesseractOptions,
        lang: 'eng',
        psm: 7,
        oem: 3
    });
    commandText = commandText.trim();
    return commandText;
}

// eslint-disable-next-line no-unused-vars
async function tesseractDebugRaw(versionType) {
    if (!packageVersions[versionType]) {
        throw new Error(`Cannot find version: ${versionType}`);
    }
    const cx = packageVersions[versionType].config;
    const adbClient = newAdbClient();
    const device = await getAnyOnlineDevice(adbClient);
    const scrcpy = openScrcpy(device);
    const imageStream = new ScrcpyRawStream(scrcpy);
    await waitForScrcpyReady(scrcpy);
    const screenImage = await pEvent(imageStream, 'data');
    const screenPNG = await sharp(screenImage, { raw: imageStream.info }).png().toBuffer();
    // const screenPng = await captureScreen(device);
    console.log(await recogizeCommandDebug(cx, await preprocessImageDebugSharp(cx, screenPNG)));
    stopScrcpy(scrcpy);
}

// eslint-disable-next-line no-unused-vars
async function tesseractDebugPNG(versionType) {
    if (!packageVersions[versionType]) {
        throw new Error(`Cannot find version: ${versionType}`);
    }
    const cx = packageVersions[versionType].config;
    const adbClient = newAdbClient();
    const device = await getAnyOnlineDevice(adbClient);
    const scrcpy = openScrcpy(device);
    const rect = cx.commandAreaRect;
    const imageStream = new ScrcpyPNGStream(scrcpy, [
        '-filter:v', [
            `crop=x=${rect[0]}:y=${rect[1]}:w=${rect[2]}:h=${rect[3]}`,
            'format=pix_fmts=gray',
            'negate',
            'maskfun=low=60:high=60:fill=0:sum=256',
            'mpdecimate=hi=1:lo=1:frac=1:max=-1'
        ].join(',')
    ]);
    await waitForScrcpyReady(scrcpy);
    const commandTextImage = await pEvent(imageStream, 'data');
    writeFileSync('./tstest_output.png', commandTextImage);
    // const screenPng = await captureScreen(device);
    console.log(await recogizeCommandDebug(cx, commandTextImage));
    stopScrcpy(scrcpy);
}

tesseractDebugPNG(...process.argv.slice(2)).catch((err) => {
    console.error(err);
    debugger;
});
