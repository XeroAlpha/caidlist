const fs = require('fs');
const { filterRedundantEnums, fixEntityRelatedIds } = require('./text');
const { deepCopy, forEachObject } = require('../util/common');

function writeTransMapJson(_, options) {
    const {
        outputFile, originalEnums, transMaps, transMapNames
    } = options;
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
    fs.writeFileSync(
        outputFile,
        JSON.stringify({
            enums,
            names: transMapNames.filter((e) => enums[e[0]])
        })
    );
}

function writeTransMapIndexJson(cx, options) {
    const {
        version, packageVersion, coreVersion, versionInfo
    } = cx;
    const {
        outputFile, mergedFile, rootUrl, branchList
    } = options;
    const indexData = {
        dataVersion: packageVersion,
        coreVersion,
        branchList: branchList
            .filter((branch) => !branch.hideOnWeb)
            .map((branch) => ({
                ...branch,
                dataUrl: `${rootUrl}/${version}/${branch.id}.json`,
                offlineUrl: `${rootUrl}/${version}/${branch.id}.zip`
            }))
    };
    if (outputFile) {
        fs.writeFileSync(outputFile, JSON.stringify(indexData, null, 4));
    }
    if (mergedFile) {
        let mergedList = null;
        if (fs.existsSync(mergedFile)) {
            const mergedFileContent = fs.readFileSync(mergedFile, 'utf-8');
            mergedList = JSON.parse(mergedFileContent);
        }
        if (!Array.isArray(mergedList)) {
            mergedList = [];
        }
        let mergeIndex = mergedList.findIndex((e) => e.id === version);
        if (mergeIndex < 0) mergeIndex = mergedList.length;
        mergedList[mergeIndex] = {
            id: version,
            ...versionInfo,
            ...indexData
        };
        mergedList.sort((a, b) => a.sortOrder - b.sortOrder);
        fs.writeFileSync(mergedFile, JSON.stringify(mergedList, null, 4));
    }
}

module.exports = {
    writeTransMapJson,
    writeTransMapIndexJson
};
