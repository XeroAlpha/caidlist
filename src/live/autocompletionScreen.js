import { createServer } from 'http';
import { URL } from 'url';
import { openScrcpy, stopScrcpy } from '../util/scrcpy.js';
import { log } from '../util/common.js';

const tokenCharset = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
function randomToken(length) {
    const r = new Array(length);
    for (let i = 0; i < length; i++) {
        r[i] = tokenCharset.charAt(Math.floor(tokenCharset.length * Math.random()));
    }
    return r.join('');
}

export default class AutocompletionScreen {
    constructor() {
        this.updateSession();
        this.start();
    }

    server = null;

    sessionId = null;

    status = {};

    scrcpySessions = new Set();

    screenshot = null;

    screenshotId = null;

    logs = [];

    updateStatus(status) {
        Object.assign(this.status, status);
    }

    updateSession() {
        this.sessionId = randomToken(16);
    }

    clearLog() {
        this.logs.length = 0;
        this.updateSession();
    }

    log(text) {
        this.logs.push(text);
    }

    updateScreenshot(screenshot) {
        if (this.screenshot !== screenshot) {
            this.screenshot = screenshot;
            this.screenshotId++;
        }
    }

    attachDevice(device) {
        if (this.device) {
            this.detachDevice(this.device);
        }
        this.device = device;
    }

    detachDevice(device) {
        if (this.device === device) {
            this.device = null;
            this.scrcpySessions.forEach((e) => e.stop());
            this.scrcpySessions.clear();
            return;
        }
        throw new Error('Attempt to detach a device that is not attached.');
    }

    start() {
        this.server = createServer((req, res) => {
            const url = new URL(req.url, 'http://localhost:19333');
            res.setHeader('Access-Control-Allow-Origin', '*');
            if (this.server) {
                if (url.pathname === '/heartbeat') {
                    const since = parseInt(url.searchParams.get('since'), 10) || 0;
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(
                        JSON.stringify({
                            sessionId: this.sessionId,
                            screenshotId: this.screenshotId,
                            logs: this.logs.slice(since),
                            ...this.status
                        })
                    );
                    return;
                }
                if (url.pathname === '/stream') {
                    if (this.device) {
                        const scrcpy = openScrcpy(this.device, { rawVideoStream: true });
                        this.scrcpySessions.add(scrcpy);
                        scrcpy.on('raw', (data) => {
                            res.write(data);
                        });
                        scrcpy.on('disconnect', () => {
                            this.scrcpySessions.delete(scrcpy);
                            if (!res.closed) res.end();
                        });
                        res.on('close', () => {
                            stopScrcpy(scrcpy);
                        });
                        this.scrcpy = scrcpy;
                        return;
                    }
                }
                res.writeHead(404);
                res.end();
            } else {
                req.destroy();
            }
        });
        this.server.listen(19333);
        log('Live screen: http://localhost:19333');
    }

    stop() {
        const { server } = this;
        this.server = null;
        if (this.device) {
            this.detachDevice(this.device);
        }
        return new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    }
}
