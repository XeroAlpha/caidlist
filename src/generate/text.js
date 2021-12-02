const fs = require("fs");
const AdmZip = require("adm-zip");
const {
    forEachObject,
    filterObjectMap,
    replaceObjectKey
} = require("../util/common");

const skipTransMapKey = ["lootTableWrapped", "music", "summonableEntity", "lootTool"];
const entityNameAlias = {
    "minecraft:villager_v2": "村民",
    "minecraft:zombie_villager_v2": "僵尸村民"
};
function writeTransMapTextZip(options) {
    const {
        outputZip,
        outputJson,
        branchName,
        version,
        originalEnums,
        transMaps,
        transMapNames,
        stdTransMap,
        stdTransMapNames
    } = options;
    const footText = [
        "※此ID表是MCBEID表的一部分，对应游戏版本为" + version + "（" + branchName + "）",
        "※详见：https://gitee.com/projectxero/caidlist"
    ];
    let entityEventByEntity = {}, entityEventSplit, stdTransText, stdTransEnum;
    let enums = filterObjectMap(transMaps, k => !skipTransMapKey.includes(k));
    if (originalEnums) {
        forEachObject(enums.entityEvent, (v, k, o) => {
            let relatedEntities = originalEnums.entityEventsMap[k];
            let relatedEntitiesStr = relatedEntities.map(e => {
                return entityNameAlias[e] || enums.entity[e] || e;
            }).filter((e, i, a) => a.indexOf(e) >= i);
            relatedEntitiesStr.forEach(e => {
                let brotherEvents = entityEventByEntity[e];
                if (!brotherEvents) {
                    brotherEvents = entityEventByEntity[e] = {};
                }
                brotherEvents[k] = v;
            });
            v += "（" + relatedEntitiesStr.join("、") + "）";
            o[k] = v;
        });
        forEachObject(enums.entityFamily, (v, k, o) => {
            let relatedEntities = originalEnums.entityFamilyMap[k];
            let relatedEntitiesStr = relatedEntities.map(e => {
                let withoutComp = e.replace(/<.+>$/, "");
                return entityNameAlias[withoutComp] || enums.entity[withoutComp] || withoutComp;
            }).filter((e, i, a) => a.indexOf(e) >= i);
            if (relatedEntitiesStr.length > 1) {
                v += "（" + relatedEntitiesStr.join("、") + "）";
                o[k] = v;
            }
        });
        entityEventSplit = [];
        forEachObject(entityEventByEntity, (entityEvents, entityName) => {
            entityEventSplit.push("【" + entityName + "】");
            forEachObject(entityEvents, (entityEventDesc, entityEventName) => {
                entityEventSplit.push(entityEventName + ": " + entityEventDesc);
            });
            entityEventSplit.push("");
        });
        entityEventSplit.push(...footText);
    }
    if (stdTransMap) {
        stdTransText = [];
        stdTransEnum = {};
        stdTransMapNames.forEach(e => {
            const [ key, name ] = e;
            stdTransText.push("【" + name + "】");
            forEachObject(stdTransMap[key], (transValue, transKey) => {
                stdTransEnum[key + ": " + transKey] = transValue;
                stdTransText.push(transKey + ": " + transValue);
            });
            stdTransText.push("");
        });
        stdTransText.push(...footText);
    }
    if (outputZip) {
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
            "对应游戏版本：" + version + "（" + branchName + "）",
            "",
            "Minecraft 命令更新日志：https://ca.projectxero.top/blog/command/command-history/",
            "",
            "【目录】",
            ...fileDescriptions.filter(e => files[e[0]]).map(e => e[0] + ": " + e[1])
        ];
        forEachObject(files, (content, fileName) => {
            if (Array.isArray(content)) {
                content = content.join("\r\n");
            } else if (typeof content == "object") {
                let contentDescription = fileDescriptions.find(e => e[0] == fileName);
                let arr = [];
                if (contentDescription) arr.push("【" + contentDescription[1] + "】")
                forEachObject(content, (v, k) => arr.push(k + ": " + v));
                arr.push("", ...footText);
                content = arr.join("\r\n");
            } else {
                return;
            }
            zip.addFile(fileName, Buffer.from(content, "utf-8"));
        });
        fs.writeFileSync(outputZip, zip.toBuffer());
    }
    if (outputJson) {
        let jsonEnums = {
            ...enums,
            stdTrans: stdTransEnum
        };
        fs.writeFileSync(outputJson, JSON.stringify({
            branchName,
            version,
            enums: jsonEnums,
            names: transMapNames.filter(e => jsonEnums[e[0]])
        }));
    }
}

module.exports = {
    writeTransMapTextZip
}