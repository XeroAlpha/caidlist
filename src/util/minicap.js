const events = require("events");
const { adbShell, extractFromShell, getSystemProp, pushWithSync, getDeviceSurfaceOrientation } = require("./adb");
const { sleepAsync } = require("./common");
const { StateTransform } = require("./stateStream");

async function install(device) {
    const prebuiltRoot = "@devicefarmer/minicap-prebuilt/prebuilt";
    const remoteTempDir = "/data/local/tmp";
    const abi = await getSystemProp(device, "ro.product.cpu.abi");
    const sdk = parseInt(await getSystemProp(device, "ro.build.version.sdk"));
    let binFile, soFile;
    if (sdk >= 16) {
        binFile = require.resolve(`${prebuiltRoot}/${abi}/bin/minicap`);
    } else {
        binFile = require.resolve(`${prebuiltRoot}/${abi}/bin/minicap-nopie`);
    }
    soFile = require.resolve(`${prebuiltRoot}/${abi}/lib/android-${sdk}/minicap.so`);

    const sync = await device.syncService();
    await pushWithSync(sync, binFile, `${remoteTempDir}/minicap`, "0755");
    await pushWithSync(sync, soFile, `${remoteTempDir}/minicap.so`);
    sync.end();
}

async function uninstall(device) {
    const remoteTempDir = "/data/local/tmp";
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

async function start(device, options) {
    const arguments = ["LD_LIBRARY_PATH=/data/local/tmp", "/data/local/tmp/minicap"];
    let socketName = "minicap";
    options = options || {};
    if (options.display) {
        arguments.push("-d", options.display);
    }
    if (options.socketName) {
        arguments.push("-n", (socketName = options.socketName));
    }
    if (options.projection) {
        arguments.push("-P", options.projection);
    } else {
        let windowSize = await extractFromShell(device, "dumpsys window", /init=(\d+x\d+)/, 1);
        let rotation = await getDeviceSurfaceOrientation(device);
        if (!windowSize) {
            let width = await extractFromShell(device, "dumpsys window", /DisplayWidth=(\d+)/, 1);
            let height = await extractFromShell(device, "dumpsys window", /DisplayHeight=(\d+)/, 1);
            windowSize = `${width}x${height}`;
        }
        arguments.push("-P", `${windowSize}@${windowSize}/${rotation * 90}`);
    }
    if (options.quality) {
        arguments.push("-Q", options.quality);
    }
    if (options.skipFrames) {
        arguments.push("-S");
    }
    if (options.frameRate) {
        arguments.push("-r", options.frameRate);
    }
    let minicapProc = await device.shell(arguments.join(" "));
    let retryCount = 3;
    while (retryCount--) {
        await sleepAsync(500);
        try {
            const localStream = await device.openLocal(`localabstract:${socketName}`);
            return localStream.pipe(new MinicapStream(minicapProc));
        } catch (err) {
            console.error(err);
        }
    }
    throw new Error("Unable to establish connection to minicap");
}

async function stop(device, handler) {
    await adbShell(device, `kill -9 ${handler.pid}`);
    handler.minicapProc.destroy();
}

module.exports = {
    install,
    uninstall,
    start,
    stop
};
