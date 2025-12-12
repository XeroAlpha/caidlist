import * as CommentJSON from '@projectxero/comment-json';
import { got } from 'got';
import { addJSONComment, CommentLocation, extractCommentLocation, setJSONComment } from '../util/comment.js';
import { cachedOutput, forEachArray, forEachObject, log, sortObjectKey, warn } from '../util/common.js';
import { parseLSON } from '../util/lson.js';
import { fetchFile } from '../util/network.js';

const sources = {
    mcwzh: {
        getUrl(title) {
            return `https://zh.minecraft.wiki/w/${encodeURIComponent(title)}`;
        },
        async getRaw(title) {
            return await fetchFile(`${this.getUrl(title)}?action=raw`);
        },
        async getCsrfTokens() {
            const res = await got
                .get('https://zh.minecraft.wiki/api.php', {
                    searchParams: {
                        action: 'query',
                        meta: 'tokens',
                        format: 'json'
                    }
                })
                .json();
            return res.query.tokens.csrftoken;
        },
        async execScribuntoConsole(title, content, question, token) {
            const res = await got
                .post('https://zh.minecraft.wiki/api.php', {
                    form: {
                        action: 'scribunto-console',
                        title,
                        content,
                        question,
                        clear: true,
                        token,
                        format: 'json'
                    }
                })
                .json();
            if (res.type === 'error') {
                throw new Error(res.message);
            } else {
                return res.return;
            }
        }
    },
    bedw: {
        getUrl(title) {
            return `https://wiki.mcbe-dev.net/p/${encodeURIComponent(title)}`;
        },
        async getRaw(title) {
            return await fetchFile(`${this.getUrl(title)}?action=raw`);
        }
    }
};

const resolvers = {
    enumMapLua: async (title, source) => {
        const content = (await source.getRaw(title)).toString();
        const match = /return([^]+)/.exec(content.toString());
        if (!match) {
            throw new Error('Illegal LSON');
        }
        const result = parseLSON(match[1]);
        return result;
    },
    mcwzh: async (title, source) => {
        const content = (await source.getRaw(title)).toString();
        const csrfToken = await source.getCsrfTokens();
        const json = JSON.parse(await source.execScribuntoConsole(title, content, '=mw.text.jsonEncode(p)', csrfToken));
        const simplify = (obj) => {
            if (Array.isArray(obj)) {
                return obj;
            }
            const newObj = {};
            for (const [key, value] of Object.entries(obj)) {
                if (key === 'rawKey' || key === 'keyNoLow') {
                    continue;
                }
                if (typeof value === 'object' && value !== null) {
                    if (value.rawKey) {
                        newObj[value.rawKey] = simplify(value);
                    } else {
                        newObj[key] = simplify(value);
                    }
                } else {
                    newObj[key] = value;
                }
            }
            const keys = Object.keys(newObj);
            const numbericKeys = keys.filter((k) => /^\d+$/.test(k));
            if (numbericKeys.length >= 1) {
                const array = [];
                for (const k of keys) {
                    if (numbericKeys.includes(k)) {
                        array[Number(k) - 1] = newObj[k];
                    } else {
                        array[k] = newObj[k];
                    }
                }
                return array;
            }
            return sortObjectKey(newObj);
        };
        const zhConversionHandlerMap = new Map();
        const zhConvert = (obj) => {
            for (const [key, value] of Object.entries(obj)) {
                if (typeof value === 'object' && value !== null) {
                    zhConvert(value);
                } else if (typeof value === 'string') {
                    let conversionHandlers = zhConversionHandlerMap.get(value);
                    if (!conversionHandlers) {
                        conversionHandlers = [];
                        zhConversionHandlerMap.set(value, conversionHandlers);
                    }
                    conversionHandlers.push({ obj, key });
                }
            }
            return obj;
        };
        const map = zhConvert(simplify(json));
        const zhConversionKeys = [...zhConversionHandlerMap.keys()];
        const zhConversionCode = `function(input)
            local zhconv = require('Module:ZhConversion');
            local result = {};
            for i, item in ipairs(input) do
                result[i] = zhconv.to_cn(item);
            end
            return result;
        end`
            .split('\n')
            .map((l) => l.trim())
            .join(' ');
        const zhConversionInput = zhConversionKeys.map((e) => JSON.stringify(e)).join(',');
        const zhConversionResult = JSON.parse(
            await source.execScribuntoConsole(
                title,
                content,
                `=mw.text.jsonEncode((${zhConversionCode})({${zhConversionInput}}))`,
                csrfToken
            )
        );
        for (const [index, value] of zhConversionKeys.entries()) {
            const newValue = zhConversionResult[index];
            const conversionHandlers = zhConversionHandlerMap.get(value);
            for (const { obj, key } of conversionHandlers) {
                obj[key] = newValue;
            }
        }
        return map;
    }
};

/**
 * @type {Array<{
 *      source: keyof typeof sources,
 *      title: string,
 *      resolver: keyof typeof resolvers,
 *      target?: string,
 *      prefix?: string,
 *      ignoreIfExists?: boolean
 * }>}
 */
const dataPages = [
    {
        source: 'mcwzh',
        title: 'Module:Autolink/Block',
        resolver: 'mcwzh',
        target: 'BlockSprite'
    },
    {
        source: 'mcwzh',
        title: 'Module:Autolink/Item',
        resolver: 'mcwzh',
        target: 'ItemSprite'
    },
    {
        source: 'mcwzh',
        title: 'Module:Autolink/Entity',
        resolver: 'mcwzh',
        target: 'EntitySprite'
    },
    {
        source: 'mcwzh',
        title: 'Module:Autolink/Biome',
        resolver: 'mcwzh',
        target: 'BiomeSprite'
    },
    {
        source: 'mcwzh',
        title: 'Module:Autolink/Effect',
        resolver: 'mcwzh',
        target: 'EffectSprite'
    },
    {
        source: 'mcwzh',
        title: 'Module:Autolink/Enchantment',
        resolver: 'mcwzh',
        target: 'EnchantmentSprite'
    },
    {
        source: 'mcwzh',
        title: 'Module:Autolink/Environment',
        resolver: 'mcwzh',
        target: 'EnvSprite'
    },
    {
        source: 'mcwzh',
        title: 'Module:Autolink/Other',
        resolver: 'mcwzh',
        target: 'Other'
    },
    {
        source: 'mcwzh',
        title: 'Module:Autolink/Exclusive',
        resolver: 'mcwzh',
        prefix: 'Exclusive'
    }
    // {
    //     source: 'bedw',
    //     title: 'Module:Autolink/Glossary',
    //     resolver: 'enumMapLua',
    //     prefix: ''
    // },
    // {
    //     // Deprecated
    //     source: 'bedw',
    //     title: 'Module:Autolink/Other',
    //     resolver: 'enumMapLua',
    //     prefix: '',
    //     ignoreIfExists: true
    // }
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
                    } catch {
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
        cache = await cachedOutput(
            'version.common.wiki.standardized_translation',
            async () => {
                const errors = [];
                let result = {};
                await forEachArray(dataPages, async (e) => {
                    log(`Fetching ${e.source}:${e.title}`);
                    try {
                        const source = sources[e.source];
                        const resolver = resolvers[e.resolver];
                        const url = source.getUrl(e.title);
                        const data = await resolver(e.title, source);
                        const refComment = `Reference: ${url}`;
                        if (e.target) {
                            result[e.target] = data;
                            setJSONComment(result, CommentLocation.before(e.target), 'line', refComment);
                        } else {
                            const prefix = e.prefix || '';
                            forEachObject(data, (v, k) => {
                                const resultKey = `${prefix}${k}`;
                                if (e.ignoreIfExists && resultKey in result) {
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
                    if (cache) {
                        CommentJSON.assign(cache, result);
                    }
                    throw new AggregateError(errors);
                }
                return result;
            },
            60 * 60 * 1000
        );
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
