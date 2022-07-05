const fs = require("fs");
const nodePath = require("path");
const readline = require("readline");
const notifier = require("node-notifier");
const JSON = require("comment-json");

const projectRoot = nodePath.resolve(__dirname, "../..");

function projectPath(id, suffix) {
    let pathSegments;
    if (!suffix) suffix = "json";
    if (Array.isArray(id)) {
        pathSegments = id;
    } else {
        pathSegments = id.split(".");
    }
    pathSegments[pathSegments.length - 1] += "." + suffix;
    let path = nodePath.resolve(projectRoot, ...pathSegments);
    fs.mkdirSync(nodePath.resolve(path, ".."), { recursive: true });
    return path;
}

const sleepAsync = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    let path = projectPath(id, "json");
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
        try {
            return JSON.parse(fs.readFileSync(path, "utf-8"));
        } catch (e) {
            console.error("Cannot use cache: " + path);
        }
        fs.unlinkSync(path);
        return cachedOutput(id, valueOrProcessor);
    } else {
        let output = processor();
        if (output instanceof Promise) {
            return output.then((output) => {
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
    return new Promise((resolve) => {
        let rl = readline.Interface(process.stdin, process.stdout);
        rl.question(query ?? "", (answer) => {
            resolve(answer);
            rl.close();
        });
    });
}

function pause(message) {
    notify(message);
    return input(message);
}

function notify(message) {
    notifier.notify({
        title: "IDList",
        message,
        icon: nodePath.resolve(__dirname, "../assets/icon.png"),
    })
}

async function runJobsAndReturn(mainJob, ...concurrentJobs) {
    const results = await Promise.all([mainJob, ...concurrentJobs]);
    return results[0];
}

function uniqueAndSort(array, compareFn) {
    array.sort(compareFn);
    if (!compareFn) compareFn = (a, b) => (a < b ? -1 : a == b ? 0 : 1);
    for (let i = array.length - 2; i >= 0; i--) {
        if (compareFn(array[i], array[i + 1]) == 0) {
            array.splice(i, 1);
        }
    }
}

function forEachObject(object, f, thisArg) {
    Object.keys(object).forEach((key) => f.call(thisArg, object[key], key, object));
}

function filterObjectMap(map, predicate) {
    const keys = Object.keys(map).filter((key) => predicate(key, map[key], map));
    return JSON.assign({}, map, keys);
}

function excludeObjectEntry(map, excludeKeys, excludeValues) {
    if (!excludeKeys) excludeKeys = [];
    if (!excludeValues) excludeValues = [];
    return filterObjectMap(map, (k, v) => !excludeKeys.includes(k) && !excludeValues.includes(v));
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
    arr.forEach((e, i, a) => (obj[e] = f(e, i, a)));
    return obj;
}

function kvArrayToObject(kvArray) {
    let obj = {};
    kvArray.forEach((kv) => (obj[kv[0]] = kv[1]));
    return obj;
}

function objectToArray(obj, f) {
    return Object.keys(obj).map((k) => f(k, obj[k], obj));
}

function deepCopy(something) {
    if (Array.isArray(something)) {
        return something.map((e) => deepCopy(e));
    } else if (typeof something == "object") {
        let newObject = {};
        forEachObject(something, (value, key) => {
            newObject[key] = deepCopy(value);
        });
        return newObject;
    } else {
        return something;
    }
}

function compareMinecraftVersion(a, b) {
    const asVersionArray = (str) => {
        return str
            .split(".")
            .map((e) => (e == "*" ? Infinity : parseInt(e)))
            .map((e) => (isNaN(e) ? -1 : e));
    };
    const aver = asVersionArray(a),
        bver = asVersionArray(b);
    let minLength = Math.min(aver.length, bver.length);
    for (let i = 0; i < minLength; i++) {
        if (aver[i] == bver[i]) continue;
        return aver[i] - bver[i];
    }
    return aver.length - bver.length;
}

function testMinecraftVersionInRange(version, rangeL, rangeU) {
    return compareMinecraftVersion(version, rangeL) >= 0 && compareMinecraftVersion(version, rangeU) <= 0;
}

function formatTimeLeft(seconds) {
    const sec = (seconds % 60).toFixed(0);
    const min = (Math.floor(seconds / 60) % 60).toFixed(0);
    const hr = Math.floor(seconds / 3600).toFixed(0);
    if (seconds > 6000) {
        return `${hr}h${min.padStart(2, "0")}m${sec.padStart(2, "0")}s`;
    } else if (seconds > 60) {
        return `${min}m${sec.padStart(2, "0")}s`;
    } else {
        return `${seconds.toFixed(1)}s`;
    }
}

async function retryUntilComplete(maxRetryCount, retryInterval, f) {
    let result, lastError;
    while (maxRetryCount > 0) {
        try {
            result = await f();
            if (result) return result;
        } catch (err) {
            lastError = err;
        }
        if (retryInterval) await sleepAsync(retryInterval);
        maxRetryCount--;
    }
    throw lastError || new Error("Retry count limit exceeded");
}

function cascadeMap(mapOfMap, priority, includeAll) {
    const result = {};
    let i;
    if (includeAll) {
        for (i in mapOfMap) {
            JSON.assign(result, mapOfMap[i]);
        }
    }
    for (i = priority.length - 1; i >= 0; i--) {
        JSON.assign(result, mapOfMap[priority[i]]);
    }
    return result;
}

function removeMinecraftNamespace(array) {
    return array
        .map((item, _, array) => {
            if (!item.includes(":")) {
                let nameWithNamespace = "minecraft:" + item;
                if (array.includes(nameWithNamespace)) {
                    return null;
                }
            }
            return item;
        })
        .filter((item) => item != null);
}

function setInlineCommentAfterField(obj, fieldName, comment) {
    if (comment) {
        obj[Symbol.for("after:" + fieldName)] = [
            {
                type: "LineComment",
                value: " " + comment,
                inline: true
            }
        ];
    } else {
        delete obj[Symbol.for("after:" + fieldName)];
    }
}

function eventTriggered(eventEmitter, triggerEvent) {
    return new Promise((resolve) => {
        eventEmitter.once(triggerEvent, resolve);
    });
}

async function forEachArray(arr, f, thisArg) {
    const len = arr.length;
    for (let i = 0; i < len; i++) {
        await f.call(thisArg, arr[i], i, arr);
    }
}

function peekDataFromStream(stream, timeout) {
    const data = stream.read();
    if (data === null) {
        return new Promise((resolve, reject) => {
            const callback = (error, data) => {
                stream.off("readable", readableCallback);
                stream.off("error", errorCallback);
                if (error) {
                    reject(error);
                } else {
                    resolve(data);
                }
            }
            const readableCallback = () => {
                callback(null, stream.read());
            };
            const errorCallback = (err) => {
                callback(err);
            };
            let timeoutId;
            stream.on("readable", readableCallback);
            stream.on("error", errorCallback);
            if (timeout > 0) {
                const timeoutError = new Error(`Timeout ${timeout} exceed.`);
                timeoutId = setTimeout(() => {
                    callback(timeoutError);
                }, timeout);
            }
        });
    } else {
        return data;
    }
}

module.exports = {
    projectPath,
    sleepAsync,
    cachedOutput,
    pause,
    notify,
    runJobsAndReturn,
    uniqueAndSort,
    forEachObject,
    filterObjectMap,
    excludeObjectEntry,
    replaceObjectKey,
    keyArrayToObject,
    kvArrayToObject,
    objectToArray,
    deepCopy,
    compareMinecraftVersion,
    testMinecraftVersionInRange,
    formatTimeLeft,
    retryUntilComplete,
    cascadeMap,
    removeMinecraftNamespace,
    setInlineCommentAfterField,
    eventTriggered,
    forEachArray,
    peekDataFromStream
};
