const { URL } = require("url");
const AdmZip = require("adm-zip");
const { cachedOutput, filterObjectMap } = require("../util/common");
const { fetchFile, fetchJSON } = require("../util/network");

const releaseApiHost = "https://piston-data.mojang.com/";
const metaApiHost = "https://piston-meta.mojang.com";
const assetApiHost = "https://resources.download.minecraft.net";

function replaceUrlHost(url, host) {
    const urlObj = new URL(url, host);
    const hostObj = new URL(host);
    urlObj.origin = hostObj.origin;
    return urlObj.toString();
}

async function fetchVersionsManifest(apiHost) {
    return await fetchJSON(`${apiHost}/mc/game/version_manifest.json`);
}

function getLatestSnapshotVersionId(manifest) {
    return manifest.latest.snapshot;
}

async function fetchVersionMeta(apiHost, manifest, versionId) {
    const version = manifest.versions.find((version) => version.id == versionId);
    if (!version) throw new Error("Version not found: " + versionId);
    return await fetchJSON(replaceUrlHost(version.url, apiHost));
}

async function fetchVersionReleaseFile(apiHost, versionMeta, releaseId) {
    let release = versionMeta.downloads[releaseId];
    if (!release) throw new Error("Release file not found: " + releaseId);
    return await fetchFile(replaceUrlHost(release.url, apiHost), release.size, release.sha1);
}

async function fetchVersionAssetIndex(apiHost, versionMeta) {
    const meta = versionMeta.assetIndex;
    return await fetchJSON(replaceUrlHost(meta.url, apiHost), meta.size, meta.sha1);
}

async function fetchVersionAsset(apiHost, assetIndex, objectName) {
    const object = assetIndex.objects[objectName];
    if (!object) throw new Error("Asset object not found: " + objectName);
    const url = replaceUrlHost(`/${object.hash.slice(0, 2)}/${object.hash}`, apiHost);
    return await fetchFile(url, object.size, object.sha1);
}

function extractFileFromZip(zipPathOrBuffer, entryName) {
    const zip = new AdmZip(zipPathOrBuffer);
    return zip.readFile(entryName);
}

let manifestCache;
async function fetchVersionsManifestCached() {
    if (!manifestCache) {
        manifestCache = await fetchVersionsManifest(metaApiHost);
    }
    return manifestCache;
}

async function fetchJavaEditionLangData() {
    const manifest = await fetchVersionsManifestCached();
    const versionId = getLatestSnapshotVersionId(manifest);
    let cache = cachedOutput("version.common.java.lang");
    if (!cache || cache.__VERSION__ != versionId) {
        console.log("Fetching Java Edition language data...");
        const versionMeta = await fetchVersionMeta(metaApiHost, manifest, versionId);
        const releaseFile = await fetchVersionReleaseFile(releaseApiHost, versionMeta, "client");
        const assetIndex = await fetchVersionAssetIndex(metaApiHost, versionMeta);
        const langZhAsset = await fetchVersionAsset(assetApiHost, assetIndex, "minecraft/lang/zh_cn.json");
        const langEnAsset = extractFileFromZip(releaseFile, "assets/minecraft/lang/en_us.json");
        cache = cachedOutput("version.common.java.lang", {
            __VERSION__: versionMeta.id,
            __VERSION_TYPE__: versionMeta.type,
            __VERSION_TIME__: versionMeta.time,
            zh_cn: JSON.parse(langZhAsset.toString()),
            en_us: JSON.parse(langEnAsset.toString())
        });
    }
    return filterObjectMap(cache, (k) => !(k.startsWith("__") && k.endsWith("__")));
}

module.exports = {
    fetchJavaEditionLangData
};
