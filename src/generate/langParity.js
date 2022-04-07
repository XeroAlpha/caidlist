const fs = require("fs");
const { forEachObject } = require("../util/common");

function compareEditionLangs(bedrockEditionLang, javaEditionLang, compareLangId, baseLangId) {
    const bedrockLangMap = {},
        bedrockLangIdLookup = {};
    const javaLangMap = {},
        javaLangIdLookup = {};
    const differences = [];
    forEachObject(bedrockEditionLang[baseLangId], (v, k) => {
        bedrockLangMap[v] = bedrockEditionLang[compareLangId][k];
        bedrockLangIdLookup[v] = k;
    });
    forEachObject(javaEditionLang[baseLangId], (v, k) => {
        javaLangMap[v] = javaEditionLang[compareLangId][k];
        javaLangIdLookup[v] = k;
    });
    forEachObject(bedrockLangMap, (v, k) => {
        if (k in javaLangMap) {
            const bedrockTranslation = v || "";
            const javaTranslation = javaLangMap[k] || "";
            const bedrockTranslationNoWhitespace = bedrockTranslation.replace(/\s/g, "");
            const javaTranslationNoWhitespace = javaTranslation.replace(/\s/g, "");
            if (bedrockTranslationNoWhitespace != javaTranslationNoWhitespace) {
                differences.push({
                    original: k,
                    translation: [bedrockTranslation, javaTranslation],
                    bedrockLangId: bedrockLangIdLookup[k],
                    javaLangId: javaLangIdLookup[k]
                });
            }
        }
    });
    return differences;
}

function writeLangParity(outputFile, differences, overrideMap) {
    const langWithComment = {};
    const langLines = [];
    differences.forEach((e) => {
        let comment = e.translation[0];
        if (e.javaLangId != e.bedrockLangId) {
            comment = e.javaLangId + " " + comment;
        }
        langWithComment[e.bedrockLangId] = [e.translation[1], comment];
    });
    if (overrideMap) {
        forEachObject(overrideMap, (v, k) => {
            langWithComment[k] = [v];
        });
    }
    forEachObject(langWithComment, (v, k) => {
        if (v[0].length) {
            langLines.push(`${k}=${v[0]}\t\t# ${v[1]}`);
        }
    });
    fs.writeFileSync(outputFile, langLines.join("\r\n"));
}

module.exports = { compareEditionLangs, writeLangParity };
