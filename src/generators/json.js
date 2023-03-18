import { writeFileSync, existsSync, readFileSync } from 'fs';
import { filterRedundantEnums, fixEntityRelatedIds } from './text.js';
import { deepCopy, forEachObject } from '../util/common.js';

export function writeTransMapJson(cx, options) {
    const {
        versionInfo, branch
    } = cx;
    const {
        outputFile, originalEnums, transMaps, transMapNames
    } = options;
    if (versionInfo.hidden || branch.hidden) {
        return;
    }
    const enums = deepCopy(filterRedundantEnums(transMaps));
    if (originalEnums) {
        fixEntityRelatedIds(enums.entityEvent, originalEnums.entityEventsMap, enums.entity);
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
        fixEntityRelatedIds(enums.animation, originalEnums.animationMap, enums.entity);
        fixEntityRelatedIds(enums.animationController, originalEnums.animationControllerMap, enums.entity);
        forEachObject(enums.entity, (v, k, o) => {
            if (!(k in transMaps.summonableEntity)) {
                o[k] = `${v}（不可召唤）`;
            }
        });
    }
    writeFileSync(
        outputFile,
        JSON.stringify({
            enums,
            names: transMapNames.filter((e) => enums[e[0]])
        })
    );
}

export function writeTransMapIndexJson(cx, options) {
    const {
        version, packageVersion, coreVersion, versionInfo
    } = cx;
    const {
        outputFile, mergedFile, rootUrl, branchList
    } = options;
    const indexData = {
        id: version,
        name: versionInfo.name,
        description: versionInfo.description,
        sortOrder: versionInfo.sortOrder,
        dataVersion: packageVersion,
        coreVersion,
        branchList: branchList
            .filter((branch) => !branch.hidden)
            .map((branch) => ({
                id: branch.id,
                name: branch.name,
                description: branch.description,
                dataUrl: `${rootUrl}/${version}/${branch.id}.json`,
                offlineUrl: `${rootUrl}/${version}/${branch.id}.zip`
            }))
    };
    if (versionInfo.hidden) {
        return;
    }
    if (outputFile) {
        writeFileSync(outputFile, JSON.stringify(indexData, null, 4));
    }
    if (mergedFile) {
        let mergedList = null;
        if (existsSync(mergedFile)) {
            const mergedFileContent = readFileSync(mergedFile, 'utf-8');
            mergedList = JSON.parse(mergedFileContent);
        }
        if (!Array.isArray(mergedList)) {
            mergedList = [];
        }
        let mergeIndex = mergedList.findIndex((e) => e.id === version);
        if (mergeIndex < 0) mergeIndex = mergedList.length;
        mergedList[mergeIndex] = indexData;
        mergedList.sort((a, b) => a.sortOrder - b.sortOrder);
        writeFileSync(mergedFile, JSON.stringify(mergedList, null, 4));
    }
}
