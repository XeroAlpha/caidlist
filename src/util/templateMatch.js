const util = require("util");
const { setInlineCommentAfterField } = require("./common");

function runTemplate(template, getter) {
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, templateName) => {
        return getter(templateName);
    });
}

const refTemplateRegex = /^(\S*):/

function matchTranslation(options) {
    const {
        originalValue,
        translationMap,
        resultMaps,
        stdTransMap,
        javaEditionLangMap,
        langMap,
        langKeyPrefix,
        langKeySuffix,
        autoMatch,
        translateCached
    } = options;
    let userTranslation = translationMap[originalValue];
    let stdTranslationKey = originalValue.replace(/^minecraft:/i, "").replace(/_/g, " ");
    let stdTranslation;
    if (userTranslation) {
        if (userTranslation.includes("{{") && userTranslation.includes("}}")) { // 拼接模板
            userTranslation = runTemplate(userTranslation, key => {
                if (key.startsWith("#")) {
                    key = originalValue + "." + key.slice(1);
                }
                return translateCached(key, originalValue, true).translation;
            });
            setInlineCommentAfterField(translationMap, originalValue, userTranslation);
        } else if (refTemplateRegex.test(userTranslation)) { // 直接引用
            let colonPos = userTranslation.indexOf(":");
            let source = userTranslation.slice(0, colonPos).trim();
            let key = userTranslation.slice(colonPos + 1).trim();
            if (source == "") { // 直接使用
                userTranslation = userTranslation.slice(colonPos + 1);
            } else if (stdTransMap && source.toLowerCase() == "st") { // 标准化译名
                userTranslation = stdTransMap[key];
            } else if (javaEditionLangMap && source.toLowerCase() == "je") { // Java版语言文件
                userTranslation = javaEditionLangMap[key];
            } else if (langMap && source.toLowerCase() == "be") { // 基岩版语言文件
                userTranslation = langMap[key];
            } else if (source.toLowerCase() == "this") { // 当前列表
                userTranslation = translateCached(key, originalValue).translation;
            } else if (source.toLowerCase() == "missing") { // 暂缺译名
                const tempTranslationMap = {};
                tempTranslationMap[originalValue] = key;
                userTranslation = matchTranslation({
                    ...options,
                    originalValue,
                    translationMap: tempTranslationMap,
                    autoMatch: false
                }).translation;
                if (userTranslation.toLowerCase() in stdTransMap) {
                    userTranslation = stdTransMap[userTranslation.toLowerCase()];
                    console.warn(`Translation Found: ${originalValue} -> ${userTranslation}`);
                } else {
                    console.warn(`Missing Translation: ${originalValue} -> ${userTranslation}`);
                }
            } else if (source in resultMaps) { // 其他翻译
                userTranslation = resultMaps[source][key];
            } else {
                userTranslation = undefined;
            }
            if (!userTranslation) {
                console.warn(`Incorrect Ref: ${originalValue}(${source}: ${key})`);
            }
            setInlineCommentAfterField(translationMap, originalValue, userTranslation);
        }
        if (!userTranslation) userTranslation = "EMPTY";
    }
    if (userTranslation == "EMPTY") {
        return {
            state: "notFound",
            translation: "",
            comment: null
        };
    }
    if (userTranslation) {
        return {
            state: "provided",
            translation: userTranslation,
            comment: null
        };
    }
    if (autoMatch) {
        if (stdTransMap) {
            stdTranslation = stdTransMap[stdTranslationKey];
        }
        if (stdTranslation) {
            translationMap[originalValue] = "ST: " + stdTranslationKey;
            setInlineCommentAfterField(translationMap, originalValue, `${stdTranslation}`);
            return {
                state: "provided",
                translation: stdTranslation,
                comment: null
            };
        }
        if (langMap && langKeyPrefix != null && langKeySuffix != null) {
            let langKeyExact = langKeyPrefix + originalValue + langKeySuffix;
            if (langMap[langKeyExact]) {
                let translation = langMap[langKeyExact];
                translationMap[originalValue] = "";
                setInlineCommentAfterField(translationMap, originalValue, `lang: ${translation}`);
                return {
                    state: "guessFromLang",
                    translation: translation,
                    comment: `lang: ${langKeyExact}`
                };
            }
            let langKeyLikely = Object.keys(langMap)
                .filter(key => key.startsWith(langKeyPrefix) && key.includes(originalValue) && key.endsWith(langKeySuffix));
            if (langKeyLikely.length) {
                let translation = langKeyLikely.map(key => langMap[key]).join("/");
                translationMap[originalValue] = "";
                setInlineCommentAfterField(translationMap, originalValue, `lang: ${translation}`);
                return {
                    state: "guessFromLang",
                    translation: translation,
                    comment: `lang: ${langKeyLikely.join(", ")}`
                };
            }
        }
        if (!translationMap[originalValue]) {
            translationMap[originalValue] = "";
        }
        setInlineCommentAfterField(translationMap, originalValue, null);
    }
    return {
        state: "notFound",
        translation: "",
        comment: null
    };
}

const CircularTranslationResult = {
    state: "notFound",
    translation: "<Circular>",
    comment: "This is a place holder"
};
function matchTranslations(options) {
    const { resultMaps, stateMaps, name, originalArray, postProcessor } = options;
    let translateResultMap = {};
    let translateCacheMap = {};
    let translateStates = {
        provided: [],
        guessFromStd: [],
        guessFromLang: [],
        notFound: []
    };
    let translateCached = (originalValue, rootKey, insideTemplate) => {
        let cache = translateCacheMap[originalValue];
        if (cache) {
            return cache;
        } else if (insideTemplate && originalValue.includes("|")) { // 拼接模板
            let refs = originalValue.split("|").map(ref => {
                let trimedRef = ref.trim();
                if (trimedRef.startsWith("'")) { // 原始字符，原样传递
                    if (trimedRef.endsWith("'")) {
                        return trimedRef.slice(1, -1);
                    } else {
                        return trimedRef.slice(1);
                    }
                } else {
                    let result = translateCached(trimedRef, rootKey, true);
                    return result.translation;
                }
            });
            return {
                translation: util.format(...refs)
            };
        } else if (insideTemplate && originalValue.includes("!")) { // 外部引用
            let translationMap = {};
            translationMap[rootKey] = originalValue.replace("!", ":");
            let result = matchTranslation({
                ...options,
                originalValue: rootKey,
                translationMap: translationMap,
                translateCached
            });
            return result;
        } else { // 内部引用
            let result;
            translateCacheMap[originalValue] = CircularTranslationResult;
            result = matchTranslation({
                ...options,
                translateCached,
                originalValue
            });
            translateCacheMap[originalValue] = result;
            return result;
        }
    };
    originalArray.forEach(originalValue => {
        let result = translateCached(originalValue, originalValue);
        translateStates[result.state].push(originalValue);
        translateResultMap[originalValue] = result.translation;
        setInlineCommentAfterField(translateResultMap, originalValue, result.comment);
    });
    if (postProcessor) {
        let newResultMap = postProcessor(translateResultMap, translateStates);
        if (newResultMap) translateResultMap = newResultMap;
    }
    resultMaps[name] = translateResultMap;
    if (stateMaps) {
        stateMaps[name] = translateStates;
    }
}

module.exports = {
    matchTranslation,
    matchTranslations
};