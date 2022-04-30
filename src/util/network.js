const crypto = require("crypto");
const got = require("got").default;
const { HttpProxyAgent, HttpsProxyAgent } = require("hpagent");
const { proxyConfig } = require("../../data/config");

const proxiedGot = got.extend({
    agent: {
        http: proxyConfig.http && new HttpProxyAgent({ proxy: proxyConfig.http }),
        https: proxyConfig.https && new HttpsProxyAgent({ proxy: proxyConfig.https })
    }
});

function digestBufferHex(algorithm, buffer) {
    const digest = crypto.createHash(algorithm);
    digest.update(buffer);
    return digest.digest().toString("hex");
}

async function fetchFile(url, size, sha1) {
    const request = proxiedGot(url, {
        timeout: {
            lookup: 30000,
            connect: 30000,
            secureConnect: 30000
        }
    });
    let lastProgressPrompt = Date.now();
    request.on("downloadProgress", (progress) => {
        const now = Date.now();
        if (progress.transferred != 0 && now - lastProgressPrompt > 1000) {
            lastProgressPrompt = now;
            const progressPercent = (progress.percent * 100).toFixed(1) + "%";
            console.log(progressPercent + " " + url);
        }
    });
    const content = await request.buffer();
    if (size != null && content.length != size) {
        throw new Error("Size mismatch: " + url);
    }
    if (sha1 != null && digestBufferHex("sha1", content) != sha1) {
        throw new Error("SHA1 mismatch: " + url);
    }
    return content;
}

async function fetchText(url, size, sha1) {
    const content = await fetchFile(url, size, sha1);
    return content.toString();
}

async function fetchJSON(url, size, sha1) {
    const content = await fetchText(url, size, sha1);
    return JSON.parse(content);
}

module.exports = {
    proxiedGot,
    fetchFile,
    fetchJSON,
    fetchText
};
