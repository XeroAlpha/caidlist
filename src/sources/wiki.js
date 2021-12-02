const got = require("got").default;
const { cachedOutput } = require("../util/common");

async function fetchMZHWikiRaw(word) {
    return await got(`https://minecraft.fandom.com/zh/wiki/${word}?action=raw`).text();
}

async function fetchBEDevWikiRaw(word) {
    return await got(`https://wiki.bedev.cn/${word}?action=raw`).text();
}

function parseEnumMapLua(luaContent) {
    let enumMapStack = [{}];
    let itemRegExp = /\['(.*)'\](?:\s*)=(?:\s*)'(.*)'/,
        groupStartRegExp = /\['(.*)'\](?:\s*)=(?:\s*){/,
        groupEndRegExp = /\}(?:,)?/,
        zhHansRegExp = /-\{(.+?)\}-/g;
    luaContent.split("\n")
        .forEach(line => {
            line = line.trim();
            if (line.startsWith("--")) return;
            let matchResult;
            if (matchResult = itemRegExp.exec(line)) {
                let key = matchResult[1].replace(/\\/g, ""); // 处理 Lua 字符串转义
                let value = matchResult[2].split("|").slice(-1)[0];
                enumMapStack[0][key] = value.replace(zhHansRegExp, "$1");
            } else if (matchResult = groupStartRegExp.exec(line)) {
                let key = matchResult[1].replace(/\\/g, ""); // 处理 Lua 字符串转义
                let group = {};
                enumMapStack[0][key] = group;
                enumMapStack.unshift(group);
            } else if (groupEndRegExp.test(line)) {
                if (enumMapStack.length > 1) {
                    enumMapStack.shift();
                }
            }
        });
    return enumMapStack[0];
}

const enumMapColors = {
    "black ": "黑色", "blue ": "蓝色",
    "brown ": "棕色", "cyan ": "青色",
    "gray ": "灰色", "green ": "绿色",
    "light blue ": "淡蓝色", "light gray ": "淡灰色",
    "lime ": "黄绿色", "magenta ": "品红色",
    "orange ": "橙色", "pink ": "粉红色",
    "purple ": "紫色", "red ": "红色",
    "silver ": "淡灰色", "white ": "白色",
    "yellow ": "黄色"
};
const enumMapColoredItems = [
    "firework star", "hardened clay", "stained clay", "banner",
    "carpet", "concrete", "concrete powder", "glazed terracotta",
    "terracotta", "shield", "shulker box", "stained glass",
    "stained glass pane", "wool", "bed", "hardened glass",
    "hardened stained glass", "balloon", "glow stick",
    "hardened glass pane", "hardened glass", "sparkler", "candle"
];
function extendEnumMap(enumMaps) {
    enumMapColoredItems.forEach(item => {
        ["BlockSprite", "ItemSprite", "Exclusive"].forEach(mapName => {
            let enumMap = enumMaps[mapName];
            let color, translatedSuffix = enumMap[item];
            if (translatedSuffix) {
                for (color in enumMapColors) {
                    if (!enumMap[color + item]) {
                        enumMap[color + item] = enumMapColors[color] + translatedSuffix;
                    }
                }
            }
        });
    });
    let entity, entityMap = enumMaps["EntitySprite"], itemMap = enumMaps["ItemSprite"];
    for (entity in entityMap) {
        itemMap[entity + " spawn egg"] = entityMap[entity] + "刷怪蛋";
        itemMap["spawn " + entity] = "生成" + entityMap[entity];
    }
    return enumMaps;
}

async function fetchStandardizedTranslation() {
    return cachedOutput("wiki.standardized_translation", async () => {
        let block, item, exclusive, mcwzhOthers, bedwOthers, bedwGlossary;

        console.log("Fetching MCWZH:ST/Autolink/Block...");
        block = parseEnumMapLua(await fetchMZHWikiRaw("模块:Autolink/Block"));

        console.log("Fetching MCWZH:ST/Autolink/Item...");
        item = parseEnumMapLua(await fetchMZHWikiRaw("模块:Autolink/Item"));

        console.log("Fetching MCWZH:ST/Autolink/Exclusive...");
        exclusive = parseEnumMapLua(await fetchMZHWikiRaw("模块:Autolink/Exclusive"));

        console.log("Fetching MCWZH:ST/Autolink/Others...");
        mcwzhOthers = parseEnumMapLua(await fetchMZHWikiRaw("模块:Autolink/Other"));
        
        try {
            console.log("Fetching BEDW:ST/Autolink/Others...")
            bedwOthers = parseEnumMapLua(await fetchBEDevWikiRaw("模块:Autolink/Other"));

            console.log("Fetching BEDW:ST/Autolink/Glossary...")
            bedwGlossary = parseEnumMapLua(await fetchBEDevWikiRaw("模块:Autolink/Glossary"));
        } catch(err) {
            console.error("Unable to connect to BEDW", err);
        }

        return extendEnumMap({
            BlockSprite: block,
            ItemSprite: item,
            Exclusive: exclusive,
            ...bedwGlossary,
            ...bedwOthers,
            ...mcwzhOthers
        });
    });
}

module.exports = {
    fetchStandardizedTranslation
};