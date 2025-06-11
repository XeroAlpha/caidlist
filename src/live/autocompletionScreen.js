import { createServer } from 'http';
import { fileURLToPath, URL } from 'url';
import { existsSync, readFileSync, statSync } from 'fs';
import { log, projectPath } from '../util/common.js';
import getPort from 'get-port';

const tokenCharset = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
function randomToken(length) {
    const r = new Array(length);
    for (let i = 0; i < length; i++) {
        r[i] = tokenCharset.charAt(Math.floor(tokenCharset.length * Math.random()));
    }
    return r.join('');
}

const livePromptPath = projectPath('data.live_prompt', 'txt');

let port = undefined;

export default class AutocompletionScreen {
    constructor() {
        this.updateSession();
        this.start();
    }

    server = null;

    sessionId = null;

    status = {};

    screenshot = null;

    screenshotId = null;

    logs = [];

    promptMtimeMs = NaN;

    promptUpdateInterval = null;

    prompt = null;

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

    watchPromptChange() {
        if (!existsSync(livePromptPath)) return;
        this.promptUpdateInterval = setInterval(() => {
            const stat = statSync(livePromptPath);
            if (stat.mtimeMs !== this.promptMtimeMs) {
                this.promptMtimeMs = stat.mtimeMs;
                this.prompt = readFileSync(livePromptPath, 'utf-8');
            }
        }, 5000);
    }

    async start() {
        if (!port) {
            port = await getPort({ port: 19333 });
        }
        const baseURL = `http://localhost:${port}`;
        this.server = createServer(async (req, res) => {
            const url = new URL(req.url, baseURL);
            res.setHeader('Access-Control-Allow-Origin', '*');
            if (this.server) {
                if (url.pathname === '/') {
                    res.end(readFileSync(fileURLToPath(new URL('./index.html', import.meta.url))));
                    return;
                }
                if (url.pathname === '/heartbeat') {
                    const since = parseInt(url.searchParams.get('since'), 10) || 0;
                    res.writeHead(200, {
                        'Content-Type': 'application/json; charset=utf-8'
                    });
                    res.end(
                        JSON.stringify({
                            sessionId: this.sessionId,
                            screenshotId: this.screenshotId,
                            logs: this.logs.slice(since, since + 100),
                            livePrompt: this.prompt,
                            ...this.status
                        })
                    );
                    return;
                }
                res.writeHead(404);
                res.end();
            } else {
                req.destroy();
            }
        });
        this.server.listen(port);
        this.watchPromptChange();
        log(`Live screen: ${baseURL}`);
    }

    stop() {
        const { server } = this;
        this.server = null;
        if (this.promptUpdateInterval) {
            clearInterval(this.promptUpdateInterval);
        }
        return new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    }
}
