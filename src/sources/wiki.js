import { addJSONComment, CommentLocation, setJSONComment } from '../util/comment.js';
import { cachedOutput, forEachArray, forEachObject } from '../util/common.js';
import { parseLSON } from '../util/lson.js';
import { fetchFile } from '../util/network.js';

const sources = {
    mcwzh: {
        getUrl(name) {
            return `https://minecraft.fandom.com/zh/wiki/${encodeURIComponent(name)}`;
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
        name: '模块:Autolink/Block',
        resolver: 'enumMapLua',
        target: 'BlockSprite'
    },
    {
        source: 'mcwzh',
        name: '模块:Autolink/Item',
        resolver: 'enumMapLua',
        target: 'ItemSprite'
    },
    {
        source: 'mcwzh',
        name: '模块:Autolink/Entity',
        resolver: 'enumMapLua',
        target: 'EntitySprite'
    },
    {
        source: 'mcwzh',
        name: '模块:Autolink/Biome',
        resolver: 'enumMapLua',
        target: 'BiomeSprite'
    },
    {
        source: 'mcwzh',
        name: '模块:Autolink/Effect',
        resolver: 'enumMapLua',
        target: 'EffectSprite'
    },
    {
        source: 'mcwzh',
        name: '模块:Autolink/Enchantment',
        resolver: 'enumMapLua',
        target: 'EnchantmentSprite'
    },
    {
        source: 'mcwzh',
        name: '模块:Autolink/Environment',
        resolver: 'enumMapLua',
        target: 'EnvSprite'
    },
    {
        source: 'mcwzh',
        name: '模块:Autolink/Other',
        resolver: 'enumMapLua',
        target: 'Other'
    },
    {
        source: 'mcwzh',
        name: '模块:Autolink/Exclusive',
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

// Refer: https://minecraft.fandom.com/zh/wiki/模块:Autolink?action=history
// Last update:  2023/3/8 09:32 by Anterdc99
function postprocessEnumMap(enumMaps, compatibleMode) {
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
            if (compatibleMode) {
                if (hidden) {
                    addJSONComment(enumMap, CommentLocation.after(k), 'inlineLine', ' Hidden');
                }
            } else if (hidden) {
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

export default async function fetchStandardizedTranslation() {
    return cachedOutput('version.common.wiki.standardized_translation', async () => {
        const result = {};
        await forEachArray(dataPages, async (e) => {
            console.log(`Fetching ${e.source}:${e.name}`);
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
        });
        return postprocessEnumMap(result, false);
    }, 24 * 60 * 60 * 1000);
}
