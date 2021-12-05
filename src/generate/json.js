const fs = require("fs");
const {
    filterRedundantEnums,
    fixEntityRelatedIds
} = require("./text");

function writeTransMapJson(options) {
    const {
        outputFile,
        branchName,
        version,
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
        version,
        enums: enums,
        names: transMapNames.filter(e => enums[e[0]])
    }));
}

function writeTransMapIndexJson(options) {
    const { outputFile, version, rootUrl, branchList } = options;
    fs.writeFileSync(outputFile, JSON.stringify({
        dataVersion: version,
        branchList: branchList.map(branch => {
            let fnSuffix = branch[1] ? "." + branch[1] : "";
            return {
                id: branch[0],
                name: branch[2],
                description: branch[3],
                dataUrl: rootUrl + "/data" + fnSuffix + ".json",
                offlineUrl: rootUrl + "/latest" + fnSuffix + ".zip"
            };
        })
    }, null, 4));
}

module.exports = {
    writeTransMapJson,
    writeTransMapIndexJson
}