const fs = require("fs");
const AdmZip = require("adm-zip");
const {
    forEachObject,
    filterObjectMap,
    replaceObjectKey,
    kvArrayToObject,
    deepCopy
} = require("../util/common");

const lineBreak = "\r\n";

const skipTransMapKey = ["lootTableWrapped", "music", "summonableEntity", "lootTool"];
function filterRedundantEnums(transMaps) {
    return filterObjectMap(transMaps, k => !skipTransMapKey.includes(k));
}

const entityNameAlias = {
    "minecraft:villager_v2": "村民",
    "minecraft:zombie_villager_v2": "僵尸村民"
};
function fixEntityRelatedIds(transMap, relatedEntityMap, entityNameMap, relatedEntitieModifier) {
    let splitMap = {};
    forEachObject(transMap, (v, k, o) => {
        let relatedEntities = relatedEntityMap[k];
        let relatedEntitiesStr = relatedEntities.map(e => {
            let withoutComp = e.replace(/<.+>$/, "");
            return entityNameAlias[withoutComp] || entityNameMap[withoutComp] || withoutComp;
        }).filter((e, i, a) => a.indexOf(e) >= i);
        relatedEntitiesStr.forEach(e => {
            let brotherItems = splitMap[e];
            if (!brotherItems) {
                brotherItems = splitMap[e] = {};
            }
            brotherItems[k] = v;
        });
        if (relatedEntitieModifier) {
            relatedEntitieModifier(relatedEntitiesStr);
        }
        if (relatedEntitiesStr.length > 0) {
            v += "（" + relatedEntitiesStr.join("、") + "）";
            o[k] = v;
        }
    });
    return splitMap;
}

function generateTextFromMapTree(map, treeDepth) {
    let output = [];
    if (treeDepth > 0) {
        forEachObject(map, (submap, mapName) => {
            output.push("【" + mapName + "】");
            output.push(...generateTextFromMapTree(submap, treeDepth - 1));
            output.push("");
        });
    } else {
        forEachObject(map, (v, k) => output.push(k + ": " + v));
    }
    return output;
}

function writeTransMapTextZip(cx, options) {
    const branchName = cx.branch.name;
    const { packageVersion } = cx;
    const {
        outputFile,
        originalEnums,
        transMaps,
        transMapNames,
        stdTransMap,
        stdTransMapNames
    } = options;
    const gameVersionText = packageVersion + "（" + branchName + "）";
    const footText = [
        "※此ID表是MCBEID表的一部分，对应游戏版本为" + gameVersionText,
        "※详见：https://gitee.com/projectxero/caidlist"
    ];
    let entityEventSplit, stdTransText;
    let enums = deepCopy(filterRedundantEnums(transMaps));
    if (originalEnums) {
        let entityEventByEntity = fixEntityRelatedIds(
            enums.entityEvent,
            originalEnums.entityEventsMap,
            enums.entity
        );
        fixEntityRelatedIds(
            enums.entityFamily,
            originalEnums.entityFamilyMap,
            enums.entity,
            (relatedEntities) => {
                if (relatedEntities.length == 1) {
                    relatedEntities.length = 0;
                }
            }
        );
        entityEventSplit = generateTextFromMapTree(entityEventByEntity, 1);
        entityEventSplit.push(...footText);
    }
    if (stdTransMap) {
        stdTransText = generateTextFromMapTree(
            kvArrayToObject(stdTransMapNames.map(e => {
                const [ key, name ] = e;
                return [ name, stdTransMap[key] ];
            })),
            1
        );
        stdTransText.push(...footText);
    }
    let zip = new AdmZip();
    let files = {
        ...replaceObjectKey(enums, [
            [ /(.+)/, "$1.txt" ]
        ]),
        "entityEventSplit.txt": entityEventSplit,
        "stdTrans.txt": stdTransText
    };
    let fileDescriptions = transMapNames.map(e => [e[0] + ".txt", e[1]]);
    files["_MCBEID_.txt"] = [
        "【MCBEID表】",
        "在线版：https://ca.projectxero.top/idlist/",
        "本ID表由B站@ProjectXero与命令助手开发组的小伙伴们维护，发现错误或有建议可私聊UP主或加群【MCBE命令助手开发区】：671317302",
        "",
        "发布时间：" + new Date().toLocaleString(),
        "对应游戏版本：" + gameVersionText,
        "",
        "Minecraft 命令更新日志：https://ca.projectxero.top/blog/command/command-history/",
        "",
        "【目录】",
        ...fileDescriptions.filter(e => files[e[0]]).map(e => e[0] + ": " + e[1])
    ];
    forEachObject(files, (content, fileName) => {
        if (Array.isArray(content)) {
            content = content.join(lineBreak);
        } else if (typeof content == "object") {
            let contentDescription = fileDescriptions.find(e => e[0] == fileName);
            let arr = [], obj;
            if (contentDescription) {
                obj = { [contentDescription[1]]: content };
            } else {
                obj = content;
            }
            arr.push(...generateTextFromMapTree(obj, 1));
            arr.push(...footText);
            content = arr.join(lineBreak);
        } else {
            return;
        }
        zip.addFile(fileName, Buffer.from(content, "utf-8"));
    });
    fs.writeFileSync(outputFile, zip.toBuffer());
}

module.exports = {
    filterRedundantEnums,
    fixEntityRelatedIds,
    generateTextFromMapTree,
    writeTransMapTextZip
}