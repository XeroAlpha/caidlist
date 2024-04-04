/* eslint-disable no-console */
import { writeFileSync } from 'fs';
import { OEM, createWorker } from 'tesseract.js';
import { pEvent } from 'p-event';
import { packageVersions } from '../data/config.js';
import { newAdbClient, getAnyOnlineDevice } from './util/adb.js';
import { ScrcpyPNGStream, openScrcpy, stopScrcpy } from './util/scrcpy.js';

async function recogizeCommandDebug(cx, commandTextImage) {
    const worker = await createWorker('eng', OEM.DEFAULT, {
        ...cx.tesseractOptions,
        cacheMethod: 'none'
    });
    let { data: { text: commandText } } = await worker.recognize(commandTextImage);
    commandText = commandText.trim();
    await worker.terminate();
    return commandText;
}

async function captureScreen(device) {
    const scrcpy = await openScrcpy(device);
    const imageStream = new ScrcpyPNGStream(scrcpy);
    const image = await pEvent(imageStream, 'data');
    stopScrcpy(scrcpy);
    return image;
}

// eslint-disable-next-line no-unused-vars
async function tesseractDebugPNG(versionType) {
    if (!packageVersions[versionType]) {
        throw new Error(`Cannot find version: ${versionType}`);
    }
    const cx = packageVersions[versionType].config;
    const adbClient = newAdbClient();
    const device = await getAnyOnlineDevice(adbClient);
    const scrcpy = await openScrcpy(device);
    const rect = cx.commandAreaRect;
    const imageStream = new ScrcpyPNGStream(scrcpy, [
        '-filter:v', [
            `crop=x=${rect[0]}:y=${rect[1]}:w=${rect[2]}:h=${rect[3]}`,
            'format=pix_fmts=gray',
            'negate',
            'maskfun=low=60:high=60:fill=0:sum=256'
        ].join(',')
    ]);
    await imageStream.ready;
    const commandTextImage = await pEvent(imageStream, 'data');
    writeFileSync('./tstest_output.png', commandTextImage);
    console.log(await recogizeCommandDebug(cx, commandTextImage));
    stopScrcpy(scrcpy);
    const screenshotImage = await captureScreen(device);
    writeFileSync('./tstest_input.png', screenshotImage);
}

tesseractDebugPNG(...process.argv.slice(2)).catch((err) => {
    console.error(err);
    debugger;
});
