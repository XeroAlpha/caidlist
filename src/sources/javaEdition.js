const AdmZip = require("adm-zip");
const { cachedOutput, filterObjectMap } = require("../util/common");
const { fetchFile, fetchJSON } = require("../util/network");

const releaseApiHost = "https://launcher.mojang.com";
const metaApiHost = "https://launchermeta.mojang.com";
const assetApiHost = "https://resources.download.minecraft.net";

async function fetchVersionsManifest(apiHost) {
    return await fetchJSON(`${apiHost}/mc/game/version_manifest.json`);
}

async function fetchVersionMeta(apiHost, manifest, versionId) {
    if (versionId == "latest" || versionId == "lastest_release") {
        versionId = manifest.latest.release;
    } else if (versionId == "latest_snapshot") {
        versionId = manifest.latest.snapshot;
    }
    const version = manifest.versions.find((version) => version.id == versionId);
    if (!version) throw new Error("Version not found: " + versionId);
    const url = version.url.replace("https://launchermeta.mojang.com", apiHost);
    return await fetchJSON(url);
}

async function fetchVersionReleaseFile(apiHost, versionMeta, releaseId) {
    let release = versionMeta.downloads[releaseId];
    if (!release) throw new Error("Release file not found: " + releaseId);
    const url = release.url.replace("https://launcher.mojang.com", apiHost);
    return await fetchFile(url, release.size, release.sha1);
}

async function fetchVersionAssetIndex(apiHost, versionMeta) {
    const meta = versionMeta.assetIndex;
    const url = meta.url.replace("https://launchermeta.mojang.com", apiHost);
    return await fetchJSON(url, meta.size, meta.sha1);
}

async function fetchVersionAsset(apiHost, assetIndex, objectName) {
    const object = assetIndex.objects[objectName];
    if (!object) throw new Error("Asset object not found: " + objectName);
    const url = `${apiHost}/${object.hash.slice(0, 2)}/${object.hash}`;
    return await fetchFile(url, object.size, object.sha1);
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
        const langEnAsset = extractFileFromZip(releaseFile, "assets/minecraft/lang/en_us.json");
        return {
            __VERSION__: versionMeta.id,
            __VERSION_TYPE__: versionMeta.type,
            __VERSION_TIME__: versionMeta.time,
            zh_cn: JSON.parse(langZhAsset.toString()),
            en_us: JSON.parse(langEnAsset.toString())
        };
    });
    return filterObjectMap(result, (k) => !k.startsWith("__"));
}

module.exports = {
    fetchJavaEditionLangData
};
