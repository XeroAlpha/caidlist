import AdbKit from '@devicefarmer/adbkit';
import { pEvent } from 'p-event';
import * as minicap from './minicap.js';

const { Adb } = AdbKit;

export async function captureScreen(device) {
    const screenshotPngStream = await device.screencap();
    return Adb.util.readAll(screenshotPngStream);
}

export async function openMinicap(device) {
    await minicap.install(device);
    return minicap.start(device);
}

export async function stopMinicap(device, imageStream) {
    await minicap.stop(device, imageStream);
    await minicap.uninstall(device);
}

export async function readImageFromMinicap(imageStream) {
    return pEvent(imageStream, 'data');
}
