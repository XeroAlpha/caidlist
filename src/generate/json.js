const fs = require("fs");
const {
    filterRedundantEnums,
    fixEntityRelatedIds
} = require("./text");
const {
    deepCopy
} = require("../util/common");

function writeTransMapJson(cx, options) {
    const branchName = cx.branch.name;
    const { version, packageVersion } = cx;
    const {
        outputFile,
        originalEnums,
        transMaps,
        transMapNames
    } = options;
    let enums = deepCopy(filterRedundantEnums(transMaps));
    if (originalEnums) {
        fixEntityRelatedIds(
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
            },
            (value, str) => `${value}（${str.join("、")}）`
        );
        fixEntityRelatedIds(
            enums.animation,
            originalEnums.animationMap,
            enums.entity
        );
        fixEntityRelatedIds(
            enums.animationController,
            originalEnums.animationControllerMap,
            enums.entity
        );
    }
    fs.writeFileSync(outputFile, JSON.stringify({
        versionType: version,
        branchName,
        packageVersion,
        enums: enums,
        names: transMapNames.filter(e => enums[e[0]])
    }));
}

function writeTransMapIndexJson(cx, options) {
    const { version, packageVersion } = cx;
    const { outputFile, mergedFile, rootUrl, branchList, versionDescription } = options;
    const indexData = {
        dataVersion: packageVersion,
        branchList: branchList.map(branch => {
            return {
                ...branch,
                dataUrl: `${rootUrl}/${version}/${branch.id}.json`,
                offlineUrl: `${rootUrl}/${version}/${branch.id}.zip`
            };
        })
    };
    if (outputFile) {
        fs.writeFileSync(outputFile, JSON.stringify(indexData, null, 4));
    }
    if (mergedFile) {
        let mergedData;
        if (fs.existsSync(mergedFile)) {
            const mergedDataContent = fs.readFileSync(mergedFile, "utf-8");
            mergedData = JSON.parse(mergedDataContent);
        } else {
            mergedData = {};
        }
        mergedData[version] = {
            ...versionDescription,
            ...indexData
        };
        fs.writeFileSync(mergedFile, JSON.stringify(mergedData, null, 4));
    }
}

module.exports = {
    writeTransMapJson,
    writeTransMapIndexJson
}