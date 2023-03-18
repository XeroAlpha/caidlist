import { writeFileSync } from 'fs';
import AdmZip from 'adm-zip';
import {
    projectInfo,
    forEachObject,
    filterObjectMap,
    replaceObjectKey,
    kvArrayToObject,
    deepCopy,
    uniqueAndSort
} from '../util/common.js';

const lineBreak = '\r\n';

const redundantEnumKey = ['lootTableWrapped', 'music', 'summonableEntity', 'lootTool'];
const skipEnumKey = ['command', 'blockState'];

export function filterRedundantEnums(transMaps) {
    return filterObjectMap(transMaps, (k) => !redundantEnumKey.includes(k));
}

export function filterSkippedEnums(transMaps) {
    return filterObjectMap(transMaps, (k) => !skipEnumKey.includes(k));
}

const entityNameAlias = {
    'minecraft:villager_v2': '村民',
    'minecraft:zombie_villager_v2': '僵尸村民'
};

export function fixEntityRelatedIds(
    transMap,
    relatedEntityMap,
    entityNameMap,
    relatedEntitiesModifier,
    relatedEntitiesStrModifier
) {
    const splitMap = {};
    forEachObject(transMap, (translation, translationId) => {
        const relatedEntities = relatedEntityMap[translationId];
        const relatedEntitiesStr = relatedEntities.map((e) => {
            const withoutComp = e.replace(/<.+>$/, '');
            return entityNameAlias[withoutComp] || entityNameMap[withoutComp] || withoutComp;
        });
        uniqueAndSort(relatedEntitiesStr);
        relatedEntitiesStr.forEach((e) => {
            let brotherItems = splitMap[e];
            if (!brotherItems) {
                brotherItems = splitMap[e] = {};
            }
            brotherItems[translationId] = translation;
        });
        if (relatedEntitiesModifier) {
            relatedEntitiesModifier(relatedEntitiesStr);
        }
        if (relatedEntitiesStr.length > 0) {
            let fixedTranslation = translation;
            if (relatedEntitiesStrModifier) {
                fixedTranslation = relatedEntitiesStrModifier(translation, relatedEntitiesStr);
            } else {
                fixedTranslation += `（由${relatedEntitiesStr.join('、')}使用）`;
            }
            transMap[translationId] = fixedTranslation;
        }
    });
    return splitMap;
}

export function generateTextFromMapTree(map, treeDepth) {
    const output = [];
    if (treeDepth > 0) {
        forEachObject(map, (submap, mapName) => {
            output.push(`【${mapName}】`);
            output.push(...generateTextFromMapTree(submap, treeDepth - 1));
            output.push('');
        });
    } else {
        forEachObject(map, (v, k) => output.push(`${k}: ${v}`));
    }
    return output;
}

export function writeTransMapTextZip(cx, options) {
    const { packageVersion, versionInfo, branch } = cx;
    const { name: branchName } = branch;
    const { outputFile, originalEnums, transMaps, transMapNames, stdTransMap, stdTransMapNames } = options;
    if (versionInfo.hidden || branch.hidden) {
        return;
    }
    const gameVersionText = `${versionInfo.name}（${packageVersion}）- ${branchName}`;
    const footText = [
        `※此ID表是MCBEID表的一部分，对应游戏版本为${gameVersionText}`,
        `※详见：${projectInfo.homepage}`
    ];
    const enums = deepCopy(filterSkippedEnums(filterRedundantEnums(transMaps)));
    const files = replaceObjectKey(enums, [[/(.+)/, '$1.txt']]);
    if (originalEnums) {
        const entityEventByEntity = fixEntityRelatedIds(enums.entityEvent, originalEnums.entityEventsMap, enums.entity);
        fixEntityRelatedIds(
            enums.entityFamily,
            originalEnums.entityFamilyMap,
            enums.entity,
            (relatedEntities) => {
                if (relatedEntities.length === 1) {
                    relatedEntities.length = 0;
                }
            },
            (value, str) => `${value}（${str.join('、')}）`
        );
        const entityEventSplit = generateTextFromMapTree(entityEventByEntity, 1);
        entityEventSplit.push(...footText);
        forEachObject(enums.entity, (v, k, o) => {
            if (!(k in transMaps.summonableEntity)) {
                o[k] = `${v}（不可召唤）`;
            }
        });
        files['entityEventSplit.txt'] = entityEventSplit;
    }
    if (stdTransMap) {
        const stdTransText = generateTextFromMapTree(
            kvArrayToObject(
                stdTransMapNames
                    .map((e) => {
                        const [key, name] = e;
                        if (key in stdTransMap) {
                            return [name, stdTransMap[key]];
                        }
                        return null;
                    })
                    .filter((e) => e != null)
            ),
            1
        );
        stdTransText.push(...footText);
        files['stdTrans.txt'] = stdTransText;
    }
    const zip = new AdmZip();
    const fileDescriptions = transMapNames.map((e) => [`${e[0]}.txt`, e[1]]);
    files['_MCBEID_.txt'] = [
        '【MCBEID表】',
        '在线版：https://ca.projectxero.top/idlist/',
        '本ID表由B站@ProjectXero与命令助手开发组的小伙伴们维护，发现错误或有建议可私聊UP主或加群【MCBE命令助手开发区】：671317302',
        '',
        `发布时间：${new Date().toLocaleString()}`,
        `对应游戏版本：${gameVersionText}`,
        '',
        'Minecraft 命令更新日志：https://ca.projectxero.top/blog/command/command-history/',
        '',
        '【目录】',
        ...fileDescriptions.filter((e) => files[e[0]]).map((e) => `${e[0]}: ${e[1]}`)
    ];
    forEachObject(files, (data, fileName) => {
        let fileContent;
        if (Array.isArray(data)) {
            fileContent = data.join(lineBreak);
        } else if (typeof data === 'object') {
            const contentDescription = fileDescriptions.find((e) => e[0] === fileName);
            const arr = [];
            let obj = data;
            if (contentDescription) {
                obj = { [contentDescription[1]]: data };
            }
            arr.push(...generateTextFromMapTree(obj, 1));
            arr.push(...footText);
            fileContent = arr.join(lineBreak);
        } else {
            return;
        }
        zip.addFile(fileName, Buffer.from(fileContent, 'utf-8'));
    });
    writeFileSync(outputFile, zip.toBuffer());
}
