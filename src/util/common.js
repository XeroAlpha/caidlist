const fs = require("fs");
const nodePath = require("path");
const readline = require("readline");
const JSON = require("comment-json");

const projectOutput = nodePath.resolve(__dirname, "../../output");

const sleepAsync = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Examples:
 * 1. cachedOutput(id [, nullValue = undefined]) => cache ?? nullValue
 * 
 * 2. cachedOutput(id, nonNullValue) => nonNullValue
 *    cache = nonNullValue
 * 
 * 3. cachedOutput(id, Promise.resolve(any)) => Promise resolves any
 *    cache = await valueOrProcessor();
 * 
 * 4. cachedOutput(id, () => any) => cache ?? any
 *    cache = cache ?? valueOrProcessor()
 * 
 * 5. cachedOutput(id, () => Promise.resolve(any)) => cache ?? Promise resolves any
 *    cache = cache ?? await valueOrProcessor()
 */
function cachedOutput(id, valueOrProcessor) {
    let path = nodePath.resolve(projectOutput, id + ".json");
    let useCache = fs.existsSync(path);
    let processor;
    if (valueOrProcessor == null) {
        if (!useCache) return null;
    } else if (valueOrProcessor instanceof Function) {
        processor = valueOrProcessor;
    } else {
        useCache = false;
        processor = () => valueOrProcessor;
    }
    if (useCache) {
        return JSON.parse(fs.readFileSync(path, "utf-8"));
    } else {
        let output = processor();
        if (output instanceof Promise) {
            return output.then(output => {
                fs.writeFileSync(path, JSON.stringify(output, null, 4));
                return output;
            });
        } else if (output != undefined) {
            fs.writeFileSync(path, JSON.stringify(output, null, 4));
        }
        return output;
    }
}

function input(query) {
    return new Promise(resolve => {
        let rl = readline.Interface(process.stdin, process.stdout);
        rl.question(query ?? "", answer => {
            resolve(answer);
            rl.close();
        });
    });
}

function pause(query) {
    return input(query);
}

function checkPause(timeout, query) {
    return new Promise(resolve => {
        let stdin = process.stdin;
        let hasSignal = false;
        let onData = () => hasSignal = true;
        stdin.on("data", onData);
        setTimeout(() => {
            stdin.removeListener("data", onData);
            if (hasSignal) {
                pause(query).then(resolve);
            } else {
                resolve();
            }
        }, timeout);
    });
}

function runJobsAndReturn(mainJob, ...concurrentJobs) {
    return Promise.all([ mainJob, ...concurrentJobs ])
        .then(results => results[0]);
}

function forEachObject(object, f, thisArg) {
    Object.keys(object).forEach(key => f.call(thisArg, object[key], key, object));
}

function filterObjectMap(map, predicate) {
    return JSON.assign({}, map, Object.keys(map).filter(key => predicate(key, map[key], map)));
}

function replaceObjectKey(object, replaceArgsGroups) {
    let newObject = {};
    forEachObject(object, (value, key) => {
        let replacedKey = replaceArgsGroups.reduce((prev, args) => prev.replace(...args), key);
        newObject[replacedKey] = value;
    });
    return newObject;
}

function keyArrayToObject(arr, f) {
    let obj = {};
    arr.forEach((e, i, a) => obj[e] = f(e, i, a));
    return obj;
}

function kvArrayToObject(kv) {
    let obj = {};
    arr.forEach((kv) => obj[k] = v);
    return obj;
}

function objectToArray(obj, f) {
    return Object.keys(obj).map(k => f(k, obj[k], obj));
}

function compareMinecraftVersion(a, b) {
    const asVersionArray = str => {
        return str
            .split(".")
            .map(e => e == "*" ? Infinity : parseInt(e))
            .map(e => isNaN(e) ? -1 : e);
    };
    const aver = asVersionArray(a), bver = asVersionArray(b);
    let i, minLength = Math.min(aver.length, bver.length);
    for (i = 0; i < minLength; i++) {
        if (aver[i] == bver[i]) continue;
        return aver[i] - bver[i];
    }
    return aver.length - bver.length;
}

function testMinecraftVersionInRange(version, rangeL, rangeU) {
    return compareMinecraftVersion(version, rangeL) >= 0 && compareMinecraftVersion(version, rangeU) <= 0;
}

function fixZero(str, zeroCount) {
    return str.length >= zeroCount ? str : "0" + fixZero(str, zeroCount - 1);
}

function formatTimeLeft(seconds) {
    if (seconds < 100) {
        return `${seconds.toFixed(1)}s`;
    } else if (seconds < 6000) {
        return `${Math.floor(seconds / 60)}m${fixZero((seconds % 60).toFixed(0), 2)}s`;
    } else {
        return `${Math.floor(seconds / 3600)}h${fixZero(Math.floor(seconds / 60) % 60, 2)}m${fixZero((seconds % 60).toFixed(0), 2)}s`;
    }
}

async function retryUntilComplete(maxRetryCount, retryInterval, f) {
    let result;
    while(maxRetryCount > 0) {
        result = await f();
        if (result) return result;
        if (retryInterval) await sleepAsync(retryInterval);
        maxRetryCount--;
    }
    throw new Error("Retry count limit exceeded");
}

function cascadeMap(mapOfMap, priority, includeAll) {
    let i, result = {};
    if (includeAll) {
        for (i in mapOfMap) {
            JSON.assign(result, mapOfMap[i]);
        }
    }
    for (i = priority.length - 1; i >= 0; i--) {
        JSON.assign(result, mapOfMap[priority[i]]);
    }
    return result;
};

function removeMinecraftNamespace(array) {
    return array.map((item, _, array) => {
        if (!item.includes(":")) {
            let nameWithNamespace = "minecraft:" + item;
            if (array.includes(nameWithNamespace)) {
                return null;
            }
        }
        return item;
    }).filter(item => item != null);
}

function setInlineCommentAfterField(obj, fieldName, comment) {
    if (comment) {
        obj[Symbol.for("after:" + fieldName)] = [{
            type: "LineComment",
            value: " " + comment,
            inline: true
        }];
    } else {
        delete obj[Symbol.for("after:" + fieldName)];
    }
}

function eventTriggered(eventEmitter, triggerEvent) {
    return new Promise((resolve) => {
        eventEmitter.once(triggerEvent, resolve);
    });
}

module.exports = {
    projectOutput,
    sleepAsync,
    cachedOutput,
    input,
    pause,
    checkPause,
    runJobsAndReturn,
    forEachObject,
    filterObjectMap,
    replaceObjectKey,
    keyArrayToObject,
    kvArrayToObject,
    objectToArray,
    compareMinecraftVersion,
    testMinecraftVersionInRange,
    formatTimeLeft,
    retryUntilComplete,
    cascadeMap,
    removeMinecraftNamespace,
    setInlineCommentAfterField,
    eventTriggered
};