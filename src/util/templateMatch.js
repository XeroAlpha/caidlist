import { format } from 'util';
import { setInlineCommentAfterField, warn } from './common.js';

function runTemplate(template, getter) {
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, templateName) => getter(templateName));
}

const refTemplateRegex = /^(\S*):/;

export function matchTranslation(options) {
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
        resolveReference,
        customAutoMatch,
        context,
        translateCached
    } = options;
    let userTranslation = translationMap[originalValue];
    if (userTranslation) {
        if (userTranslation.includes('{{') && userTranslation.includes('}}')) { // 拼接模板
            const interpretFailedKeys = [];
            userTranslation = runTemplate(userTranslation, (key) => {
                let realKey = key;
                if (key.startsWith('#')) {
                    realKey = `${originalValue}.${key.slice(1)}`;
                }
                const state = translateCached(realKey, `${context}/${originalValue}`, true);
                if (state.state !== 'provided') {
                    interpretFailedKeys.push(key);
                }
                return state.translation;
            });
            if (interpretFailedKeys.length) {
                warn(`[${context}] Should provide inline references: ${originalValue}(${interpretFailedKeys.join(',')})`);
                userTranslation = '';
            }
            setInlineCommentAfterField(translationMap, originalValue, userTranslation);
        } else if (refTemplateRegex.test(userTranslation)) { // 直接引用
            const colonPos = userTranslation.indexOf(':');
            const source = userTranslation.slice(0, colonPos).trim();
            const key = userTranslation.slice(colonPos + 1).trim();
            const customResolution = resolveReference ? resolveReference(source, key) : null;
            if (customResolution) {
                userTranslation = customResolution;
            } else if (source === '') { // 直接使用
                userTranslation = userTranslation.slice(colonPos + 1);
            } else if (stdTransMap && source.toLowerCase() === 'st') { // 标准化译名
                userTranslation = stdTransMap[key];
            } else if (javaEditionLangMap && source.toLowerCase() === 'je') { // Java版语言文件
                userTranslation = javaEditionLangMap[key];
            } else if (langMap && source.toLowerCase() === 'be') { // 基岩版语言文件
                userTranslation = langMap[key];
            } else if (source.toLowerCase() === 'this') { // 当前列表
                userTranslation = translateCached(key, `${context}/${originalValue}`).translation;
            } else if (source.toLowerCase() === 'missing') { // 暂缺译名
                const tempTranslationMap = {};
                tempTranslationMap[originalValue] = key;
                userTranslation = matchTranslation({
                    ...options,
                    originalValue,
                    translationMap: tempTranslationMap,
                    autoMatch: null
                }).translation;
                if (userTranslation.toLowerCase() in stdTransMap) {
                    userTranslation = stdTransMap[userTranslation.toLowerCase()];
                    warn(`[${context}] Translation Found: ${originalValue} -> ${userTranslation}`);
                } else {
                    warn(`[${context}] Missing Translation: ${originalValue} -> ${userTranslation}`);
                }
            } else if (source in resultMaps) { // 其他翻译
                userTranslation = resultMaps[source][key];
            } else {
                userTranslation = undefined;
            }
            if (!userTranslation) {
                warn(`[${context}] Failed to resolve reference: ${originalValue}(${source}: ${key})`);
            }
            setInlineCommentAfterField(translationMap, originalValue, userTranslation);
        }
        if (!userTranslation) userTranslation = 'EMPTY';
    }
    if (userTranslation === 'EMPTY') {
        return {
            state: 'notFound',
            translation: '',
            comment: null
        };
    }
    if (userTranslation) {
        return {
            state: 'provided',
            translation: userTranslation,
            comment: null
        };
    }
    if (autoMatch && Array.isArray(autoMatch)) {
        if (autoMatch.includes('custom') && customAutoMatch) {
            const translation = customAutoMatch(originalValue);
            if (translation) {
                if (!(originalValue in translationMap)) {
                    warn(`[${context}] New entry has been added: ${originalValue} (custom) -> ${translation}`);
                }
                translationMap[originalValue] = translation;
                return matchTranslation(options);
            }
        }
        if (autoMatch.includes('stdTrans') && stdTransMap) {
            const stdTranslationKey = originalValue.replace(/^minecraft:/i, '').replace(/_/g, ' ');
            const stdTranslation = stdTransMap[stdTranslationKey];
            if (stdTranslation) {
                if (!(originalValue in translationMap)) {
                    warn(`[${context}] New entry has been added: ${originalValue} (ST) -> ${stdTranslation}`);
                }
                translationMap[originalValue] = `ST: ${stdTranslationKey}`;
                setInlineCommentAfterField(translationMap, originalValue, `${stdTranslation}`);
                return {
                    state: 'provided',
                    translation: stdTranslation,
                    comment: null
                };
            }
        }
        if (langMap && langKeyPrefix != null && langKeySuffix != null) {
            if (autoMatch.includes('lang')) {
                const langKeyExact = langKeyPrefix + originalValue + langKeySuffix;
                if (langMap[langKeyExact]) {
                    const translation = langMap[langKeyExact];
                    if (!(originalValue in translationMap)) {
                        warn(`[${context}] New entry has been added: ${originalValue} (lang) -> ${translation}`);
                    }
                    translationMap[originalValue] = '';
                    if (langKeyExact !== originalValue) {
                        setInlineCommentAfterField(translationMap, originalValue, `lang: ${translation}`);
                    }
                    return {
                        state: 'guessFromLang',
                        translation,
                        comment: `lang: ${langKeyExact}`
                    };
                }
            }
            if (autoMatch.includes('langLikely')) {
                const langKeyLikely = Object.keys(langMap)
                    .filter((key) => key.startsWith(langKeyPrefix) && key.includes(originalValue) && key.endsWith(langKeySuffix));
                if (langKeyLikely.length) {
                    const translation = langKeyLikely.map((key) => langMap[key]).join('/');
                    if (!(originalValue in translationMap)) {
                        warn(`[${context}] New entry has been added: ${originalValue} (langLikely) -> ${translation}`);
                    }
                    translationMap[originalValue] = '';
                    setInlineCommentAfterField(translationMap, originalValue, `lang: ${translation}`);
                    return {
                        state: 'guessFromLang',
                        translation,
                        comment: `lang: ${langKeyLikely.join(', ')}`
                    };
                }
            }
        }
        if (!translationMap[originalValue]) {
            if (!(originalValue in translationMap)) {
                warn(`[${context}] New entry has been added: ${originalValue} (untranslated)`);
            }
            translationMap[originalValue] = '';
        }
        setInlineCommentAfterField(translationMap, originalValue, null);
    }
    return {
        state: 'notFound',
        translation: '',
        comment: null
    };
}

const CircularTranslationResult = {
    state: 'notFound',
    translation: '<Circular>',
    comment: 'This is a place holder'
};

const formatInnerFunc = ({ context, originalValue, refs }, ...resolvedRefs) => {
    let state = 'provided';
    resolvedRefs.forEach((resolvedRef, i) => {
        if (resolvedRef.state !== 'provided') {
            state = 'notFound';
            warn(`[${context}] Should provide inline references: ${originalValue}(${refs[i]})`);
        }
    });
    const [fmt, ...items] = resolvedRefs.map((e) => e.translation);
    return {
        state,
        translation: format(fmt, ...items)
    };
};
const innerFunctions = {
    '': formatInnerFunc,
    format: formatInnerFunc,
    pick: ({ context, originalValue, refs }, ...items) => {
        const picked = items.find((e) => e.state === 'provided');
        if (picked) return picked;
        warn(`[${context}] All items are not provided: ${originalValue}(${refs.join(',')})`);
        return items[items.length - 1];
    }
};

export function matchTranslations(options) {
    const { resultMaps, stateMaps, name, originalArray, postProcessor } = options;
    const translateResultMap = {};
    const translateCacheMap = {};
    const translateStates = {
        provided: [],
        guessFromStd: [],
        guessFromLang: [],
        notFound: []
    };
    const translateCached = (originalValue, context, insideTemplate) => {
        const cache = translateCacheMap[originalValue];
        if (cache) {
            return cache;
        }
        if (insideTemplate && originalValue.includes('|')) { // 拼接模板
            const [first, ...refs] = originalValue.split('|').map((e) => e.trim());
            let func = innerFunctions[first.toLowerCase()];
            if (!innerFunctions[first.toLowerCase()]) {
                refs.unshift(first);
                func = formatInnerFunc;
            }
            const resolvedRefs = refs.map((ref) => {
                if (ref.startsWith('\'')) { // 原始字符，原样传递
                    let raw = ref.slice(1);
                    if (raw.endsWith('\'')) {
                        raw = raw.slice(0, -1);
                    }
                    return { state: 'provided', translation: raw };
                }
                return translateCached(ref, context, true);
            });
            return func({ context, originalValue, options, refs }, ...resolvedRefs);
        }
        if (insideTemplate && originalValue.includes('!')) { // 外部引用
            const translationMap = {};
            translationMap[''] = originalValue.replace('!', ':');
            return matchTranslation({
                ...options,
                originalValue: '',
                context,
                translationMap,
                translateCached
            });
        }
        // 内部引用
        translateCacheMap[originalValue] = CircularTranslationResult;
        const result = matchTranslation({
            ...options,
            context,
            translateCached,
            originalValue
        });
        translateCacheMap[originalValue] = result;
        return result;
    };
    originalArray.forEach((originalValue) => {
        const result = translateCached(originalValue, name);
        translateStates[result.state].push(originalValue);
        translateResultMap[originalValue] = result.translation;
        setInlineCommentAfterField(translateResultMap, originalValue, result.comment);
    });
    let finalResultMap = translateResultMap;
    if (postProcessor) {
        const newResultMap = postProcessor(translateResultMap, translateStates);
        if (newResultMap) finalResultMap = newResultMap;
    }
    resultMaps[name] = finalResultMap;
    if (stateMaps) {
        stateMaps[name] = translateStates;
    }
}
