import * as CommentJSON from '@projectxero/comment-json';
import { addJSONComment, CommentLocation, extractCommentLocation, setJSONComment } from '../util/comment.js';
import { cachedOutput, forEachArray, forEachObject, log, warn } from '../util/common.js';
import { parseLSON } from '../util/lson.js';
import { fetchFile } from '../util/network.js';

const sources = {
    mcwzh: {
        getUrl(name) {
            return `https://zh.minecraft.wiki/w/${encodeURIComponent(name)}`;
        },
        getRawUrl(name) {
            return `${this.getUrl(name)}?action=raw`;
        }
    },
    bedw: {
        getUrl(name) {
            return `https://wiki.mcbe-dev.net/p/${encodeURIComponent(name)}`;
        },
        getRawUrl(name) {
            return `${this.getUrl(name)}?action=raw`;
        }
    }
};

const resolvers = {
    enumMapLua: (content) => {
        const match = /return([^]+)/.exec(content.toString());
        if (!match) {
            throw new Error('Illegal LSON');
        }
        const result = parseLSON(match[1]);
        return result;
    }
};

/**
 * @type {Array<{
 *      source: keyof sources,
 *      name: string,
 *      resolver: keyof resolvers,
 *      target?: string,
 *      prefix?: string,
 *      ignoreIfExists?: boolean
 * }>}
 */
const dataPages = [
    {
        source: 'mcwzh',
        name: 'Module:Autolink/Block',
        resolver: 'enumMapLua',
        target: 'BlockSprite'
    },
    {
        source: 'mcwzh',
        name: 'Module:Autolink/Item',
        resolver: 'enumMapLua',
        target: 'ItemSprite'
    },
    {
        source: 'mcwzh',
        name: 'Module:Autolink/Entity',
        resolver: 'enumMapLua',
        target: 'EntitySprite'
    },
    {
        source: 'mcwzh',
        name: 'Module:Autolink/Biome',
        resolver: 'enumMapLua',
        target: 'BiomeSprite'
    },
    {
        source: 'mcwzh',
        name: 'Module:Autolink/Effect',
        resolver: 'enumMapLua',
        target: 'EffectSprite'
    },
    {
        source: 'mcwzh',
        name: 'Module:Autolink/Enchantment',
        resolver: 'enumMapLua',
        target: 'EnchantmentSprite'
    },
    {
        source: 'mcwzh',
        name: 'Module:Autolink/Environment',
        resolver: 'enumMapLua',
        target: 'EnvSprite'
    },
    {
        source: 'mcwzh',
        name: 'Module:Autolink/Other',
        resolver: 'enumMapLua',
        target: 'Other'
    },
    {
        source: 'mcwzh',
        name: 'Module:Autolink/Exclusive',
        resolver: 'enumMapLua',
        prefix: 'Exclusive'
    },
    {
        source: 'bedw',
        name: 'Module:Autolink/Glossary',
        resolver: 'enumMapLua',
        prefix: ''
    },
    {
        // Deprecated
        source: 'bedw',
        name: 'Module:Autolink/Other',
        resolver: 'enumMapLua',
        prefix: '',
        ignoreIfExists: true
    }
];

// Reference: https://zh.minecraft.wiki/w/Module:Autolink?action=history
// Last update:  2023/4/26 22:09 UTC+8 by Anterdc99
function postprocessEnumMap(enumMaps) {
    forEachObject(enumMaps, (enumMap, enumMapKey) => {
        let prevKey;
        if (Array.isArray(enumMap) && enumMap.length === 0) {
            enumMaps[enumMapKey] = {};
            return;
        }
        Object.keys(enumMap).forEach((k) => {
            let v = enumMap[k];
            let hidden;
            if (Array.isArray(v)) {
                [v, hidden] = v;
            }
            const verticalBar = v.lastIndexOf('|');
            if (verticalBar >= 0) {
                v = v.slice(verticalBar + 1);
            }
            v = v.replace(/-\{(.*?)\}-/, '$1');
            enumMap[k] = v;
            if (hidden) {
                const commentLoc = prevKey ? CommentLocation.after(prevKey) : CommentLocation.before();
                addJSONComment(enumMap, commentLoc, 'line', ` ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
                delete enumMap[k];
            } else {
                prevKey = k;
            }
        });
    });
    return enumMaps;
}
const hiddenEntryLogSymbol = Symbol('hiddenEntryLog');
function restoreHiddenEntries(enumMaps) {
    const hiddenEntryLog = {};
    forEachObject(enumMaps, (enumMap, enumMapKey) => {
        const symbolKeys = Object.getOwnPropertySymbols(enumMap);
        symbolKeys.forEach((symbolKey) => {
            const commentLoc = extractCommentLocation(symbolKey);
            if (!commentLoc) return;
            if (commentLoc.type === 'before' || commentLoc.type === 'after') {
                let comments = enumMap[symbolKey];
                comments = comments.filter((comment) => {
                    let parsedEntryObj;
                    try {
                        parsedEntryObj = CommentJSON.parse(`{${comment.value}}`);
                    } catch (err) {
                        return false;
                    }
                    Object.entries(parsedEntryObj).forEach(([key, value]) => {
                        Object.defineProperty(enumMap, key, {
                            get() {
                                let hiddenEntryLogMap = hiddenEntryLog[enumMapKey];
                                if (!hiddenEntryLogMap) {
                                    hiddenEntryLogMap = hiddenEntryLog[enumMapKey] = {};
                                }
                                hiddenEntryLogMap[key] = value;
                                return value;
                            }
                        });
                    });
                    return true;
                });
                if (comments.length) {
                    enumMap[symbolKey] = comments;
                } else {
                    delete enumMap[symbolKey];
                }
            }
        });
    });
    enumMaps[hiddenEntryLogSymbol] = hiddenEntryLog;
    return enumMaps;
}

let stGlobalCache;
export async function fetchStandardizedTranslation() {
    if (stGlobalCache) return stGlobalCache;
    let cache = cachedOutput('version.common.wiki.standardized_translation');
    try {
        cache = await cachedOutput('version.common.wiki.standardized_translation', async () => {
            const errors = [];
            let result = {};
            await forEachArray(dataPages, async (e) => {
                log(`Fetching ${e.source}:${e.name}`);
                try {
                    const source = sources[e.source];
                    const resolver = resolvers[e.resolver];
                    const url = source.getUrl(e.name);
                    const rawUrl = source.getRawUrl(e.name);
                    const content = await fetchFile(rawUrl);
                    const data = resolver(content);
                    const refComment = `Reference: ${url}`;
                    if (e.target) {
                        result[e.target] = data;
                        setJSONComment(result, CommentLocation.before(e.target), 'line', refComment);
                    } else {
                        const prefix = e.prefix || '';
                        forEachObject(data, (v, k) => {
                            const resultKey = `${prefix}${k}`;
                            if (e.ignoreIfExists && (resultKey in result)) {
                                return;
                            }
                            result[resultKey] = v;
                            setJSONComment(result, CommentLocation.before(resultKey), 'line', refComment);
                        });
                    }
                } catch (err) {
                    errors.push(err);
                }
            });
            result = postprocessEnumMap(result);
            if (errors.length > 0) {
                CommentJSON.assign(cache, result);
                throw new AggregateError(errors);
            }
            return result;
        }, 24 * 60 * 60 * 1000);
    } catch (err) {
        if (!cache) {
            throw err;
        }
        warn('Failed to fetch standardized translation, use cache instead', err);
    }
    const restoredResult = restoreHiddenEntries(cache);
    stGlobalCache = restoredResult;
    return restoredResult;
}

export function writeHiddenEntryLog(cx, enumMaps) {
    const { version, branch } = cx;
    cachedOutput(`output.wiki.deprecated.${version}.${branch.id}`, enumMaps[hiddenEntryLogSymbol]);
}
