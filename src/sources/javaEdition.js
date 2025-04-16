import { URL } from 'url';
import AdmZip from 'adm-zip';
import { cachedOutput, filterObjectMap, log, warn } from '../util/common.js';
import { fetchFile, fetchJSON } from '../util/network.js';

const releaseApiHost = 'https://piston-data.mojang.com/';
const metaApiHost = 'https://piston-meta.mojang.com';
const assetApiHost = 'https://resources.download.minecraft.net';

const skipVersions = [
    '15w14a',
    '1.RV-Pre1',
    '3D Shareware v1.34',
    '20w14infinite',
    '22w13oneblockatatime',
    '23w13a_or_b',
    '24w14potato',
    '25w14craftmine'
];

function replaceUrlHost(url, host) {
    const urlObj = new URL(url, host);
    const hostObj = new URL(host);
    urlObj.host = hostObj.host;
    return urlObj.toString();
}

async function fetchVersionsManifest(apiHost) {
    return fetchJSON(`${apiHost}/mc/game/version_manifest.json`);
}

function getLatestSnapshotVersionId(manifest) {
    const latest = manifest.latest.snapshot;
    if (skipVersions.includes(latest)) {
        const filtered = manifest.versions.filter((v) => !skipVersions.includes(v.id));
        const maxVersion = filtered.reduce((max, v) => {
            if (Date.parse(v.releaseTime) > Date.parse(max.releaseTime)) {
                return v;
            }
            return max;
        });
        return maxVersion.id;
    }
    return latest;
}

async function fetchVersionMeta(apiHost, manifest, versionId) {
    const version = manifest.versions.find((versionInfo) => versionInfo.id === versionId);
    if (!version) throw new Error(`Version not found: ${versionId}`);
    return fetchJSON(replaceUrlHost(version.url, apiHost));
}

function getReleaseFileUrl(versionMeta, releaseId) {
    const release = versionMeta.downloads[releaseId];
    if (!release) throw new Error(`Release file not found: ${releaseId}`);
    return release.url;
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

function getVersionAssetHash(assetIndex, objectName) {
    const object = assetIndex.objects[objectName];
    if (!object) throw new Error(`Asset object not found: ${objectName}`);
    return object.hash;
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

async function fetchJavaEditionLangData() {
    let cache = cachedOutput('version.common.java.lang');
    try {
        const manifest = await fetchVersionsManifest(metaApiHost);
        const overwriteVersionId = process.env.IDLIST_JAVA_VERSION_OVERWRITE;
        const versionId = overwriteVersionId ?? getLatestSnapshotVersionId(manifest);
        const versionMeta = await fetchVersionMeta(metaApiHost, manifest, versionId);
        const assetIndex = await fetchVersionAssetIndex(metaApiHost, versionMeta);
        const overwriteReleaseUrl = process.env.IDLIST_JAVA_RELEASE_URL_OVERWRITE;
        const releaseUrl = overwriteReleaseUrl ?? getReleaseFileUrl(versionMeta, 'client');
        const overwriteZhcnLangHash = process.env.IDLIST_JAVA_ZH_CN_LANG_HASH_OVERWRITE;
        const zhcnLangHash = overwriteZhcnLangHash ?? getVersionAssetHash(assetIndex, 'minecraft/lang/zh_cn.json');
        let zh_cn;
        let en_us;
        if (cache) {
            if (cache.__RELEASE_CLIENT__ === releaseUrl) {
                en_us = cache.en_us;
            }
            if (cache.__ZH_CN_LANG_HASH__ === zhcnLangHash) {
                zh_cn = cache.zh_cn;
            }
        }
        if (!zh_cn || !en_us) {
            log(`Fetching Java Edition language data: ${versionId}`);
            const releaseFile = await fetchVersionReleaseFile(releaseApiHost, versionMeta, 'client');
            const langZhAsset = await fetchVersionAsset(assetApiHost, assetIndex, 'minecraft/lang/zh_cn.json');
            const langEnAsset = extractFileFromZip(releaseFile, 'assets/minecraft/lang/en_us.json');
            cache = cachedOutput('version.common.java.lang', {
                __VERSION__: versionMeta.id,
                __VERSION_TYPE__: versionMeta.type,
                __VERSION_TIME__: versionMeta.time,
                __RELEASE_CLIENT__: releaseUrl,
                __ZH_CN_LANG_HASH__: zhcnLangHash,
                zh_cn: JSON.parse(langZhAsset.toString()),
                en_us: JSON.parse(langEnAsset.toString())
            });
        }
    } catch (err) {
        if (!cache) {
            throw err;
        }
        warn('Failed to fetch version manifest of java edition, use cache instead', err);
    }
    return filterObjectMap(cache, (k) => !(k.startsWith('__') && k.endsWith('__')));
}

let cache;
export default async function fetchJavaEditionLangDataCached() {
    if (!cache) {
        cache = await fetchJavaEditionLangData();
    }
    return cache;
}
