import { KeyCodesMap } from '@u4/adbkit';
import { spawn } from 'child_process';
import PNGSplitStream from 'png-split-stream';
import { Readable } from 'stream';
import { log, retryUntilComplete, sleepAsync, warn } from './common.js';
import scrcpyServer from '../../data/scrcpy-server/index.js';

/**
 * @typedef {import('net').Socket} Socket
 * @typedef {{ serverProcess: Socket, videoSocket: Socket, controlSocket: Socket }} Scrcpy
 */

export class ScrcpyPNGStream extends Readable {
    /**
     * @param {Scrcpy} scrcpy
     */
    constructor(scrcpy, ffmpegArgs, debug) {
        super({
            objectMode: true
        });
        const { videoSocket } = scrcpy;
        this.videoSocket = videoSocket;
        videoSocket.on(
            'close',
            (this._videoSocketCloseListener = () => {
                this.destroy();
            })
        );
        videoSocket.on(
            'error',
            (this._videoSocketErrorListener = (err) => {
                warn('scrcpy stream error', err);
            })
        );
        this.ffmpeg = spawn(
            'ffmpeg',
            [
                '-f',
                'h264',
                '-hwaccel',
                'auto',
                '-i',
                '-',
                ...(ffmpegArgs || []),
                '-c:v',
                'png',
                '-f',
                'image2pipe',
                '-'
            ],
            {
                stdio: ['pipe', 'pipe', debug ? 'inherit' : 'ignore']
            }
        );
        this.ffmpeg.on('exit', () => {
            this.destroy();
        });
        this.ffmpeg.stdin.on('error', () => {});
        this.ffmpeg.stdout.pipe(new PNGSplitStream()).on('data', (image) => {
            if (this.pushingImages) {
                this.pushingImages = this.push(image);
            }
        });
        let readyResolve;
        this.ready = new Promise((resolve) => {
            readyResolve = resolve;
        });
        videoSocket.on(
            'data',
            (this._videoSocketDataListener = (d) => {
                if (this.ffmpeg.stdin.writable) {
                    this.ffmpeg.stdin.write(d);
                }
            })
        );
        videoSocket.once('data', () => readyResolve());
    }

    _read() {
        this.pushingImages = true;
    }

    _destroy() {
        this.ffmpeg.kill();
        this.videoSocket.off('close', this._videoSocketCloseListener);
        this.videoSocket.off('error', this._videoSocketErrorListener);
        this.videoSocket.off('data', this._videoSocketDataListener);
    }
}

/**
 * @param {import('@u4/adbkit').DeviceClient} device
 * @returns {Promise<Scrcpy>}
 */
export async function openScrcpy(device, options) {
    const jarDest = '/data/local/tmp/scrcpy-server.jar';
    const scid = Math.floor(Math.random() * 2147483648)
        .toString(16)
        .padStart(8, '0');
    await device.push(scrcpyServer.path, jarDest);
    const parts = [
        `CLASSPATH=${jarDest}`,
        'app_process',
        '/',
        'com.genymobile.scrcpy.Server',
        scrcpyServer.version,
        `scid=${scid}`,
        'tunnel_forward=true',
        'log_level=info',
        'video_bit_rate=24000000',
        'max_size=8192',
        'audio=false',
        'raw_stream=true',
        options?.crop ? `crop=${options.crop}` : null,
        options?.controlOnly ? 'video=false' : null
    ];
    const commandLine = parts.filter((e) => e !== null).join(' ');
    const serverProcess = await device.shell(commandLine);
    let readyToConnectResolve;
    const readyToConnectPromise = new Promise((resolve) => {
        readyToConnectResolve = resolve;
    });
    serverProcess.on('data', (text) => {
        const lines = text.toString('utf-8').split('\n');
        lines.forEach((ln) => {
            if (ln.startsWith('[server] INFO: Device: ')) {
                readyToConnectResolve();
                return;
            }
            if (ln.length) log(`[scrcpy-server] ${ln.replace(/^\[server\] /, '')}`);
        });
    });
    await readyToConnectPromise;
    await sleepAsync(options?.delay ?? 1500);
    const firstSocket = await retryUntilComplete(30, 100, () => device.openLocal(`localabstract:scrcpy_${scid}`));
    if (options?.controlOnly) {
        return { serverProcess, controlSocket: firstSocket };
    }
    const controlSocket = await device.openLocal(`localabstract:scrcpy_${scid}`);
    return { serverProcess, videoSocket: firstSocket, controlSocket };
}

const TYPE_INJECT_KEYCODE = 0;
const TYPE_INJECT_TEXT = 1;
const TYPE_SET_SCREEN_POWER_MODE = 10;

/**
 * @param {import('net').Socket} socket
 */
function writeSocket(socket, data) {
    return new Promise((resolve, reject) => {
        socket.write(data, (err) => {
            if (err) return reject(err);
            return resolve();
        });
    });
}

/**
 * @param {Scrcpy} scrcpy
 */
export async function injectKeyCode(scrcpy, action, keyCode, repeat, metaState) {
    const msg = Buffer.allocUnsafe(14);
    msg.writeUInt8(TYPE_INJECT_KEYCODE, 0);
    msg.writeUInt8(action, 1);
    msg.writeUInt32BE(keyCode, 2);
    msg.writeUInt32BE(repeat ?? 0, 6);
    msg.writeUInt32BE(metaState ?? 0, 10);
    await writeSocket(scrcpy.controlSocket, msg);
}

/**
 * @param {Scrcpy} scrcpy
 */
export async function injectText(scrcpy, text) {
    const textBuffer = Buffer.from(text, 'utf-8');
    const msg = Buffer.allocUnsafe(textBuffer.length + 1 + 4);
    msg.writeUInt8(TYPE_INJECT_TEXT, 0);
    msg.writeUInt32BE(textBuffer.length, 1);
    textBuffer.copy(msg, 5);
    await writeSocket(scrcpy.controlSocket, msg);
}

/**
 * @param {Scrcpy} scrcpy
 */
export async function injectSetScreenPowerMode(scrcpy, mode) {
    const msg = Buffer.allocUnsafe(2);
    msg.writeUInt8(TYPE_SET_SCREEN_POWER_MODE, 0);
    msg.writeUInt8(mode, 1);
    await writeSocket(scrcpy.controlSocket, msg);
}

const ACTION_DOWN = 0;
const ACTION_UP = 1;

/**
 * @param {Scrcpy} scrcpy
 * @param {keyof typeof import('@u4/adbkit').KeyCodes} keycode
 */
export async function press(scrcpy, keycode) {
    await injectKeyCode(scrcpy, ACTION_DOWN, KeyCodesMap[keycode]);
    await injectKeyCode(scrcpy, ACTION_UP, KeyCodesMap[keycode]);
}

const POWER_MODE_OFF = 0;

/**
 * @param {Scrcpy} scrcpy
 */
export async function powerOffScreen(scrcpy) {
    await injectSetScreenPowerMode(scrcpy, POWER_MODE_OFF);
}

const ScrcpyPendingStopped = Symbol('ScrcpyPendingStopped');

/**
 * @param {Scrcpy} scrcpy
 */
export function stopScrcpy(scrcpy) {
    scrcpy.videoSocket?.destroy();
    scrcpy.controlSocket.destroy();
    scrcpy.serverProcess.destroy();
    scrcpy[ScrcpyPendingStopped] = true;
}

/**
 * @param {import('@u4/adbkit').Scrcpy} scrcpy
 */
export function isScrcpyStopped(scrcpy) {
    return scrcpy[ScrcpyPendingStopped] === true;
}
