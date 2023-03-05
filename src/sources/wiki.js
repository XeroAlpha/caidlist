import { addJSONComment, CommentLocation } from '../util/comment.js';
import { cachedOutput, forEachObject, kvArrayToObject } from '../util/common.js';
import { parseLSON } from '../util/lson.js';
import { fetchText } from '../util/network.js';

async function fetchMZHWikiRaw(word) {
    return fetchText(`https://minecraft.fandom.com/zh/wiki/${encodeURIComponent(word)}?action=raw`);
}

async function fetchBEDevWikiRaw(word) {
    return fetchText(`https://wiki.mcbe-dev.net/p/${encodeURIComponent(word)}?action=raw`);
}

function parseEnumMapLua(luaContent) {
    const match = /return([^]+)/.exec(luaContent);
    if (!match) {
        throw new Error('Illegal LSON');
    }
    const result = parseLSON(match[1]);
    if (Array.isArray(result) && result.length === 0) {
        return {};
    }
    return result;
}

// Refer: https://minecraft.fandom.com/zh/wiki/模块:Autolink?action=history
// Last update:  2023/3/3 13:31 by Anterdc99
function postprocessEnumMap(enumMaps, compatibleMode) {
    forEachObject(enumMaps, (enumMap) => {
        let prevKey;
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
        console.log('Fetching MCWZH:ST/Autolink/Block...');
        const block = parseEnumMapLua(await fetchMZHWikiRaw('模块:Autolink/Block'));

        console.log('Fetching MCWZH:ST/Autolink/Item...');
        const item = parseEnumMapLua(await fetchMZHWikiRaw('模块:Autolink/Item'));

        console.log('Fetching MCWZH:ST/Autolink/Exclusive...');
        const exclusive = parseEnumMapLua(await fetchMZHWikiRaw('模块:Autolink/Exclusive'));

        console.log('Fetching MCWZH:ST/Autolink/Entity...');
        const entity = parseEnumMapLua(await fetchMZHWikiRaw('模块:Autolink/Entity'));

        console.log('Fetching MCWZH:ST/Autolink/Biome...');
        const biome = parseEnumMapLua(await fetchMZHWikiRaw('模块:Autolink/Biome'));

        console.log('Fetching MCWZH:ST/Autolink/Effect...');
        const effect = parseEnumMapLua(await fetchMZHWikiRaw('模块:Autolink/Effect'));

        console.log('Fetching MCWZH:ST/Autolink/Other...');
        const mcwzhOther = parseEnumMapLua(await fetchMZHWikiRaw('模块:Autolink/Other'));

        console.log('Fetching BEDW:ST/Autolink/Others...');
        const bedwOther = parseEnumMapLua(await fetchBEDevWikiRaw('Module:Autolink/Other'));

        console.log('Fetching BEDW:ST/Autolink/Glossary...');
        const bedwGlossary = parseEnumMapLua(await fetchBEDevWikiRaw('Module:Autolink/Glossary'));

        const groupReference = (obj, ref) => {
            if (!obj) return undefined;
            return kvArrayToObject(Object.keys(obj).map((k) => [k, ref]));
        };

        const result = postprocessEnumMap({
            // Keep them in order. 'Sprite' is just a common suffix here
            BlockSprite: block,
            ItemSprite: item,
            Exclusive: exclusive,
            ...bedwGlossary,
            ...bedwOther,
            BiomeSprite: biome,
            EffectSprite: effect,
            EntitySprite: entity,
            ...mcwzhOther
        }, false);
        const referenceMap = {
            BlockSprite: 'https://minecraft.fandom.com/zh/wiki/%E6%A8%A1%E5%9D%97:Autolink/Block',
            ItemSprite: 'https://minecraft.fandom.com/zh/wiki/%E6%A8%A1%E5%9D%97:Autolink/Item',
            Exclusive: 'https://minecraft.fandom.com/zh/wiki/%E6%A8%A1%E5%9D%97:Autolink/Exclusive',
            ...groupReference(bedwGlossary, 'https://wiki.mcbe-dev.net/p/Module:Autolink/Glossary'),
            ...groupReference(bedwOther, 'https://wiki.mcbe-dev.net/p/Module:Autolink/Other'),
            BiomeSprite: 'https://minecraft.fandom.com/zh/wiki/%E6%A8%A1%E5%9D%97:Autolink/Biome',
            EffectSprite: 'https://minecraft.fandom.com/zh/wiki/%E6%A8%A1%E5%9D%97:Autolink/Effect',
            EntitySprite: 'https://minecraft.fandom.com/zh/wiki/%E6%A8%A1%E5%9D%97:Autolink/Entity',
            ...groupReference(mcwzhOther, 'https://minecraft.fandom.com/zh/wiki/%E6%A8%A1%E5%9D%97:Autolink/Other')
        };
        forEachObject(referenceMap, (v, k) => {
            addJSONComment(result, CommentLocation.before(k), 'line', `Reference: ${v}`);
        });
        return result;
    }, 24 * 60 * 60 * 1000);
}
