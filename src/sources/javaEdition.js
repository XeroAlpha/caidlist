const crypto = require("crypto");
const got = require("got").default;
const {
    cachedOutput,
    filterObjectMap
} = require("../util/common");

function digestBufferHex(algorithm, buffer) {
    let digest = crypto.createHash(algorithm);
    digest.update(buffer);
    return digest.digest().toString("hex");
}

async function fetchVersionsManifest(apiHost) {
    return await got(`${apiHost}/mc/game/version_manifest.json`).json();
}

async function fetchVersionMeta(apiHost, manifest, versionId) {
    if (versionId == "latest" || versionId == "lastest_release") {
        versionId = manifest.latest.release;
    } else if (versionId == "latest_snapshot") {
        versionId = manifest.latest.snapshot;
    }
    let version = manifest.versions.find(version => version.id == versionId);
    if (!version) throw new Error("Version not found: " + versionId);
    return await got(version.url.replace("https://launchermeta.mojang.com", apiHost)).json();
}

async function fetchVersionAssetIndex(apiHost, versionMeta) {
    let meta = versionMeta.assetIndex;
    let content = await got(meta.url.replace("https://launchermeta.mojang.com", apiHost)).buffer();
    if (content.length == meta.size && digestBufferHex("sha1", content) == meta.sha1) {
        return JSON.parse(content.toString());
    } else {
        throw new Error("meta mismatched for asset index");
    }
}

async function fetchVersionAsset(apiHost, assetIndex, objectName) {
    let object = assetIndex.objects[objectName];
    if (!object) throw new Error("Asset object not found: " + objectName);
    let content = await got(`${apiHost}/${object.hash.slice(0, 2)}/${object.hash}`).buffer();
    if (content.length == object.size && digestBufferHex("sha1", content) == object.hash) {
        return content;
    } else {
        throw new Error("meta mismatched for asset: " + objectName);
    }
}

async function fetchJavaEditionLangData() {
    let result = await cachedOutput("java.package.lang", async () => {
        const metaApiHost = "https://launchermeta.mojang.com";
        const assetApiHost = "https://resources.download.minecraft.net";
        console.log("Fetching Java Edition language data...");
        let manifest = await fetchVersionsManifest(metaApiHost);
        let versionMeta = await fetchVersionMeta(metaApiHost, manifest, "latest_snapshot");
        let assetIndex = await fetchVersionAssetIndex(metaApiHost, versionMeta);
        let langAsset = await fetchVersionAsset(assetApiHost, assetIndex, "minecraft/lang/zh_cn.json");
        return {
            "__VERSION__": versionMeta.id,
            "__VERSION_TYPE__": versionMeta.type,
            "__VERSION_TIME__": versionMeta.time,
            ...JSON.parse(langAsset.toString())
        }
    });
    return filterObjectMap(result, k => !k.startsWith("__"));
}

module.exports = {
    fetchJavaEditionLangData
};