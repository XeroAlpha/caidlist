import { mkdirSync, existsSync, readFileSync, unlinkSync, writeFileSync, statSync } from 'fs';
import nodePath from 'path';
import { createInterface } from 'readline';
import { URL, fileURLToPath } from 'url';
import { inspect } from 'util';
import notifier from 'node-notifier';
import * as CommentJSON from '@projectxero/comment-json';
import { CommentLocation, setJSONComment, clearJSONComment } from './comment.js';

export const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

export const projectInfo = JSON.parse(readFileSync(nodePath.resolve(projectRoot, 'package.json')));

function toShortTimeString(date) {
    const hh = date.getHours().toString().padStart(2, '0');
    const mm = date.getMinutes().toString().padStart(2, '0');
    const ss = date.getSeconds().toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

let isLineDirty = false;
export function setStatus(statusText) {
    if (process.stdout.isTTY) {
        process.stdout.cursorTo(0);
        process.stdout.write(statusText.slice(0, process.stdout.columns));
        process.stdout.clearLine(1);
    } else {
        process.stdout.write(`${statusText}  \r`);
    }
    isLineDirty = statusText.length > 0;
}

export function log(text) {
    if (isLineDirty) setStatus('');
    process.stdout.write(`[${toShortTimeString(new Date())}] ${text}\n`);
}

export function warn(text, error) {
    if (isLineDirty) setStatus('');
    process.stderr.write(`[${toShortTimeString(new Date())}] ${text}\n`);
    if (error) {
        process.stderr.write(`${inspect(error)}\n`);
    }
}

export function projectPath(id, suffix) {
    let pathSegments;
    if (Array.isArray(id)) {
        pathSegments = id;
    } else {
        pathSegments = id.split('.');
    }
    if (suffix !== '') {
        pathSegments[pathSegments.length - 1] += `.${suffix || 'json'}`;
    }
    const path = nodePath.resolve(projectRoot, ...pathSegments);
    mkdirSync(nodePath.resolve(path, '..'), { recursive: true });
    return path;
}

export const sleepAsync = (ms) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

/**
 * Examples:
 * 1. cachedOutput(id [, nullValue = undefined], expires) => cache ?? nullValue
 *
 * 2. cachedOutput(id, nonNullValue) => nonNullValue
 *    cache = nonNullValue
 *
 * 3. cachedOutput(id, Promise.resolve(any)) => Promise resolves any
 *    cache = await valueOrProcessor();
 *
 * 4. cachedOutput(id, () => any, expires) => cache ?? any
 *    cache = cache ?? valueOrProcessor()
 *
 * 5. cachedOutput(id, () => Promise.resolve(any), expires) => cache ?? Promise resolves any
 *    cache = cache ?? await valueOrProcessor()
 *
 * When `expires` is `Date`, it refers to the expire timestamp (cache will expire after it),
 * otherwise it refers to the milliseconds the cache takes to expire.
 */
export function cachedOutput(id, valueOrProcessor, expires) {
    const path = projectPath(id, 'json');
    let useCache = existsSync(path);
    let processor;
    if (valueOrProcessor === undefined) {
        if (!useCache) return null;
    } else if (valueOrProcessor instanceof Function) {
        processor = valueOrProcessor;
    } else {
        useCache = false;
        processor = () => valueOrProcessor;
    }
    if (useCache && expires !== undefined) {
        const { mtime } = statSync(path);
        if (expires instanceof Date) {
            useCache = mtime < expires;
        } else if (typeof expires === 'number') {
            useCache = Date.now() - mtime.getTime() < expires;
        }
    }
    if (useCache) {
        try {
            return CommentJSON.parse(readFileSync(path, 'utf-8'));
        } catch (e) {
            process.stderr.write(`Cannot use cache: ${path}`, e);
        }
        unlinkSync(path);
        return cachedOutput(id, valueOrProcessor);
    }
    const output = processor();
    if (output instanceof Promise) {
        return output.then((outputResolve) => {
            writeFileSync(path, CommentJSON.stringify(outputResolve, null, 4));
            return outputResolve;
        });
    }
    if (output !== undefined) {
        writeFileSync(path, CommentJSON.stringify(output, null, 4));
    }
    return output;
}

function input(query) {
    return new Promise((resolve) => {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(query ?? '', (answer) => {
            resolve(answer);
            rl.close();
        });
    });
}

export function notify(message) {
    notifier.notify({
        title: 'IDList',
        message,
        icon: nodePath.resolve(projectRoot, 'src/assets/icon.png')
    });
}

export async function pause(message) {
    let timeout = setTimeout(() => {
        timeout = null;
        notify(message);
    }, 1000);
    await input(message);
    if (timeout) clearTimeout(timeout);
}

export async function runJobsAndReturn(mainJob, ...concurrentJobs) {
    const results = await Promise.all([mainJob, ...concurrentJobs]);
    return results[0];
}

export function uniqueAndSort(array, compareFn) {
    const compare = compareFn ?? ((a, b) => (a < b ? -1 : a === b ? 0 : 1));
    array.sort(compare);
    for (let i = array.length - 2; i >= 0; i--) {
        if (compare(array[i], array[i + 1]) === 0) {
            array.splice(i, 1);
        }
    }
}

export function pickAndAssignObject(target, source, keys) {
    for (const key of keys) target[key] = source[key];
    return target;
}

/**
 * @template K, V
 * @param {Record<K, V>} object
 * @param {(v: V, k: K, o: Record<K, V>) => void} f
 */
export function forEachObject(object, f, thisArg) {
    Object.keys(object).forEach((key) => f.call(thisArg, object[key], key, object));
}

export function filterObjectMap(map, predicate) {
    const keys = Object.keys(map).filter((key) => predicate(key, map[key], map));
    return pickAndAssignObject({}, map, keys);
}

export function excludeObjectEntry(map, excludeKeys, excludeValues) {
    const excludeKeysOpt = excludeKeys ?? [];
    const excludeValuesOpt = excludeValues ?? [];
    return filterObjectMap(map, (k, v) => !excludeKeysOpt.includes(k) && !excludeValuesOpt.includes(v));
}

export function replaceObjectKey(object, replaceArgsGroups) {
    const newObject = {};
    forEachObject(object, (value, key) => {
        const replacedKey = replaceArgsGroups.reduce((prev, args) => prev.replace(...args), key);
        newObject[replacedKey] = value;
    });
    return newObject;
}

export function keyArrayToObject(arr, f) {
    const obj = {};
    arr.forEach((e, i, a) => (obj[e] = f(e, i, a)));
    return obj;
}

export function objectToArray(obj, f) {
    return Object.keys(obj).map((k) => f(k, obj[k], obj));
}

export function deepCopy(json) {
    if (Array.isArray(json)) {
        return json.map((e) => deepCopy(e));
    }
    if (typeof json === 'object') {
        const newObject = {};
        forEachObject(json, (value, key) => {
            newObject[key] = deepCopy(value);
        });
        return newObject;
    }
    return json;
}

export function isExtendFrom(o, parent) {
    return Object.entries(parent).every(([k, v]) => o[k] === v);
}

export function isArraySetEqual(a, b) {
    return a.length === b.length && a.every((e) => b.includes(e));
}

export const stringComparator = (a, b) => (a > b ? 1 : a < b ? -1 : 0);

export function naturalOrderSort(arr) {
    const splited = new Map(arr.map((t) => [t, t.split(/(\d+)/g).map((e, i) => (i % 2 === 0 ? e : Number(e)))]));
    return arr.sort((a, b) => {
        const aArr = splited.get(a);
        const bArr = splited.get(b);
        const minLen = Math.min(aArr.length, bArr.length);
        for (let i = 0; i < minLen; i++) {
            if (aArr[i] === bArr[i]) continue;
            return aArr[i] > bArr[i] ? 1 : aArr[i] < bArr[i] ? -1 : 0;
        }
        return aArr.length - bArr.length;
    });
}

export function sortObjectKey(o, depth) {
    const entries = Object.entries(o);
    entries.sort((a, b) => stringComparator(a[0], b[0]));
    if (depth !== undefined && depth > 1) {
        for (const entry of entries) {
            entry[1] = sortObjectKey(entry[1], depth - 1);
        }
    }
    return Object.fromEntries(entries);
}

export function compareMinecraftVersion(a, b) {
    const asVersionArray = (str) =>
        str
            .split('.')
            .map((e) => (e === '*' ? Infinity : parseInt(e, 10)))
            .map((e) => (Number.isNaN(e) ? -1 : e));
    const aver = asVersionArray(a);
    const bver = asVersionArray(b);
    const minLength = Math.min(aver.length, bver.length);
    for (let i = 0; i < minLength; i++) {
        if (aver[i] === bver[i]) continue;
        return aver[i] - bver[i];
    }
    return aver.length - bver.length;
}

export function testMinecraftVersionInRange(version, rangeL, rangeU) {
    return compareMinecraftVersion(version, rangeL) >= 0 && compareMinecraftVersion(version, rangeU) <= 0;
}

export function formatTimeLeft(seconds) {
    const sec = (seconds % 60).toFixed(0);
    const min = (Math.floor(seconds / 60) % 60).toFixed(0);
    const hr = Math.floor(seconds / 3600).toFixed(0);
    if (seconds >= 6000) {
        return `${hr}h${min.padStart(2, '0')}m${sec.padStart(2, '0')}s`;
    }
    if (seconds >= 60) {
        return `${min}m${sec.padStart(2, '0')}s`;
    }
    return `${seconds.toFixed(1)}s`;
}

export async function retryUntilComplete(maxRetryCount, retryInterval, f) {
    let result;
    let lastError;
    let retryCountLeft = maxRetryCount;
    while (retryCountLeft > 0) {
        try {
            result = await f();
            if (result) return result;
        } catch (err) {
            lastError = err;
        }
        if (retryInterval) await sleepAsync(retryInterval);
        retryCountLeft--;
    }
    throw lastError || new Error('Retry count limit exceeded');
}

export function cascadeMap(mapOfMap, priority, includeAll) {
    const mapKeys = [...priority];
    if (includeAll) {
        for (const key of Object.keys(mapOfMap)) {
            if (!mapKeys.includes(key)) {
                mapKeys.push(key);
            }
        }
    }
    const result = {};
    mapKeys.forEach((mapKey) => {
        forEachObject(Object.getOwnPropertyDescriptors(mapOfMap[mapKey]), (desc, k) => {
            Object.defineProperty(result, `${k} (${mapKey})`, desc);
            if (!(k in result)) {
                Object.defineProperty(result, k, desc);
            }
        });
    });
    return result;
}

export function removeMinecraftNamespace(array) {
    return array
        .map((item) => {
            if (!item.includes(':')) {
                const nameWithNamespace = `minecraft:${item}`;
                if (array.includes(nameWithNamespace)) {
                    return null;
                }
            }
            return item;
        })
        .filter((item) => item != null);
}

export function setInlineCommentAfterField(obj, fieldName, comment) {
    const symbol = CommentLocation.after(fieldName);
    if (comment) {
        setJSONComment(obj, symbol, 'inlineLine', ` ${comment}`);
    } else {
        clearJSONComment(obj, symbol);
    }
}

/**
 * @template T, This
 * @param {T[]} arr
 * @param {(this: This, e: T, i: number, a: T[]) => void} f
 * @param {This} thisArg
 */
export async function forEachArray(arr, f, thisArg) {
    const len = arr.length;
    for (let i = 0; i < len; i++) {
        await f.call(thisArg, arr[i], i, arr);
    }
}

export function readStreamOnce(stream, timeout) {
    const data = stream.read();
    if (data === null) {
        return new Promise((resolve, reject) => {
            let readableCallback;
            let errorCallback;
            let timeoutId;
            const callback = (error, result) => {
                stream.off('readable', readableCallback);
                stream.off('error', errorCallback);
                clearTimeout(timeoutId);
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            };
            readableCallback = () => {
                callback(null, stream.read());
            };
            errorCallback = (err) => {
                callback(err);
            };
            stream.on('readable', readableCallback);
            stream.on('error', errorCallback);
            if (timeout > 0) {
                const timeoutError = new Error(`Timeout ${timeout} exceed.`);
                timeoutId = setTimeout(() => {
                    callback(timeoutError);
                }, timeout);
            }
        });
    }
    return data;
}
