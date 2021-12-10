const fs = require("fs");
const {
    filterRedundantEnums,
    fixEntityRelatedIds
} = require("./text");

function writeTransMapJson(cx, options) {
    const branchName = cx.branch.name;
    const { packageVersion } = cx.packageVersion;
    const {
        outputFile,
        originalEnums,
        transMaps,
        transMapNames
    } = options;
    let enums = filterRedundantEnums(transMaps);
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
            }
        );
    }
    fs.writeFileSync(outputFile, JSON.stringify({
        branchName,
        packageVersion,
        enums: enums,
        names: transMapNames.filter(e => enums[e[0]])
    }));
}

function writeTransMapIndexJson(cx, options) {
    const { version, packageVersion } = cx;
    const { outputFile, rootUrl, branchList } = options;
    fs.writeFileSync(outputFile, JSON.stringify({
        dataVersion: packageVersion,
        branchList: branchList.map(branch => {
            return {
                ...branch,
                dataUrl: `${rootUrl}/${version}.${branch.id}.json`,
                offlineUrl: `${rootUrl}/${version}.${branch.id}.zip`
            };
        })
    }, null, 4));
}

module.exports = {
    writeTransMapJson,
    writeTransMapIndexJson
}