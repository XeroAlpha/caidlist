const fs = require("fs");
const AdmZip = require("adm-zip");
const {
    projectInfo,
    forEachObject,
    filterObjectMap,
    replaceObjectKey,
    kvArrayToObject,
    deepCopy,
    uniqueAndSort
} = require("../util/common");

const lineBreak = "\r\n";

const redundantEnumKey = ["lootTableWrapped", "music", "summonableEntity", "lootTool"];
const skipEnumKey = ["command", "blockState"];
function filterRedundantEnums(transMaps) {
    return filterObjectMap(transMaps, (k) => !redundantEnumKey.includes(k));
}
function filterSkippedEnums(transMaps) {
    return filterObjectMap(transMaps, (k) => !skipEnumKey.includes(k));
}

const entityNameAlias = {
    "minecraft:villager_v2": "村民",
    "minecraft:zombie_villager_v2": "僵尸村民"
};
function fixEntityRelatedIds(
    transMap,
    relatedEntityMap,
    entityNameMap,
    relatedEntitiesModifier,
    relatedEntitiesStrModifier
) {
    let splitMap = {};
    forEachObject(transMap, (v, k, o) => {
        let relatedEntities = relatedEntityMap[k];
        let relatedEntitiesStr = relatedEntities.map((e) => {
            let withoutComp = e.replace(/<.+>$/, "");
            return entityNameAlias[withoutComp] || entityNameMap[withoutComp] || withoutComp;
        });
        uniqueAndSort(relatedEntitiesStr);
        relatedEntitiesStr.forEach((e) => {
            let brotherItems = splitMap[e];
            if (!brotherItems) {
                brotherItems = splitMap[e] = {};
            }
            brotherItems[k] = v;
        });
        if (relatedEntitiesModifier) {
            relatedEntitiesModifier(relatedEntitiesStr);
        }
        if (relatedEntitiesStr.length > 0) {
            if (relatedEntitiesStrModifier) {
                v = relatedEntitiesStrModifier(v, relatedEntitiesStr);
            } else {
                v += "（由" + relatedEntitiesStr.join("、") + "使用）";
            }
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
    const { packageVersion, versionInfo } = cx;
    const { outputFile, originalEnums, transMaps, transMapNames, stdTransMap, stdTransMapNames } = options;
    const gameVersionText = versionInfo.name + "（" + packageVersion + "）- " + branchName;
    const footText = [
        "※此ID表是MCBEID表的一部分，对应游戏版本为" + gameVersionText,
        "※详见：" + projectInfo.homepage
    ];
    let entityEventSplit, stdTransText;
    const enums = deepCopy(filterSkippedEnums(filterRedundantEnums(transMaps)));
    if (originalEnums) {
        const entityEventByEntity = fixEntityRelatedIds(enums.entityEvent, originalEnums.entityEventsMap, enums.entity);
        fixEntityRelatedIds(
            enums.entityFamily,
            originalEnums.entityFamilyMap,
            enums.entity,
            (relatedEntities) => {
                if (relatedEntities.length == 1) {
                    relatedEntities.length = 0;
                }
            },
            (value, str) => `${value}（${str.join("、")}）`
        );
        entityEventSplit = generateTextFromMapTree(entityEventByEntity, 1);
        entityEventSplit.push(...footText);
        forEachObject(enums.entity, (v, k, o) => {
            if (!(k in transMaps.summonableEntity)) {
                o[k] = v + "（不可召唤）";
            }
        });
    }
    if (stdTransMap) {
        stdTransText = generateTextFromMapTree(
            kvArrayToObject(
                stdTransMapNames
                    .map((e) => {
                        const [key, name] = e;
                        if (key in stdTransMap) {
                            return [name, stdTransMap[key]];
                        } else {
                            return null;
                        }
                    })
                    .filter((e) => e != null)
            ),
            1
        );
        stdTransText.push(...footText);
    }
    const zip = new AdmZip();
    const files = {
        ...replaceObjectKey(enums, [[/(.+)/, "$1.txt"]]),
        "entityEventSplit.txt": entityEventSplit,
        "stdTrans.txt": stdTransText
    };
    const fileDescriptions = transMapNames.map((e) => [e[0] + ".txt", e[1]]);
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
        ...fileDescriptions.filter((e) => files[e[0]]).map((e) => e[0] + ": " + e[1])
    ];
    forEachObject(files, (content, fileName) => {
        if (Array.isArray(content)) {
            content = content.join(lineBreak);
        } else if (typeof content == "object") {
            const contentDescription = fileDescriptions.find((e) => e[0] == fileName);
            const arr = [];
            let obj;
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
};
