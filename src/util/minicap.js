const events = require("events");
const {
    adbShell,
    extractFromShell,
    getSystemProp,
    pushWithSync,
    getDeviceSurfaceOrientation
} = require("./adb");
const {
    sleepAsync,
    eventTriggered
} = require("./common");

async function install(device) {
    const prebuiltRoot = "@devicefarmer/minicap-prebuilt/prebuilt";
    const remoteTempDir = "/data/local/tmp";
    const abi = await getSystemProp(device, "ro.product.cpu.abi");
    const sdk = parseInt(await getSystemProp(device, "ro.build.version.sdk"));
    let binFile, soFile;
    if (sdk >= 16) {
        binFile = require.resolve(`${prebuiltRoot}/${abi}/bin/minicap`); 
    } else {
        binFile = require.resolve(`${prebuiltRoot}/${abi}/bin/minicap-nopie`)
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

async function readUntilBytes(stream, byteCount) {
    let chunks = [], chunk;
    while (byteCount) {
        chunk = stream.read(byteCount);
        if (!chunk) {
            chunk = stream.read();
        }
        if (chunk) {
            chunks.push(chunk);
            byteCount -= chunk.length;
        }
        await eventTriggered(stream, "readable");
    }
    return Buffer.concat(chunks);
}

async function readMinicapHeader(stream, handler) {
    let headerLen, headerBuf;
    handler.version = (await readUntilBytes(stream, 1))[0];
    headerLen = (await readUntilBytes(stream, 1))[0];
    headerBuf = await readUntilBytes(stream, headerLen - 2);
    handler.pid = headerBuf.readUInt32LE(0);
    handler.realDisplaySize = [
        headerBuf.readUInt32LE(4),
        headerBuf.readUInt32LE(8)
    ];
    handler.virtualDisplaySize = [
        headerBuf.readUInt32LE(12),
        headerBuf.readUInt32LE(16)
    ];
    handler.orientation = headerBuf[20];
    handler.quirkFlags = headerBuf[21];
}

async function readMinicapFrame(stream) {
    const len = (await readUntilBytes(stream, 4)).readUInt32LE(0);
    return await readUntilBytes(stream, len);
}

async function connectMinicap(stream, minicapProc) {
    let handler = new events.EventEmitter();
    stream.pause();
    stream.on("end", () => {
        handler.stopped = true;
        handler.emit("end");
    });
    stream.once("readable", async () => {
        await readMinicapHeader(stream, handler);
        handler.emit("header", handler);
        while (!handler.stopped) {
            handler.emit("frame", await readMinicapFrame(stream));
        }
        stream.destroy();
    });
    handler.stream = stream;
    handler.minicapProc = minicapProc;
    return handler;
}

async function start(device, options) {
    const arguments = ["LD_LIBRARY_PATH=/data/local/tmp", "/data/local/tmp/minicap"];
    let socketName = "minicap";
    options = options || {};
    if (options.display) {
        arguments.push("-d", options.display);
    }
    if (options.socketName) {
        arguments.push("-n", socketName = options.socketName);
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
    // minicapProc.on("data", data => console.log(data.toString()));
    let retryCount = 20;
    while(retryCount--) {
        try {
            return connectMinicap(await device.openLocal(`localabstract:${socketName}`), minicapProc);
        } catch(err) {
            // ignore it
        }
        await sleepAsync(500);
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