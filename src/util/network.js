import { createHash } from 'crypto';
import { got } from 'got';
import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent';
import { proxyConfig } from '../../data/config.js';

export const proxiedGot = got.extend({
    agent: {
        http: proxyConfig.http && new HttpProxyAgent({ proxy: proxyConfig.http }),
        https: proxyConfig.https && new HttpsProxyAgent({ proxy: proxyConfig.https })
    }
});

function digestBufferHex(algorithm, buffer) {
    const digest = createHash(algorithm);
    digest.update(buffer);
    return digest.digest().toString('hex');
}

export async function fetchRedirect(url) {
    const response = await proxiedGot.head(url, {
        timeout: {
            lookup: 30000,
            connect: 30000,
            secureConnect: 30000
        },
        followRedirect: false
    });
    return response.headers.location || url;
}

export async function fetchFile(url, size, sha1) {
    const request = proxiedGot(url, {
        timeout: {
            lookup: 30000,
            connect: 30000,
            secureConnect: 30000
        }
    });
    let lastProgressPrompt = Date.now();
    request.on('downloadProgress', (progress) => {
        const now = Date.now();
        if (progress.transferred !== 0 && now - lastProgressPrompt > 1000) {
            lastProgressPrompt = now;
            const progressPercent = `${(progress.percent * 100).toFixed(1)}%`;
            console.log(`${progressPercent} ${url}`);
        }
    });
    const content = await request.buffer();
    if (size != null && content.length !== size) {
        throw new Error(`Size mismatch: ${url}`);
    }
    if (sha1 != null && digestBufferHex('sha1', content) !== sha1) {
        throw new Error(`SHA1 mismatch: ${url}`);
    }
    return content;
}

export async function fetchText(url, size, sha1) {
    const content = await fetchFile(url, size, sha1);
    return content.toString();
}

export async function fetchJSON(url, size, sha1) {
    const content = await fetchText(url, size, sha1);
    return JSON.parse(content);
}
