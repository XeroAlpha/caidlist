const fs = require('fs');
const nodePath = require('path');
const Koa = require('koa');
const Router = require('@koa/router');
const pinyinRaw = require('pinyin');

const DefaultId = Symbol('DefaultId');
const Keywords = Symbol('Keywords');
const PackageVersion = Symbol('PackageVersion');
const GlobalSearchEnumId = 'global';

function dateTimeToString(date) {
    const dateString = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
    const timeString = [date.getHours(), date.getMinutes(), date.getSeconds()]
        .map((e) => e.toFixed(0).padStart(2, '0'))
        .join(':');
    return `${dateString} ${timeString}`;
}

function readJSON(path) {
    return JSON.parse(fs.readFileSync(path, 'utf-8'));
}

function readFileModifiedTime(path) {
    try {
        const stats = fs.statSync(path);
        return stats.mtimeMs;
    } catch (err) {
        return NaN;
    }
}

function loadData(path) {
    const pinyin = (w) => pinyinRaw(w, { style: pinyinRaw.STYLE_NORMAL }).join('');
    const dataIndex = readJSON(path);
    const newData = {};
    const keywords = {};
    const addKeywordsRaw = (k, c) => {
        if (k in keywords) {
            keywords[k].push(c);
        } else {
            keywords[k] = [c];
        }
    };
    const addKeywords = (k, c) => {
        const pinyinKey = pinyin(k);
        addKeywordsRaw(k.toLowerCase(), c);
        if (pinyinKey !== k) {
            addKeywordsRaw(pinyinKey.toLowerCase(), c);
        }
    };
    dataIndex.forEach((versionIndex) => {
        const version = {};
        const versionType = versionIndex.id;
        addKeywords(versionType, { versionType });
        addKeywords(versionIndex.name, { versionType });
        versionIndex.branchList.forEach((branchInfo) => {
            const branchData = readJSON(nodePath.join(path, '..', versionIndex.id, `${branchInfo.id}.json`));
            const enumEntriesMap = {};
            const nameMap = {};
            const branchId = branchInfo.id;
            addKeywords(branchId, { versionType, branchId });
            addKeywords(branchInfo.name, { versionType, branchId });
            for (const [enumKey, enumData] of Object.entries(branchData.enums)) {
                enumEntriesMap[enumKey] = Object.entries(enumData).map(([key, value]) => [
                    key,
                    value,
                    pinyin(value)
                ]);
            }
            branchData.names.forEach(([id, name]) => {
                addKeywords(id, { versionType, branchId, enumId: id });
                addKeywords(name, { versionType, branchId, enumId: id });
                nameMap[id] = name;
            });
            version[branchInfo.id] = {
                enums: enumEntriesMap,
                names: nameMap
            };
        });
        version[DefaultId] = versionIndex.branchList[0].id;
        version[PackageVersion] = versionIndex.dataVersion;
        newData[versionIndex.id] = version;
    });
    newData[DefaultId] = dataIndex[0].id;
    newData[Keywords] = keywords;
    return newData;
}

function patchOptionByKeywords(dataStore, keywords, options) {
    const keywordMap = dataStore[Keywords];
    let i;
    for (i = 0; i < keywords.length - 1; i++) {
        const keywordContext = keywordMap[keywords[i]];
        if (keywordContext) {
            const context = keywordContext.find((e) => {
                for (const [key, value] of Object.entries(e)) {
                    if (options[key] && options[key] !== value) return false;
                }
                return true;
            });
            if (context) {
                for (const [key, value] of Object.entries(context)) {
                    options[key] = value;
                }
                continue;
            }
        }
        break;
    }
    const filteredKeywords = keywords.slice(i);
    options.searchText = filteredKeywords.join(' ');
    return filteredKeywords;
}

function prepareSearch(dataStore, options) {
    const { strategy, searchText } = options;
    let searcher;
    if (strategy === 'keyword') {
        const rawKeywords = searchText
            .toLowerCase()
            .split(/\s+/)
            .filter((e) => e.length > 0);
        const keywords = patchOptionByKeywords(dataStore, rawKeywords, options);
        let startsWith = null;
        if (keywords.length > 0 && keywords[0].length > 1 && keywords[0].startsWith('^')) {
            startsWith = keywords[0] = keywords[0].slice(1);
        }
        searcher = (value) => {
            const valueLowerCase = value.toLowerCase();
            let start = 0;
            if (startsWith && !value.startsWith(startsWith)) return false;
            for (const keyword of keywords) {
                const indexInValue = valueLowerCase.indexOf(keyword, start);
                if (indexInValue < 0) {
                    return false;
                }
                start = indexInValue + keyword.length;
            }
            return true;
        };
    } else if (strategy === 'contains') {
        searcher = (value) => value.indexOf(searchText) >= 0;
    } else if (strategy === 'startswith') {
        searcher = (value) => value.startsWith(searchText);
    } else if (strategy === 'equals') {
        searcher = (value) => value === searchText;
    } else {
        throw new Error(`Invalid strategy: ${strategy}`);
    }
    const { versionType, branchId, enumId } = options;
    let versionData = dataStore[versionType];
    if (!versionData) {
        versionData = dataStore[(options.versionType = dataStore[DefaultId])];
    }
    let branchData = versionData[branchId];
    if (!branchData) {
        branchData = versionData[(options.branchId = versionData[DefaultId])];
    }
    const enumData = branchData.enums[enumId];
    if (!enumData) {
        options.enumId = GlobalSearchEnumId;
    }
    return searcher;
}

function searchEnum(searcher, { scope, limit, enumId, branchData }) {
    const result = [];
    const enableSearchKey = scope === 'all' || scope === 'key';
    const enableSearchValue = scope === 'all' || scope === 'value';
    const enumEntries = branchData.enums[enumId];
    const enumName = branchData.names[enumId];
    if (!enumName || !enumEntries) {
        throw new Error(`Invalid enum id: ${enumId}`);
    }
    for (const [key, value, valuePinyin] of enumEntries) {
        if (!(enableSearchKey && searcher(key)) && !(enableSearchValue && (searcher(value) || searcher(valuePinyin)))) {
            continue;
        }
        result.push({ enumId, enumName, key, value });
        if (result.length >= limit) {
            break;
        }
    }
    return result;
}

function doSearch(dataStore, options) {
    const searcher = prepareSearch(dataStore, options);
    const { scope, limit, versionType, branchId, enumId } = options;
    const versionData = dataStore[versionType];
    const branchData = versionData[branchId];
    const result = [];
    if (enumId !== GlobalSearchEnumId) {
        result.push(...searchEnum(searcher, { scope, limit, enumId, branchData }));
    } else {
        let restLimit = limit;
        for (const id of Object.keys(branchData.enums)) {
            const enumResult = searchEnum(searcher, { scope, limit: restLimit, enumId: id, branchData });
            result.push(...enumResult);
            restLimit -= enumResult.length;
            if (restLimit <= 0) {
                break;
            }
        }
    }
    return result;
}

function toPWAHash(options) {
    return [
        `#${options.versionType}-${options.branchId}`,
        options.enumId,
        encodeURIComponent(options.searchText)
    ].join('/');
}

function toHumanReadable(options, result) {
    const lines = result.map((entry) => `${entry.enumName}: ${entry.key} -> ${entry.value}`);
    if (lines.length > 0) lines.push('');
    lines.push(`https://ca.projectxero.top/idlist/${toPWAHash(options)}`);
    return lines.join('\r\n');
}

const dataIndexPath = nodePath.resolve(process.argv[2], 'index.json');
let dataStore = loadData(dataIndexPath);
let dataCheckTime = Date.now();
let dataUpdateTime = readFileModifiedTime(dataIndexPath);
const UPDATE_INTERVAL = 60 * 1000;

const PORT = 18345;
const app = new Koa();
const router = new Router();

router.get('/search', (ctx) => {
    const now = new Date();
    process.stdout.write(`[${dateTimeToString(now)} ${ctx.ip} ->] ${ctx.querystring}\n`);
    if (now - dataCheckTime > UPDATE_INTERVAL) {
        const modifiedTime = readFileModifiedTime(dataIndexPath);
        if (!Number.isNaN(modifiedTime) && modifiedTime !== dataUpdateTime) {
            dataStore = loadData(dataIndexPath);
            process.stdout.write(`[${dateTimeToString(now)}] DataStore successfully reloaded.\n`);
            dataUpdateTime = modifiedTime;
        }
        dataCheckTime = now.getTime();
    }
    try {
        const options = {
            strategy: ctx.query.match || 'keyword',
            scope: ctx.query.scope || 'all',
            limit: Math.max(Math.min(parseInt(ctx.query.limit, 10), 1000), 1) || 1,
            versionType: ctx.query.version || '',
            branchId: ctx.query.branch || '',
            enumId: ctx.query.enum || '',
            searchText: ctx.query.q || '',
            format: ctx.query.format || 'json'
        };
        const result = doSearch(dataStore, options);
        if (options.format === 'text') {
            ctx.body = toHumanReadable(options, result);
        } else {
            ctx.body = {
                data: {
                    count: result.length,
                    hash: toPWAHash(options),
                    result
                }
            };
        }
        const time = Date.now() - now;
        const results = `${result.length} result(s) in ${time}ms`;
        process.stdout.write(`[${dateTimeToString(now)} ${ctx.ip} <-] ${options.searchText} -> ${results}\n`);
    } catch (err) {
        ctx.status = 400;
        ctx.body = { error: err.message };
        process.stdout.write(`[${dateTimeToString(now)} ${ctx.ip} <-] Error: ${err.message}\n${err.stack}\n`);
    }
});

app.proxy = true;

app.use(router.routes()).use(router.allowedMethods());

app.listen(PORT);

process.stdout.write(`Server started at http://localhost:${PORT}\n`);
