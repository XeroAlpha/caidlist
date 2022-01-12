const crypto = require("crypto");
const got = require("got").default;
const AdmZip = require("adm-zip");
const {
    cachedOutput,
    filterObjectMap
} = require("../util/common");

function digestBufferHex(algorithm, buffer) {
    let digest = crypto.createHash(algorithm);
    digest.update(buffer);
    return digest.digest().toString("hex");
}

const releaseApiHost = "https://launcher.mojang.com";
const metaApiHost = "https://launchermeta.mojang.com";
const assetApiHost = "https://resources.download.minecraft.net";

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

async function fetchVersionReleaseFile(apiHost, versionMeta, releaseId) {
    let release = versionMeta.downloads[releaseId];
    if (!release) throw new Error("Release file not found: " + releaseId);
    let content = await got(release.url.replace("https://launcher.mojang.com", apiHost)).buffer();
    if (content.length == release.size && digestBufferHex("sha1", content) == release.sha1) {
        return content;
    } else {
        throw new Error("meta mismatched for release: " + releaseId);
    }
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

function extractFileFromZip(zipPathOrBuffer, entryName) {
    const zip = new AdmZip(zipPathOrBuffer);
    return zip.readFile(entryName);
}

async function fetchJavaEditionLangData() {
    const result = await cachedOutput("version.common.java.lang", async () => {
        console.log("Fetching Java Edition language data...");
        const manifest = await fetchVersionsManifest(metaApiHost);
        const versionMeta = await fetchVersionMeta(metaApiHost, manifest, "latest_snapshot");
        const releaseFile = await fetchVersionReleaseFile(releaseApiHost, versionMeta, "client");
        const assetIndex = await fetchVersionAssetIndex(metaApiHost, versionMeta);
        const langZhAsset = await fetchVersionAsset(assetApiHost, assetIndex, "minecraft/lang/zh_cn.json");
        const langEnAsset = await extractFileFromZip(releaseFile, "assets/minecraft/lang/en_us.json");
        return {
            "__VERSION__": versionMeta.id,
            "__VERSION_TYPE__": versionMeta.type,
            "__VERSION_TIME__": versionMeta.time,
            "zh_cn": JSON.parse(langZhAsset.toString()),
            "en_us": JSON.parse(langEnAsset.toString())
        }
    });
    return filterObjectMap(result, k => !k.startsWith("__"));
}

module.exports = {
    fetchJavaEditionLangData
};