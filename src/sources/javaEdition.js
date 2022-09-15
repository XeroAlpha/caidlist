import { URL } from 'url';
import AdmZip from 'adm-zip';
import { cachedOutput, filterObjectMap } from '../util/common.js';
import { fetchFile, fetchJSON } from '../util/network.js';

const releaseApiHost = 'https://piston-data.mojang.com/';
const metaApiHost = 'https://piston-meta.mojang.com';
const assetApiHost = 'https://resources.download.minecraft.net';

function replaceUrlHost(url, host) {
    const urlObj = new URL(url, host);
    const hostObj = new URL(host);
    urlObj.origin = hostObj.origin;
    return urlObj.toString();
}

async function fetchVersionsManifest(apiHost) {
    return fetchJSON(`${apiHost}/mc/game/version_manifest.json`);
}

function getLatestSnapshotVersionId(manifest) {
    return manifest.latest.snapshot;
}

async function fetchVersionMeta(apiHost, manifest, versionId) {
    const version = manifest.versions.find((versionInfo) => versionInfo.id === versionId);
    if (!version) throw new Error(`Version not found: ${versionId}`);
    return fetchJSON(replaceUrlHost(version.url, apiHost));
}

async function fetchVersionReleaseFile(apiHost, versionMeta, releaseId) {
    const release = versionMeta.downloads[releaseId];
    if (!release) throw new Error(`Release file not found: ${releaseId}`);
    return fetchFile(replaceUrlHost(release.url, apiHost), release.size, release.sha1);
}

async function fetchVersionAssetIndex(apiHost, versionMeta) {
    const meta = versionMeta.assetIndex;
    return fetchJSON(replaceUrlHost(meta.url, apiHost), meta.size, meta.sha1);
}

async function fetchVersionAsset(apiHost, assetIndex, objectName) {
    const object = assetIndex.objects[objectName];
    if (!object) throw new Error(`Asset object not found: ${objectName}`);
    const url = replaceUrlHost(`/${object.hash.slice(0, 2)}/${object.hash}`, apiHost);
    return fetchFile(url, object.size, object.sha1);
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

export default async function fetchJavaEditionLangData() {
    let cache = cachedOutput('version.common.java.lang');
    try {
        const manifest = await fetchVersionsManifestCached();
        const versionId = getLatestSnapshotVersionId(manifest);
        if (!cache || cache.__VERSION__ !== versionId) {
            console.log('Fetching Java Edition language data...');
            const versionMeta = await fetchVersionMeta(metaApiHost, manifest, versionId);
            const releaseFile = await fetchVersionReleaseFile(releaseApiHost, versionMeta, 'client');
            const assetIndex = await fetchVersionAssetIndex(metaApiHost, versionMeta);
            const langZhAsset = await fetchVersionAsset(assetApiHost, assetIndex, 'minecraft/lang/zh_cn.json');
            const langEnAsset = extractFileFromZip(releaseFile, 'assets/minecraft/lang/en_us.json');
            cache = cachedOutput('version.common.java.lang', {
                __VERSION__: versionMeta.id,
                __VERSION_TYPE__: versionMeta.type,
                __VERSION_TIME__: versionMeta.time,
                zh_cn: JSON.parse(langZhAsset.toString()),
                en_us: JSON.parse(langEnAsset.toString())
            });
        }
    } catch (err) {
        if (!cache) {
            throw err;
        }
        console.error(`Failed to fetch version manifest of java edition, use cache instead: ${err}`);
    }
    return filterObjectMap(cache, (k) => !(k.startsWith('__') && k.endsWith('__')));
}
