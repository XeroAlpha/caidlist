import { addJSONComment, CommentLocation } from '../util/comment.js';
import { cachedOutput, forEachObject, kvArrayToObject } from '../util/common.js';
import { fetchText } from '../util/network.js';

async function fetchMZHWikiRaw(word) {
    return fetchText(`https://minecraft.fandom.com/zh/wiki/${encodeURIComponent(word)}?action=raw`);
}

async function fetchBEDevWikiRaw(word) {
    return fetchText(`https://wiki.mcbe-dev.net/p/${encodeURIComponent(word)}?action=raw`);
}

function parseEnumMapLua(luaContent) {
    const enumMapStack = [{}];
    const itemRegExp = /\['(.*)'\](?:\s*)=(?:\s*)'(.*)'/;
    const groupStartRegExp = /\['(.*)'\](?:\s*)=(?:\s*){/;
    const groupEndRegExp = /\}(?:,)?/;
    const zhHansRegExp = /-\{(.+?)\}-/g;
    luaContent.split('\n').forEach((line) => {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('--')) return;
        let matchResult;
        if ((matchResult = itemRegExp.exec(trimmedLine))) {
            const key = matchResult[1].replace(/\\/g, ''); // 处理 Lua 字符串转义
            const value = matchResult[2].split('|').slice(-1)[0];
            enumMapStack[0][key] = value.replace(zhHansRegExp, '$1');
        } else if ((matchResult = groupStartRegExp.exec(trimmedLine))) {
            const key = matchResult[1].replace(/\\/g, ''); // 处理 Lua 字符串转义
            const group = {};
            enumMapStack[0][key] = group;
            enumMapStack.unshift(group);
        } else if (groupEndRegExp.test(trimmedLine)) {
            if (enumMapStack.length > 1) {
                enumMapStack.shift();
            }
        }
    });
    return enumMapStack[0];
}

// Refer: https://minecraft.fandom.com/zh/wiki/模块:Autolink?action=history
// Last update:  2023/2/2 21:04 by Anterdc99
const enumMapColors = {
    'black ': '黑色',
    'blue ': '蓝色',
    'brown ': '棕色',
    'cyan ': '青色',
    'gray ': '灰色',
    'green ': '绿色',
    'light blue ': '淡蓝色',
    'light gray ': '淡灰色',
    'lime ': '黄绿色',
    'magenta ': '品红色',
    'orange ': '橙色',
    'pink ': '粉红色',
    'purple ': '紫色',
    'red ': '红色',
    'silver ': '淡灰色',
    'white ': '白色',
    'yellow ': '黄色'
};
const enumMapColoredItems = [
    'firework star',
    'hardened clay',
    'stained clay',
    'banner',
    'carpet',
    'concrete',
    'concrete powder',
    'glazed terracotta',
    'terracotta',
    'shield',
    'shulker box',
    'stained glass',
    'stained glass pane',
    'wool',
    'bed',
    'hardened glass',
    'hardened stained glass',
    'balloon',
    'glow stick',
    'hardened glass pane',
    'hardened glass',
    'sparkler',
    'candle'
];
function extendEnumMap(enumMaps) {
    enumMapColoredItems.forEach((item) => {
        ['BlockSprite', 'ItemSprite', 'Exclusive'].forEach((mapName) => {
            const enumMap = enumMaps[mapName];
            const translatedSuffix = enumMap[item];
            if (translatedSuffix) {
                for (const color in enumMapColors) {
                    if (!enumMap[color + item]) {
                        enumMap[color + item] = enumMapColors[color] + translatedSuffix;
                    }
                }
            }
        });
    });
    const entityMap = enumMaps.EntitySprite;
    const itemMap = enumMaps.ItemSprite;
    for (const [baseName, targetName] of Object.entries(entityMap)) {
        itemMap[`${baseName} spawn egg`] = `${targetName}刷怪蛋`;
        itemMap[`spawn ${baseName}`] = `生成${targetName}`;
    }
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

        let bedwOther;
        let bedwGlossary;
        try {
            console.log('Fetching BEDW:ST/Autolink/Others...');
            bedwOther = parseEnumMapLua(await fetchBEDevWikiRaw('Module:Autolink/Other'));

            console.log('Fetching BEDW:ST/Autolink/Glossary...');
            bedwGlossary = parseEnumMapLua(await fetchBEDevWikiRaw('Module:Autolink/Glossary'));
        } catch (err) {
            console.error('Unable to connect to BEDW', err);
        }

        const groupReference = (obj, ref) => {
            if (!obj) return undefined;
            return kvArrayToObject(Object.keys(obj).map((k) => [k, ref]));
        };

        const result = extendEnumMap({
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
        });
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
