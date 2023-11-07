import { createRequire } from 'node:module';
import {
    adbShell,
    extractFromShell,
    getSystemProp,
    pushWithSync,
    getDeviceSurfaceOrientation
} from './adb.js';
import { sleepAsync, warn } from './common.js';
import StateTransform from './stateStream.js';

const require = createRequire(import.meta.url);

export async function install(device) {
    const prebuiltRoot = '@u4/minicap-prebuilt/prebuilt';
    const remoteTempDir = '/data/local/tmp';
    const abi = await getSystemProp(device, 'ro.product.cpu.abi');
    const sdk = Number(await getSystemProp(device, 'ro.build.version.sdk'));
    let binFile;
    if (sdk >= 16) {
        binFile = require.resolve(`${prebuiltRoot}/${abi}/bin/minicap`);
    } else {
        binFile = require.resolve(`${prebuiltRoot}/${abi}/bin/minicap-nopie`);
    }
    const soFile = require.resolve(`${prebuiltRoot}/${abi}/lib/android-${sdk}/minicap.so`);

    const sync = await device.syncService();
    await pushWithSync(sync, binFile, `${remoteTempDir}/minicap`, '0755');
    await pushWithSync(sync, soFile, `${remoteTempDir}/minicap.so`);
    sync.end();
}

export async function uninstall(device) {
    const remoteTempDir = '/data/local/tmp';
    await adbShell(device, `rm -f ${remoteTempDir}/minicap`);
    await adbShell(device, `rm -f ${remoteTempDir}/minicap.so`);
}

class MinicapStream extends StateTransform {
    constructor(minicapProc) {
        super();
        this.minicapProc = minicapProc;
    }

    _processChunk(state, chunk) {
        switch (state) {
            case 0: // STATE_HEADER_VERSION
                this.version = chunk.readUInt8();
                return [1, 1];
            case 1: // STATE_HEADER_LEN
                return [2, chunk.readUInt8() - 2];
            case 2: // STATE_HEADER_CONTENT
                this.pid = chunk.readUInt32LE(0);
                this.realDisplaySize = [chunk.readUInt32LE(4), chunk.readUInt32LE(8)];
                this.virtualDisplaySize = [chunk.readUInt32LE(12), chunk.readUInt32LE(16)];
                this.orientation = chunk.readUInt8(20);
                this.quirkFlags = chunk.readUInt8(21);
                return [3, 4];
            case 3: // STATE_DATA_LEN
                return [4, chunk.readUInt32LE()];
            case 4: // STATE_DATA_CONTENT
                this.push(chunk);
                return [3, 4];
            default:
                return [0, 1];
        }
    }
}

/**
 * @returns {import("stream").Readable}
 */
export async function start(device, options) {
    const args = ['LD_LIBRARY_PATH=/data/local/tmp', '/data/local/tmp/minicap'];
    let socketName = 'minicap';
    const opt = options ?? {};
    if (opt.display) {
        args.push('-d', opt.display);
    }
    if (opt.socketName) {
        args.push('-n', (socketName = opt.socketName));
    }
    if (opt.projection) {
        args.push('-P', opt.projection);
    } else {
        let windowSize = await extractFromShell(device, 'dumpsys window', /init=(\d+x\d+)/, 1);
        const rotation = await getDeviceSurfaceOrientation(device);
        if (!windowSize) {
            const width = await extractFromShell(device, 'dumpsys window', /DisplayWidth=(\d+)/, 1);
            const height = await extractFromShell(device, 'dumpsys window', /DisplayHeight=(\d+)/, 1);
            windowSize = `${width}x${height}`;
        }
        args.push('-P', `${windowSize}@${windowSize}/${rotation * 90}`);
    }
    if (opt.quality) {
        args.push('-Q', opt.quality);
    }
    if (opt.skipFrames) {
        args.push('-S');
    }
    if (opt.frameRate) {
        args.push('-r', opt.frameRate);
    }
    const minicapProc = await device.shell(args.join(' '));
    let retryCount = 3;
    while (retryCount--) {
        await sleepAsync(500);
        try {
            const localStream = await device.openLocal(`localabstract:${socketName}`);
            return localStream.pipe(new MinicapStream(minicapProc));
        } catch (err) {
            warn('Cannot connect to minimap', err);
        }
    }
    throw new Error('Unable to establish connection to minicap');
}

export async function stop(device, handler) {
    await adbShell(device, `kill -9 ${handler.pid}`);
    handler.minicapProc.destroy();
}
