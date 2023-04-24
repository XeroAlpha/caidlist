import { Octokit } from '@octokit/rest';
import { createHash } from 'crypto';
import { got } from 'got';
import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent';
import { githubToken } from '../../data/config.js';

const httpProxy = process.env.http_proxy;
const httpsProxy = process.env.https_proxy;

export const proxiedGot = got.extend({
    agent: {
        http: httpProxy && new HttpProxyAgent({ proxy: httpProxy }),
        https: httpsProxy && new HttpsProxyAgent({ proxy: httpsProxy })
    }
});

export const octokit = new Octokit({
    auth: githubToken,
    request: {
        agent: httpsProxy && new HttpsProxyAgent({ proxy: httpsProxy })
    }
});

function digestBufferHex(algorithm, buffer) {
    const digest = createHash(algorithm);
    digest.update(buffer);
    return digest.digest().toString('hex');
}

export async function fetchRedirect(url, opts) {
    const response = await proxiedGot.head(url, {
        timeout: {
            lookup: 30000,
            connect: 30000,
            secureConnect: 30000
        },
        followRedirect: false,
        ...opts
    });
    return response.headers.location || url;
}

export async function fetchFile(url, size, sha1, opts) {
    const request = proxiedGot(url, {
        timeout: {
            lookup: 30000,
            connect: 30000,
            secureConnect: 30000
        },
        ...opts
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
    if (typeof size === 'number' && content.length !== size) {
        throw new Error(`Size mismatch: ${url}`);
    }
    if (typeof sha1 === 'string' && digestBufferHex('sha1', content) !== sha1) {
        throw new Error(`SHA1 mismatch: ${url}`);
    }
    return content;
}

export async function fetchText(url, size, sha1, opts) {
    const content = await fetchFile(url, size, sha1, opts);
    return content.toString();
}

export async function fetchJSON(url, size, sha1, opts) {
    const content = await fetchText(url, size, sha1, opts);
    return JSON.parse(content);
}

export async function fetchGitBlob(blobNode, encoding) {
    const blobContent = await fetchJSON(blobNode.url, null, null, {
        headers: {
            authorization: githubToken ? `token ${githubToken}` : undefined
        }
    });
    const blobData = Buffer.from(blobContent.content, 'base64');
    if (blobContent.size != null && blobData.length !== blobContent.size) {
        throw new Error(`Size mismatch: ${blobNode.url}`);
    }
    if (encoding) {
        return blobData.toString(encoding);
    }
    return blobData;
}
