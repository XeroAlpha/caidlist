import AdbKit from '@u4/adbkit';
import { spawn } from 'child_process';
import PNGSplitStream from 'png-split-stream';
import { Readable } from 'stream';
import { warn } from './common.js';

const { KeyCodes } = AdbKit;

const ScrcpyBuffer = Symbol('ScrcpyBuffer');

export class ScrcpyRawStream extends Readable {
    /**
     * @param {import('@u4/adbkit').Scrcpy} scrcpy
     */
    constructor(scrcpy, ffmpegArgs, debug) {
        super({
            objectMode: true
        });
        this.scrcpy = scrcpy;
        scrcpy.on('disconnect', () => {
            this.destroy();
        });
        scrcpy.on('error', (err) => {
            warn('scrcpy stream error', err);
        });
        this.ffmpeg = spawn('ffmpeg', [
            '-f', 'h264',
            '-i', '-',
            ...(ffmpegArgs || []),
            '-f', 'rawvideo',
            '-pix_fmt', 'rgb24',
            '-'
        ], {
            stdio: ['pipe', 'pipe', debug ? 'inherit' : 'ignore']
        });
        this.frameBuffer = null;
        this.bufferedSize = 0;
        this.perFrameSize = 0;
        this.ffmpeg.on('exit', () => {
            this.destroy();
        });
        this.ffmpeg.stdin.on('error', () => {});
        this.ffmpeg.stdout.on('data', (/** @type {Buffer} */ data) => {
            data.copy(this.frameBuffer, this.bufferedSize, 0);
            this.bufferedSize += data.length;
            while (this.bufferedSize >= this.perFrameSize) {
                const newBuffer = this.acquireBuffer();
                if (newBuffer && this.pushingImages) {
                    this.pushingImages = this.push(this.frameBuffer);
                    this.frameBuffer = newBuffer;
                }
                this.bufferedSize -= this.frameBuffer.length;
                data.copy(this.frameBuffer, 0, data.length - this.bufferedSize);
            }
        });
        const firstPacketBuffer = [];
        let firstPacketByteLeft = 64 + 4;
        const firstPacketListener = (data) => {
            firstPacketByteLeft -= data.length;
            firstPacketBuffer.push(data);
            if (firstPacketByteLeft <= 0) {
                const firstPacket = Buffer.concat(firstPacketBuffer);
                this.width = firstPacket.readUint16BE(64);
                this.height = firstPacket.readUint16BE(66);
                scrcpy.setWidth(this.width);
                scrcpy.setHeight(this.height);
                this.perFrameSize = this.width * this.height * 3;
                this.frameBuffer = this.acquireBuffer();
                if (this.ffmpeg.stdin.writable) {
                    this.ffmpeg.stdin.write(firstPacket.subarray(firstPacketByteLeft));
                }
                scrcpy.off('raw', firstPacketListener);
                scrcpy.on('raw', (d) => {
                    if (this.ffmpeg.stdin.writable) {
                        this.ffmpeg.stdin.write(d);
                    }
                });
            }
        };
        scrcpy.on('raw', firstPacketListener);
        this.bufferPool = [];
        this.totalAllocBufferCount = 0;
    }

    _read() {
        this.pushingImages = true;
    }

    _destroy() {
        this.ffmpeg.kill();
    }

    get info() {
        return {
            width: this.width,
            height: this.height,
            channels: 3
        };
    }

    acquireBuffer() {
        const buffer = this.bufferPool.pop();
        if (buffer) {
            return buffer;
        }
        if (this.totalAllocBufferCount <= 512) {
            this.totalAllocBufferCount++;
            const newAllocBuffer = Buffer.allocUnsafe(this.perFrameSize);
            newAllocBuffer[ScrcpyBuffer] = true;
            return newAllocBuffer;
        }
        return null;
    }

    releaseBuffer(buffer) {
        if (!buffer[ScrcpyBuffer]) {
            throw new Error('This buffer is not created by scrcpy stream.');
        }
        this.totalAllocBufferCount--;
        this.bufferPool.push(buffer);
    }
}

export class ScrcpyPNGStream extends Readable {
    /**
     * @param {import('@u4/adbkit').Scrcpy} scrcpy
     */
    constructor(scrcpy, ffmpegArgs, debug) {
        super({
            objectMode: true
        });
        this.scrcpy = scrcpy;
        scrcpy.on('disconnect', () => {
            this.destroy();
        });
        scrcpy.on('error', (err) => {
            warn('scrcpy stream error', err);
        });
        this.ffmpeg = spawn('ffmpeg', [
            '-f', 'h264',
            '-i', '-',
            ...(ffmpegArgs || []),
            '-c:v', 'png',
            '-f', 'image2pipe',
            '-'
        ], {
            stdio: ['pipe', 'pipe', debug ? 'inherit' : 'ignore']
        });
        this.ffmpeg.on('exit', () => {
            this.destroy();
        });
        this.ffmpeg.stdin.on('error', () => {});
        this.ffmpeg.stdout.pipe(new PNGSplitStream())
            .on('data', (image) => {
                if (this.pushingImages) {
                    this.pushingImages = this.push(image);
                }
            });
        const firstPacketBuffer = [];
        let firstPacketByteLeft = 64 + 4;
        const firstPacketListener = (data) => {
            firstPacketByteLeft -= data.length;
            firstPacketBuffer.push(data);
            if (firstPacketByteLeft <= 0) {
                const firstPacket = Buffer.concat(firstPacketBuffer);
                this.width = firstPacket.readUint16BE(64);
                this.height = firstPacket.readUint16BE(66);
                scrcpy.setWidth(this.width);
                scrcpy.setHeight(this.height);
                if (this.ffmpeg.stdin.writable) {
                    this.ffmpeg.stdin.write(firstPacket.subarray(firstPacketByteLeft));
                }
                scrcpy.off('raw', firstPacketListener);
                scrcpy.on('raw', (d) => {
                    if (this.ffmpeg.stdin.writable) {
                        this.ffmpeg.stdin.write(d);
                    }
                });
            }
        };
        scrcpy.on('raw', firstPacketListener);
    }

    _read() {
        this.pushingImages = true;
    }

    _destroy() {
        this.ffmpeg.kill();
    }
}

/**
 * @param {import('@u4/adbkit').DeviceClient} device
 * @param {Partial<import('@u4/adbkit').ScrcpyOptions>} options
 */
export function openScrcpy(device, options) {
    const scrcpy = device.scrcpy({
        maxSize: 8192,
        sendFrameMeta: false,
        ...options
    });
    scrcpy.start();
    return scrcpy;
}

/**
 * @param {import('@u4/adbkit').Scrcpy} scrcpy
 */
export async function waitForScrcpyReady(scrcpy) {
    await scrcpy.height;
}

const ACTION_DOWN = 0;
const ACTION_UP = 1;

/**
 * @param {import('@u4/adbkit').Scrcpy} scrcpy
 * @param {keyof typeof import('@u4/adbkit').KeyCodes} keycode
 */
export async function press(scrcpy, keycode) {
    await scrcpy.injectKeycodeEvent(ACTION_DOWN, KeyCodes[keycode]);
    await scrcpy.injectKeycodeEvent(ACTION_UP, KeyCodes[keycode]);
}

const ScrcpyPendingStopped = Symbol('ScrcpyPendingStopped');

/**
 * @param {import('@u4/adbkit').Scrcpy} scrcpy
 */
export function stopScrcpy(scrcpy) {
    scrcpy.stop();
    scrcpy[ScrcpyPendingStopped] = true;
}

/**
 * @param {import('@u4/adbkit').Scrcpy} scrcpy
 */
export function isScrcpyStopped(scrcpy) {
    return scrcpy[ScrcpyPendingStopped] === true;
}
