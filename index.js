//#region Common
const fs = require("fs");
const nodePath = require("path");
const readline = require("readline");
const JSON = require("comment-json");
const config = require("./config");

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
    let path = nodePath.resolve(__dirname, "output", id + ".json");
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
//#endregion

//#region Autocompletion related
const adb = require("@devicefarmer/adbkit").Adb;
const sharp = require("sharp");
const assert = require("assert").strict;
const tesseract = require("node-tesseract-ocr");
const tesseractMistakes = require("./tesseract_mistakes.json");

async function adbShell(device, command) {
    let stream = await device.shell(command);
    return await adb.util.readAll(stream);
}

async function getDeviceSurfaceOrientation(device) {
    let output = await adbShell(device, "dumpsys input | grep SurfaceOrientation | awk '{print $2}' | head -n 1");
    return parseInt(output.toString().trim());
}

async function getAnyOnlineDevice(adbClient) {
    let devices = await adbClient.listDevices();
    let onlineDevices = devices.filter(device => device.type != "offline");
    if (onlineDevices.length != 0) {
        return adbClient.getDevice(onlineDevices[0].id);
    } else {
        return null;
    }
}

async function waitForAnyDevice(adbClient) {
    let onlineDevice = await getAnyOnlineDevice(adbClient);
    if (!onlineDevice) {
        let tracker = await adbClient.trackDevices();
        return new Promise((resolve, reject) => {
            tracker.on("changeSet", changes => {
                let checkingDevices = [...changes.added, ...changes.changed];
                checkingDevices = checkingDevices.filter(device => device.type != "offline");
                if (checkingDevices.length != 0) {
                    resolve(adbClient.getDevice(checkingDevices[0].id));
                    tracker.end();
                }
            });
            tracker.on("error", err => reject(err));
        });
    } else {
        return onlineDevice;
    }
}

async function openMonkey(device) {
    let monkeyPid = (await adbShell(device, "ps -A | grep com.android.commands.monkey | awk '{print $2}'")).toString().trim();
    if (monkeyPid) { // kill monkey
        await adbShell(device, "kill -9 " + monkeyPid);
        await sleepAsync(1000);
    }
    return device.openMonkey();
}

function sendMonkeyCommand(monkey, command) {
    return new Promise((resolve, reject) => {
        monkey.send(command, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

async function captureScreen(device) {
    let screenshotPngStream = await device.screencap();
    return await adb.util.readAll(screenshotPngStream);
}

async function recogizeCommand(screenshotPng, surfaceOrientation) {
    let commandAreaRect = config.commandAreaRect[surfaceOrientation];
    let img = sharp(screenshotPng);
    img.removeAlpha()
        .extract({
            left: commandAreaRect[0],
            top: commandAreaRect[1],
            width: commandAreaRect[2],
            height: commandAreaRect[3]
        })
        .negate()
        .threshold(60);
    let commandTextImage = await img.png().toBuffer();
    // await img.png().toFile("test.png");
    let commandText = await tesseract.recognize(commandTextImage, {
        ...config.tesseract,
        lang: "eng",
        psm: 7,
        oem: 3
    });
    commandText = commandText.trim();
    if (commandText in tesseractMistakes) {
        return tesseractMistakes[commandText];
    }
    return commandText;
}

async function recogizeCommandRemoteSync(device, surfaceOrientation) {
    return await recogizeCommand(await captureScreen(device), surfaceOrientation);
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

function guessTruncatedString(truncatedStr, startsWith) {
    let spos, tpos;
    for (spos = 0; spos < startsWith.length; spos++) {
        tpos = truncatedStr.indexOf(startsWith.slice(spos));
        if (tpos >= 0 && tpos <= 3) {
            return startsWith + truncatedStr.slice(tpos - spos + startsWith.length);
        }
    }
    return null;
}

async function analyzeCommandAutocompletion(device, command, progressName, approxLength) {
    // 初始状态：游戏HUD
    let autocompletions = [];
    let surfaceOrientation = await getDeviceSurfaceOrientation(device);
    let monkey = await openMonkey(device);
    
    // 打开聊天栏
    await sendMonkeyCommand(monkey, "press KEYCODE_T");

    console.log(`Starting ${progressName}: ${command}`);
    await adbShell(device, "input text " + JSON.stringify(command));

    let screenshotPng = await captureScreen(device);
    const pressTabThenCapture = async () => {
        await sendMonkeyCommand(monkey, "press KEYCODE_TAB");
        await sleepAsync(100); // wait for responding to key events
        screenshotPng = await captureScreen(device);
    };
    let autocompletedCommand = command.trim();
    let recogizedCommand = await runJobsAndReturn(
        recogizeCommand(screenshotPng, surfaceOrientation),
        pressTabThenCapture()
    );
    assert.equal(recogizedCommand, autocompletedCommand);
    let timeStart = Date.now(), stepCount = 0;
    while(true) {
        let newRecognizedCommand = await runJobsAndReturn(
            recogizeCommand(screenshotPng, surfaceOrientation),
            pressTabThenCapture()
        );
        assert.notEqual(newRecognizedCommand, recogizeCommand);
        recogizedCommand = newRecognizedCommand;

        autocompletedCommand = guessTruncatedString(recogizedCommand, command);
        if (!autocompletedCommand) {
            throw new Error("Auto-completed command test failed: " + recogizedCommand);
        }

        let autocompletion = autocompletedCommand.slice(command.length);
        if (autocompletions.includes(autocompletion)) {
            console.log("Exit condition: " + autocompletion);
            break;
        } else {
            autocompletions.push(autocompletion);
            if (approxLength) {
                let stepSpentAvg = (Date.now() - timeStart) / ++stepCount;
                let percentage = (autocompletions.length / approxLength * 100).toFixed(1);
                let timeLeft = (approxLength - autocompletions.length) * stepSpentAvg;
                let timeLeftStr = formatTimeLeft(timeLeft / 1000);
                let estTimeStr = new Date(Date.now() + timeLeft).toLocaleTimeString();
                console.log(`[${autocompletions.length}/${approxLength} ${percentage}% ${estTimeStr} ~${timeLeftStr}]${progressName} ${recogizedCommand}`);
            } else {
                console.log(`[${autocompletions.length}/?]${progressName} ${recogizedCommand}`);
            }
        }
    }

    // 退出聊天栏
    await sendMonkeyCommand(monkey, "press KEYCODE_ESCAPE");
    await sendMonkeyCommand(monkey, "press KEYCODE_ESCAPE");
    await sendMonkeyCommand(monkey, "quit");
    monkey.end();

    return autocompletions;
}

async function analyzeAutocompletionEnumCached(options, name, commandPrefix, exclusion) {
    const {
        device,
        branch, version, target
    } = options;
    const id = name.replace(/\s+(\S)/g, (_, ch) => ch.toUpperCase());
    const cacheId = `autocompleted.${branch}.${name.replace(/\s+/g, "_")}`;
    let cache = cachedOutput(cacheId), result;

    if (Array.isArray(cache)) cache = { result: cache, length: cache.length };
    if (cache && version == cache.version) result = cache.result;
    if (!result) {
        let progressName = `${branch}.${name.replace(/\s+/g, "_")}`;
        result = await analyzeCommandAutocompletion(device, commandPrefix, progressName, cache && cache.length);
        if (exclusion) result = result.filter(e => !exclusion.includes(e));
        cachedOutput(cacheId, { version, result, length: result.length });
    }
    return target[id] = result;
}

async function analyzeAutocompletionEnums(branch, version) {
    const cacheId = `autocompleted.${branch}`;
    const cache = cachedOutput(cacheId);
    if (cache && version == cache.version) return cache;

	console.log("Connecting ADB host...");
	let adbClient = adb.createClient();
    console.log("Connecting to device...");
    let device = await getAnyOnlineDevice(adbClient);
    if (!device) {
        console.log("Please plug in the device...");
        device = await waitForAnyDevice(adbClient);
    }

    console.log("Please switch to branch: " + branch);
    await pause("Press <Enter> if the device is ready");
    const target = { version };
    const options = {
        device,
        branch, version, target
    };

    await analyzeAutocompletionEnumCached(options, "blocks", "/testforblock ~ ~ ~ ");
    await analyzeAutocompletionEnumCached(options, "items", "/clear @s ", [ "[" ]);
    await analyzeAutocompletionEnumCached(options, "entities", "/testfor @e[type=", [ "!" ]);
    await analyzeAutocompletionEnumCached(options, "summonable entities", "/summon ");
    await analyzeAutocompletionEnumCached(options, "effects", "/effect @s ", [ "[", "clear" ]);
    await analyzeAutocompletionEnumCached(options, "enchantments", "/enchant @s ", [ "[" ]);
    await analyzeAutocompletionEnumCached(options, "gamerules", "/gamerule ");
    await analyzeAutocompletionEnumCached(options, "locations", "/locate ");
    await analyzeAutocompletionEnumCached(options, "mobevents", "/mobevent ");
    await analyzeAutocompletionEnumCached(options, "selectors", "/testfor @e[");

    if (testMinecraftVersionInRange(version, "1.18.0.21", "1.18.0.21")) {
        await analyzeAutocompletionEnumCached(options, "loot tools", "/loot spawn ~ ~ ~ loot empty ", [ "mainhand", "offhand" ]);
    }

    return cachedOutput(cacheId, target);
}

async function analyzeAutocompletionEnumsCached(packageType, version) {
    let result = {
        vanilla: await analyzeAutocompletionEnums("vanilla", version)
    };
    if (packageType != "netease") {
        result.education = await analyzeAutocompletionEnums("education", version);
    }
    if (packageType == "beta") {
        result.experiment = await analyzeAutocompletionEnums("experiment", version);
    }
    return result;
}
//#endregion

//#region Package-extraction related
const AdmZip = require("adm-zip");
function parseMinecraftLang(target, langContent) {
    let regexp = /^(.+)=(.+)(?:\t)+#/;
    langContent.split("\n")
        .forEach(line => {
            line = line.trim();
            if (line.startsWith("##")) return;
            let matchResult = regexp.exec(line);
            if (matchResult) {
                target[matchResult[1]] = matchResult[2].trim();
            }
        });
}

function analyzeApkPackageLang(packageZip) {
    let entries = packageZip.getEntries(), lang = {};
    console.log("Analyzing package entries for language file...");
    entries.forEach(entry => {
        let entryName = entry.entryName;
        if (entryName.match(/^assets\/resource_packs\/(?:[^\/]+)\/texts\/zh_CN\.lang$/)) {
            parseMinecraftLang(lang, entry.getData().toString("utf-8"));
        }
    });
    return lang;
}

const branchEntryNameKeywords = {
    "vanilla": [ "vanilla" ],
    "education": [ "vanilla", "chemistry", "education" ],
    "experiment": [ "vanilla", "experiment", "test" ]
};
function analyzeApkPackageDataEnums(packageZip, branch) {
    let entries = packageZip.getEntries();
    let entryNameKeywords = branchEntryNameKeywords[branch] || [];
    let sounds = [],
        particleEmitters = [],
        animations = [],
        fogs = [],
        lootTables = [],
        entityEventsMap = {},
        entityFamilyMap = {};
    console.log("[" + branch + "]Analyzing package entries for data enums...");
    entries.forEach(entry => {
        let entryName = entry.entryName;
        if (!entryNameKeywords.some(keyword => entryName.includes(keyword))) return;
        if (entryName.match(/^assets\/resource_packs\/(?:[^\/]+)\/sounds\/sound_definitions\.json$/)) {
            let entryData = entry.getData().toString("utf-8");
            let soundDefinition = JSON.parse(entryData);
            let formatVersion = soundDefinition["format_version"];
            if (formatVersion == "1.14.0") {
                sounds.push(...Object.keys(soundDefinition["sound_definitions"]));
            } else if (!formatVersion) {
                sounds.push(...Object.keys(soundDefinition));
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        } else if (entryName.match(/^assets\/resource_packs\/(?:[^\/]+)\/particles\/(?:[^\/]+)\.json$/)) {
            let entryData = entry.getData().toString("utf-8");
            let particle = JSON.parse(entryData);
            let formatVersion = particle["format_version"];
            if (formatVersion == "1.10.0") {
                particleEmitters.push(particle["particle_effect"]["description"]["identifier"]);
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        } else if (entryName.match(/^assets\/resource_packs\/(?:[^\/]+)\/animations\/(?:[^\/]+)\.json$/)) {
            let entryData = entry.getData().toString("utf-8");
            let animation = JSON.parse(entryData);
            let formatVersion = animation["format_version"];
            if (formatVersion == "1.8.0" || formatVersion == "1.10.0") {
                animations.push(...Object.keys(animation["animations"]));
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        } else if (entryName.match(/^assets\/resource_packs\/(?:[^\/]+)\/fogs\/(?:[^\/]+)\.json$/)) {
            let entryData = entry.getData().toString("utf-8");
            let fog = JSON.parse(entryData);
            let formatVersion = fog["format_version"];
            if (formatVersion == "1.16.100") {
                fogs.push(fog["minecraft:fog_settings"]["description"]["identifier"]);
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        } else if (entryName.match(/^assets\/behavior_packs\/(?:[^\/]+)\/entities\/(?:[^\/]+)\.json$/)) {
            let entryData = entry.getData().toString("utf-8");
            let entity = JSON.parse(entryData);
            let formatVersion = entity["format_version"];
            if (formatVersion == "1.8.0" ||
                formatVersion == "1.10.0" || 
                formatVersion == "1.12.0" ||
                formatVersion == "1.13.0" ||
                formatVersion == "1.14.0" ||
                formatVersion == "1.15.0" ||
                formatVersion == "1.16.0" ||
                formatVersion == "1.16.100" ||
                formatVersion == "1.16.210" ||
                formatVersion == "1.17.10" ||
                formatVersion == "1.17.20") {
                let id = entity["minecraft:entity"]["description"]["identifier"];
                let events = Object.keys(entity["minecraft:entity"]["events"] ?? {});
                let globalComponents = entity["minecraft:entity"]["components"] ?? {};
                let componentGroups = entity["minecraft:entity"]["component_groups"] ?? {};
                events.forEach(event => {
                    let eventOwners = entityEventsMap[event];
                    if (!eventOwners) eventOwners = entityEventsMap[event] = [];
                    eventOwners.push(id);
                });
                [ null, ...Object.keys(componentGroups) ].forEach(componentName => {
                    let groupId = componentName ? `${id}<${componentName}>` : id;
                    let components = componentName ? componentGroups[componentName] : globalComponents;
                    let typeFamilyObj = components["minecraft:type_family"]?.family ?? [];
                    let typeFamilies = JSON.CommentArray.isArray(typeFamilyObj) ? typeFamilyObj : [typeFamilyObj];
                    typeFamilies.forEach(familyName => {
                        let familyMembers = entityFamilyMap[familyName];
                        if (!familyMembers) familyMembers = entityFamilyMap[familyName] = [];
                        familyMembers.push(groupId);
                    });
                });
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        } else if (entryName.match(/^assets\/behavior_packs\/(?:[^\/]+)\/loot_tables\/(.+)\.json$/)) {
            let match = entryName.match(/\/loot_tables\/(.+)\.json$/);
            if (match) {
                lootTables.push(match[1]);
            }
        }
    });
    sounds = sounds.filter((e, i, a) => a.indexOf(e) >= i).sort();
    particleEmitters = particleEmitters.filter((e, i, a) => a.indexOf(e) >= i).sort();
    animations = animations.filter((e, i, a) => a.indexOf(e) >= i).sort();
    forEachObject(entityEventsMap, (value, key, obj) => {
        obj[key] = value.filter((e, i, a) => a.indexOf(e) >= i).sort();
    });
    forEachObject(entityFamilyMap, (value, key, obj) => {
        obj[key] = value.filter((e, i, a) => a.indexOf(e) >= i).sort();
    });

    return {
        sounds,
        particleEmitters,
        animations,
        fogs,
        lootTables,
        entityEventsMap,
        entityFamilyMap
    };
}

const apksInstallPack = [
    "install_pack.apk",
    "split_install_pack.apk",
    "com.mojang.minecraftpe.apk",
    "base.apk"
];
function extractInstallPack() {
    let packagePath = config.installPackagePath;
    if (packagePath.endsWith(".apks")) {
        let packageZip = new AdmZip(packagePath);
        let i, installPackApkEntry, installPackApk;
        console.log("Unpacking install pack...");
        for (i = 0; i < apksInstallPack.length; i++) {
            installPackApkEntry = packageZip.getEntry(apksInstallPack[i]);
            if (installPackApkEntry) break;
        }
        if (!installPackApkEntry) {
            throw new Error("Install Pack not found!");
        }
        installPackApk = packageZip.readFile(installPackApkEntry);
        return new AdmZip(installPackApk);
    } else {
        return new AdmZip(packagePath);
    }
}

function analyzePackageDataEnumsCached(branch) {
    let dataCache = cachedOutput("package.data");
    let langCache = cachedOutput("package.lang");
    let infoCache = cachedOutput("package.info");
    if (dataCache && langCache && infoCache && infoCache.packagePath == config.installPackagePath) {
        return {
            data: dataCache,
            lang: langCache,
            version: infoCache.version,
            packageType: infoCache.type
        };
    } else {
        let installPack = extractInstallPack();
        let lang = analyzeApkPackageLang(installPack);
        let data = {
            vanilla: analyzeApkPackageDataEnums(installPack, "vanilla"),
            education: analyzeApkPackageDataEnums(installPack, "education"),
            experiment: analyzeApkPackageDataEnums(installPack, "experiment"),
        };
        return {
            data: cachedOutput("package.data", data),
            lang: cachedOutput("package.lang", lang),
            ...cachedOutput("package.info", {
                version: config.installPackageVersion,
                type: config.installPackageType,
                packagePath: config.installPackagePath
            })
        };
    }
}
//#endregion

//#region Wiki Data Extract
const got = require("got").default;
async function fetchMZHWikiRaw(word) {
    return await got(`https://minecraft.fandom.com/zh/wiki/${word}?action=raw`).text();
}

async function fetchBEDevWikiRaw(word) {
    return await got(`https://wiki.bedev.cn/${word}?action=raw`).text();
}

function parseEnumMapLua(luaContent) {
    let enumMapStack = [{}];
    let itemRegExp = /\['(.*)'\](?:\s*)=(?:\s*)'(.*)'/,
        groupStartRegExp = /\['(.*)'\](?:\s*)=(?:\s*){/,
        groupEndRegExp = /\}(?:,)?/,
        zhHansRegExp = /-\{(.+?)\}-/g;
    luaContent.split("\n")
        .forEach(line => {
            line = line.trim();
            if (line.startsWith("--")) return;
            let matchResult;
            if (matchResult = itemRegExp.exec(line)) {
                let key = matchResult[1].replace(/\\/g, ""); // 处理 Lua 字符串转义
                let value = matchResult[2].split("|").slice(-1)[0];
                enumMapStack[0][key] = value.replace(zhHansRegExp, "$1");
            } else if (matchResult = groupStartRegExp.exec(line)) {
                let key = matchResult[1].replace(/\\/g, ""); // 处理 Lua 字符串转义
                let group = {};
                enumMapStack[0][key] = group;
                enumMapStack.unshift(group);
            } else if (groupEndRegExp.test(line)) {
                if (enumMapStack.length > 1) {
                    enumMapStack.shift();
                }
            }
        });
    return enumMapStack[0];
}

const enumMapColors = {
    "black ": "黑色", "blue ": "蓝色",
    "brown ": "棕色", "cyan ": "青色",
    "gray ": "灰色", "green ": "绿色",
    "light blue ": "淡蓝色", "light gray ": "淡灰色",
    "lime ": "黄绿色", "magenta ": "品红色",
    "orange ": "橙色", "pink ": "粉红色",
    "purple ": "紫色", "red ": "红色",
    "silver ": "淡灰色", "white ": "白色",
    "yellow ": "黄色"
};
const enumMapColoredItems = [
    "firework star", "hardened clay", "stained clay", "banner",
    "carpet", "concrete", "concrete powder", "glazed terracotta",
    "terracotta", "shield", "shulker box", "stained glass",
    "stained glass pane", "wool", "bed", "hardened glass",
    "hardened stained glass", "balloon", "glow stick",
    "hardened glass pane", "hardened glass", "sparkler", "candle"
];
function extendEnumMap(enumMaps) {
    enumMapColoredItems.forEach(item => {
        ["BlockSprite", "ItemSprite", "Exclusive"].forEach(mapName => {
            let enumMap = enumMaps[mapName];
            let color, translatedSuffix = enumMap[item];
            if (translatedSuffix) {
                for (color in enumMapColors) {
                    if (!enumMap[color + item]) {
                        enumMap[color + item] = enumMapColors[color] + translatedSuffix;
                    }
                }
            }
        });
    });
    let entity, entityMap = enumMaps["EntitySprite"], itemMap = enumMaps["ItemSprite"];
    for (entity in entityMap) {
        itemMap[entity + " spawn egg"] = entityMap[entity] + "刷怪蛋";
        itemMap["spawn " + entity] = "生成" + entityMap[entity];
    }
    return enumMaps;
}

function mergeEnumMap(maps) {
    let output = {};
    maps.forEach(map => {
        forEachObject(map, (v, k) => {
            if (k in output) {

            } else {

            }
        });
    });
    return output;
}

async function fetchStandardizedTranslation() {
    return cachedOutput("wiki.standardized_translation", async () => {
        let block, item, exclusive, mcwzhOthers, bedwOthers, bedwGlossary;

        console.log("Fetching MCWZH:ST/Autolink/Block...");
        block = parseEnumMapLua(await fetchMZHWikiRaw("模块:Autolink/Block"));

        console.log("Fetching MCWZH:ST/Autolink/Item...");
        item = parseEnumMapLua(await fetchMZHWikiRaw("模块:Autolink/Item"));

        console.log("Fetching MCWZH:ST/Autolink/Exclusive...");
        exclusive = parseEnumMapLua(await fetchMZHWikiRaw("模块:Autolink/Exclusive"));

        console.log("Fetching MCWZH:ST/Autolink/Others...");
        mcwzhOthers = parseEnumMapLua(await fetchMZHWikiRaw("模块:Autolink/Other"));

        console.log("Fetching BEDW:ST/Autolink/Others...")
        bedwOthers = parseEnumMapLua(await fetchBEDevWikiRaw("模块:Autolink/Other"));

        console.log("Fetching BEDW:ST/Autolink/Glossary...")
        bedwGlossary = parseEnumMapLua(await fetchBEDevWikiRaw("模块:Autolink/Glossary"));

        return extendEnumMap({
            BlockSprite: block,
            ItemSprite: item,
            Exclusive: exclusive,
            ...bedwGlossary,
            ...bedwOthers,
            ...mcwzhOthers
        });
    });
}
//#endregion

//#region JE Language Data Extract
const crypto = require("crypto");
function digestBufferHex(algorithm, buffer) {
    let digest = crypto.createHash(algorithm);
    digest.update(buffer);
    return digest.digest().toString("hex");
}

async function fetchVersionsManifest(apiHost) {
    return await got(`${apiHost}/mc/game/version_manifest.json`).json();
}

async function fetchVersionMeta(apiHost, manifest, versionId) {
    if (versionId == "latest" || versionId == "lastest_release") {
        versionId = manifest.latest.release;
    } else if (versionId == "latest_snapshot") {
        versionId = manifest.latest.snapshot;
    }
    let version = manifest.versions.find(version => version.id == versionId);
    if (!version) throw new Error("Version not found: " + versionId);
    return await got(version.url.replace("https://launchermeta.mojang.com", apiHost)).json();
}

async function fetchVersionAssetIndex(apiHost, versionMeta) {
    let meta = versionMeta.assetIndex;
    let content = await got(meta.url.replace("https://launchermeta.mojang.com", apiHost)).buffer();
    if (content.length == meta.size && digestBufferHex("sha1", content) == meta.sha1) {
        return JSON.parse(content.toString());
    } else {
        throw new Error("meta mismatched for asset index");
    }
}

async function fetchVersionAsset(apiHost, assetIndex, objectName) {
    let object = assetIndex.objects[objectName];
    if (!object) throw new Error("Asset object not found: " + objectName);
    let content = await got(`${apiHost}/${object.hash.slice(0, 2)}/${object.hash}`).buffer();
    if (content.length == object.size && digestBufferHex("sha1", content) == object.hash) {
        return content;
    } else {
        throw new Error("meta mismatched for asset: " + objectName);
    }
}

async function fetchJavaEditionLangData() {
    let result = await cachedOutput("java.package.lang", async () => {
        const metaApiHost = "https://launchermeta.mojang.com";
        const assetApiHost = "https://resources.download.minecraft.net";
        console.log("Fetching Java Edition language data...");
        let manifest = await fetchVersionsManifest(metaApiHost);
        let versionMeta = await fetchVersionMeta(metaApiHost, manifest, "latest_snapshot");
        let assetIndex = await fetchVersionAssetIndex(metaApiHost, versionMeta);
        let langAsset = await fetchVersionAsset(assetApiHost, assetIndex, "minecraft/lang/zh_cn.json");
        return {
            "__VERSION__": versionMeta.id,
            "__VERSION_TYPE__": versionMeta.type,
            "__VERSION_TIME__": versionMeta.time,
            ...JSON.parse(langAsset.toString())
        }
    });
    return filterObjectMap(result, k => !k.startsWith("__"));
}
//#endregion

//#region Translate Match
const util = require("util");

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

function runTemplate(template, getter) {
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, templateName) => {
        return getter(templateName);
    });
}

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
                return translateCached(key, originalValue).translation;
            });
            setInlineCommentAfterField(translationMap, originalValue, userTranslation);
        } else if (userTranslation.includes(":")) { // 直接引用
            let colonPos = userTranslation.indexOf(":");
            let source = userTranslation.slice(0, colonPos).trim();
            let key = userTranslation.slice(colonPos + 1).trim();
            if (stdTransMap && source.toLowerCase() == "st") { // 标准化译名
                userTranslation = stdTransMap[key];
            } else if (javaEditionLangMap && source.toLowerCase() == "je") { // Java版语言文件
                userTranslation = javaEditionLangMap[key];
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
    let translateCached = (originalValue, rootKey) => {
        let cache = translateCacheMap[originalValue];
        if (cache) {
            return cache;
        } else if (originalValue.includes("|")) { // 拼接模板
            let refs = originalValue.split("|").map(ref => {
                let trimedRef = ref.trim();
                if (trimedRef.startsWith("'")) { // 原始字符，原样传递
                    if (trimedRef.endsWith("'")) {
                        return trimedRef.slice(1, -1);
                    } else {
                        return trimedRef.slice(1);
                    }
                } else {
                    let result = translateCached(trimedRef, rootKey);
                    return result.translation;
                }
            });
            return {
                translation: util.format(...refs)
            };
        } else if (originalValue.includes("!")) { // 外部引用
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
    stateMaps[name] = translateStates;
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
//#endregion

//#region User Translation
const userTranslationStorageKey = {
    block: "translation.block",
    item: "translation.item",
    sound: "translation.sound",
    entity: "translation.entity",
    entityEvent: "translation.entity_event",
    entityFamily: "translation.entity_family",
    particleEmitter: "translation.particle_emitter",
    animation: "translation.animation",
    effect: "translation.effect",
    enchant: "translation.enchant",
    fog: "translation.fog",
    location: "translation.location",
    lootTable: "translation.lootTable"
};
function loadUserTranslation() {
    let userTranslation = {};
    forEachObject(userTranslationStorageKey, (v, k) => {
        userTranslation[k] = cachedOutput(v, () => new Object());
    });
    return userTranslation;
}

function saveUserTranslation(userTranslation) {
    forEachObject(userTranslationStorageKey, (v, k) => {
        cachedOutput(v, userTranslation[k]);
    });
}
//#endregion

//#region Excel output
const XLSX = require("xlsx");
function writeTransMapsExcel(outputFile, transMaps) {
    let wb = XLSX.utils.book_new();
    let mapName, transMap;
    for (mapName in transMaps) {
        transMap = transMaps[mapName];
        let aoa = Object.keys(transMap).map(key => [key, transMap[key]]);
        let ws = XLSX.utils.aoa_to_sheet([["名称", "翻译"], ...aoa]);
        XLSX.utils.book_append_sheet(wb, ws, mapName);
    }
    XLSX.writeFile(wb, outputFile);
}
//#endregion

//#region Text output
const skipTransMapKey = ["lootTableWrapped", "music", "summonableEntity", "lootTool"];
const entityNameAlias = {
    "minecraft:villager_v2": "村民",
    "minecraft:zombie_villager_v2": "僵尸村民"
};
function writeTransMapTextZip(options) {
    const {
        outputZip,
        outputJson,
        branchName,
        version,
        originalEnums,
        transMaps,
        transMapNames,
        stdTransMap,
        stdTransMapNames
    } = options;
    const footText = [
        "※此ID表是MCBEID表的一部分，对应游戏版本为" + version + "（" + branchName + "）",
        "※详见：https://gitee.com/projectxero/caidlist"
    ];
    let entityEventByEntity = {}, entityEventSplit, stdTransText, stdTransEnum;
    let enums = filterObjectMap(transMaps, k => !skipTransMapKey.includes(k));
    if (originalEnums) {
        forEachObject(enums.entityEvent, (v, k, o) => {
            let relatedEntities = originalEnums.entityEventsMap[k];
            let relatedEntitiesStr = relatedEntities.map(e => {
                return entityNameAlias[e] || enums.entity[e] || e;
            }).filter((e, i, a) => a.indexOf(e) >= i);
            relatedEntitiesStr.forEach(e => {
                let brotherEvents = entityEventByEntity[e];
                if (!brotherEvents) {
                    brotherEvents = entityEventByEntity[e] = {};
                }
                brotherEvents[k] = v;
            });
            v += "（" + relatedEntitiesStr.join("、") + "）";
            o[k] = v;
        });
        forEachObject(enums.entityFamily, (v, k, o) => {
            let relatedEntities = originalEnums.entityFamilyMap[k];
            let relatedEntitiesStr = relatedEntities.map(e => {
                let withoutComp = e.replace(/<.+>$/, "");
                return entityNameAlias[withoutComp] || enums.entity[withoutComp] || withoutComp;
            }).filter((e, i, a) => a.indexOf(e) >= i);
            if (relatedEntitiesStr.length > 1) {
                v += "（" + relatedEntitiesStr.join("、") + "）";
                o[k] = v;
            }
        });
        entityEventSplit = [];
        forEachObject(entityEventByEntity, (entityEvents, entityName) => {
            entityEventSplit.push("【" + entityName + "】");
            forEachObject(entityEvents, (entityEventDesc, entityEventName) => {
                entityEventSplit.push(entityEventName + ": " + entityEventDesc);
            });
            entityEventSplit.push("");
        });
        entityEventSplit.push(...footText);
    }
    if (stdTransMap) {
        stdTransText = [];
        stdTransEnum = {};
        stdTransMapNames.forEach(e => {
            const [ key, name ] = e;
            stdTransText.push("【" + name + "】");
            forEachObject(stdTransMap[key], (transValue, transKey) => {
                stdTransEnum[key + ": " + transKey] = transValue;
                stdTransText.push(transKey + ": " + transValue);
            });
            stdTransText.push("");
        });
        stdTransText.push(...footText);
    }
    if (outputZip) {
        let zip = new AdmZip();
        let files = {
            ...replaceObjectKey(enums, [
                [ /(.+)/, "$1.txt" ]
            ]),
            "entityEventSplit.txt": entityEventSplit,
            "stdTrans.txt": stdTransText
        };
        let fileDescriptions = transMapNames.map(e => [e[0] + ".txt", e[1]]);
        files["_MCBEID_.txt"] = [
            "【MCBEID表】",
            "官方下载地址：https://ca.projectxero.top/idlist/latest.zip",
            "本ID表由B站@ProjectXero与命令助手开发组的小伙伴们维护，发现错误或有建议可私聊UP主或加群【MCBE命令助手开发区】：671317302",
            "",
            "发布时间：" + new Date().toLocaleString(),
            "对应游戏版本：" + version + "（" + branchName + "）",
            "",
            "在线版：https://ca.projectxero.top/idlist/",
            "Minecraft 命令更新日志：https://ca.projectxero.top/blog/command/command-history/",
            "",
            "【目录】",
            ...fileDescriptions.filter(e => files[e[0]]).map(e => e[0] + ": " + e[1])
        ];
        forEachObject(files, (content, fileName) => {
            if (Array.isArray(content)) {
                content = content.join("\r\n");
            } else if (typeof content == "object") {
                let contentDescription = fileDescriptions.find(e => e[0] == fileName);
                let arr = [];
                if (contentDescription) arr.push("【" + contentDescription[1] + "】")
                forEachObject(content, (v, k) => arr.push(k + ": " + v));
                arr.push("", ...footText);
                content = arr.join("\r\n");
            } else {
                return;
            }
            zip.addFile(fileName, Buffer.from(content, "utf-8"));
        });
        fs.writeFileSync(outputZip, zip.toBuffer());
    }
    if (outputJson) {
        let jsonEnums = {
            ...enums,
            stdTrans: stdTransEnum
        };
        fs.writeFileSync(outputJson, JSON.stringify({
            branchName,
            version,
            enums: jsonEnums,
            names: transMapNames.filter(e => jsonEnums[e[0]])
        }));
    }
}
//#endregion

const branchName = {
    vanilla: "原版",
    education: "教育版",
    experiment: "实验性玩法"
};
// [ id, name, description ]
const defaultTransMapNames = [
    ["block", "方块", "用于 setblock、fill 等命令的方块 ID"],
    ["item", "物品", "用于 give、clear 等命令的物品 ID"],
    ["entity", "实体", "用于 type 选择器的实体 ID"],
    ["effect", "状态效果", "用于 effect 命令的状态效果 ID"],
    ["enchant", "魔咒", "用于 enchant 命令的魔咒 ID"],
    ["fog", "迷雾", "用于 fog 命令的迷雾配置 ID"],
    ["location", "结构", "用于 locate 命令的结构 ID"],
    ["entityEvent", "实体事件", "用于 summon 等命令的实体事件 ID"],
    ["entityEventSplit", "根据实体类型分类的实体事件表"],
    ["entityFamily", "实体族", "用于 family 选择器的实体族 ID"],
    ["animation", "动画", "用于 playanimation 命令的动画控制器 ID"],
    ["particleEmitter", "粒子发射器", "用于 particle 命令的粒子发射器 ID"],
    ["sound", "声音", "用于 playsound 命令的声音 ID"],
    ["lootTable", "战利品表", "用于 loot 命令的战利品表选项"],
    ["stdTrans", "标准化译名表", "整合了中文 Minecraft Wiki 与 Minecraft基岩版开发Wiki 的标准化译名表"]
];
const stdTransMapNames = [
    ["BlockSprite", "方块"],
    ["ItemSprite", "物品"],
    ["EntitySprite", "实体"],
    ["EffectSprite", "状态效果"],
    ["EnchantmentSprite", "魔咒"],
    ["BiomeSprite", "生物群系"],
    ["EnvSprite", "环境"],
    ["Exclusive", "基岩版独占"],
    ["VanillaSprite", "其他原版内容"],
    ["AddonSprite", "附加包术语"],
    ["ModPESprite", "ModPE术语"],
    ["InnerCoreSprite", "InnerCore术语"],
    ["TechnicSprite", "其他技术术语"]
];
async function generateOutputFiles(branch) {
    let packageDataEnums = analyzePackageDataEnumsCached();
    let autocompletedEnums = await analyzeAutocompletionEnumsCached(packageDataEnums.packageType, packageDataEnums.version);
    let enums = {
        ...packageDataEnums.data[branch],
        ...autocompletedEnums[branch]
    };
    let lang = packageDataEnums.lang;
    let standardizedTranslation = await fetchStandardizedTranslation();
    let javaEditionLang = await fetchJavaEditionLangData();
    let userTranslation = loadUserTranslation();
    console.log("Matching translations...");
    let translationResultMaps = {}, translationStateMaps = {};
    let commonOptions = {
        resultMaps: translationResultMaps,
        stateMaps: translationStateMaps,
        stdTransMap: cascadeMap(standardizedTranslation, [], true),
        javaEditionLangMap: javaEditionLang,
        langMap: lang,
        autoMatch: true
    };
    matchTranslations({
        ...commonOptions,
        name: "block",
        originalArray: enums.blocks,
        translationMap: userTranslation.block,
        stdTransMap: cascadeMap(standardizedTranslation, ["BlockSprite", "ItemSprite"], true),
        langKeyPrefix: "tile.",
        langKeySuffix: ".name"
    });
    matchTranslations({
        ...commonOptions,
        name: "item",
        originalArray: enums.items.filter(item => !enums.blocks.includes(item)),
        translationMap: userTranslation.item,
        stdTransMap: cascadeMap(standardizedTranslation, ["ItemSprite", "BlockSprite"], true),
        langKeyPrefix: "item.",
        langKeySuffix: ".name",
        postProcessor(item) {
            let mergedItem = {}, block = translationResultMaps.block;
            enums.items.forEach(key => {
                if (key in block) {
                    JSON.assign(mergedItem, block, [key]);
                } else {
                    JSON.assign(mergedItem, item, [key]);
                }
            });
            return mergedItem;
        }
    });
    matchTranslations({
        ...commonOptions,
        name: "entity",
        originalArray: removeMinecraftNamespace(enums.entities),
        translationMap: userTranslation.entity,
        stdTransMap: cascadeMap(standardizedTranslation, ["EntitySprite", "ItemSprite"], true),
        langKeyPrefix: "entity.",
        langKeySuffix: ".name",
        postProcessor(entity) {
            let mergedEntity = {};
            enums.entities.forEach(key => {
                if (key in entity) {
                    JSON.assign(mergedEntity, entity, [key]);
                } else {
                    mergedEntity[key] = entity["minecraft:" + key];
                }
            });
            return mergedEntity;
        }
    });
    matchTranslations({
        ...commonOptions,
        name: "effect",
        originalArray: enums.effects,
        translationMap: userTranslation.effect,
        stdTransMap: cascadeMap(standardizedTranslation, ["EffectSprite"], true)
    });
    matchTranslations({
        ...commonOptions,
        name: "enchant",
        originalArray: enums.enchantments,
        translationMap: userTranslation.enchant
    });
    matchTranslations({
        ...commonOptions,
        name: "fog",
        originalArray: enums.fogs,
        translationMap: userTranslation.fog,
        stdTransMap: cascadeMap(standardizedTranslation, ["BiomeSprite"], true)
    });
    matchTranslations({
        ...commonOptions,
        name: "location",
        originalArray: enums.locations,
        translationMap: userTranslation.location,
        stdTransMap: cascadeMap(standardizedTranslation, ["EnvSprite"], true)
    });
    matchTranslations({
        ...commonOptions,
        name: "entityEvent",
        originalArray: Object.keys(enums.entityEventsMap),
        translationMap: userTranslation.entityEvent,
        stdTransMap: cascadeMap(standardizedTranslation, ["EntitySprite", "ItemSprite"], true),
        postProcessor(entityEvent) {
            forEachObject(entityEvent, (value, key) => {
                if (value) return;
                let comment = `from: ${enums.entityEventsMap[key].join(", ")}`;
                setInlineCommentAfterField(userTranslation.entityEvent, key, comment);
            });
        }
    });
    matchTranslations({
        ...commonOptions,
        name: "entityFamily",
        originalArray: Object.keys(enums.entityFamilyMap),
        translationMap: userTranslation.entityFamily,
        stdTransMap: cascadeMap(standardizedTranslation, ["EntitySprite", "ItemSprite"], true),
        postProcessor(entityFamily) {
            forEachObject(entityFamily, (value, key) => {
                if (value) return;
                let comment = `from: ${enums.entityFamilyMap[key].join(", ")}`;
                setInlineCommentAfterField(userTranslation.entityFamily, key, comment);
            });
        }
    });
    matchTranslations({
        ...commonOptions,
        name: "animation",
        originalArray: enums.animations,
        translationMap: userTranslation.animation,
        stdTransMap: cascadeMap(standardizedTranslation, ["EntitySprite", "ItemSprite"], true)
    });
    matchTranslations({
        ...commonOptions,
        name: "particleEmitter",
        originalArray: enums.particleEmitters,
        translationMap: userTranslation.particleEmitter,
        autoMatch: false
    });
    matchTranslations({
        ...commonOptions,
        name: "sound",
        originalArray: enums.sounds,
        translationMap: userTranslation.sound
    });
    if (testMinecraftVersionInRange(packageDataEnums.version, "1.18.0.21", "*")) {
        matchTranslations({
            ...commonOptions,
            name: "lootTable",
            originalArray: enums.lootTables,
            translationMap: userTranslation.lootTable
        });
        let nameWrapped = {};
        forEachObject(translationResultMaps.lootTable, (value, key) => {
            let wrappedKey = JSON.stringify(key);
            if (key.includes("/")) {
                nameWrapped[wrappedKey] = value;
            } else {
                nameWrapped[wrappedKey] = value;
                nameWrapped[key] = value;
            }
        });
        translationResultMaps.lootTableWrapped = nameWrapped;
    } else {
        translationResultMaps.lootTable = {};
        translationResultMaps.lootTableWrapped = {};
    }
    translationResultMaps.music = filterObjectMap(translationResultMaps.sound, key => key.startsWith("music.") || key.startsWith("record."));
    translationResultMaps.summonableEntity = filterObjectMap(translationResultMaps.entity, key => enums.summonableEntities.includes(key));
    if (enums.lootTool) {
        translationResultMaps.lootTool = keyArrayToObject(enums.lootTools, k => {
            if (k.startsWith("minecraft:")) k = k.slice("minecraft:".length);
            if (k in translationResultMaps.item) {
                return translationResultMaps.item[k];
            } else {
                return "";
            }
        });
    } else {
        translationResultMaps.lootTool = {};
    }

    console.log("Exporting files...");
    cachedOutput("output." + branch + ".translation.state", translationStateMaps);
    let renamedTranslationResultMaps = replaceObjectKey(translationResultMaps, [
        [/[A-Z]/g, (match, offset) => (offset > 0 ? "_" : "") + match.toLowerCase()], // camelCase -> snake_case
        ["enchant", "enchant_type"],
        ["location", "structure"]
    ]);
    fs.writeFileSync(nodePath.resolve(__dirname, "output", "output." + branch + ".ids.json"), JSON.stringify({
        name: "ID表补丁包（" + branchName[branch] + "）",
        author: "CA制作组",
        description: "该命令库将旧ID表替换为更新的版本。",
        uuid: "4b2612c7-3d53-46b5-9b0c-dd1f447d3ee7",
        version: [0, 0, 1],
        require: [],
        minSupportVer: "0.7.4",
        targetSupportVer: packageDataEnums.version,
        mode: "overwrite",
        enums: renamedTranslationResultMaps
    }, null, "\t"));
    writeTransMapsExcel(
        nodePath.resolve(__dirname, "output", "output." + branch + ".ids.xlsx"),
        translationResultMaps
    );
    writeTransMapTextZip({
        outputZip: nodePath.resolve(__dirname, "output", "output." + branch + ".ids.zip"),
        outputJson: nodePath.resolve(__dirname, "output", "output." + branch + ".all.json"),
        branchName: branchName[branch],
        version: packageDataEnums.version,
        originalEnums: enums,
        transMaps: translationResultMaps,
        transMapNames: defaultTransMapNames
        // stdTransMap: standardizedTranslation,
        // stdTransMapNames
    });
    saveUserTranslation(userTranslation);
}

async function generateTranslatorHelperFiles() {
    let packageDataEnums = analyzePackageDataEnumsCached();
    let standardizedTranslation = await fetchStandardizedTranslation();
    let bedrockEditionLang = packageDataEnums.lang;
    let javaEditionLang = await fetchJavaEditionLangData();
    writeTransMapTextZip({
        outputZip: nodePath.resolve(__dirname, "output", "output.translator.ids.zip"),
        outputJson: nodePath.resolve(__dirname, "output", "output.translator.all.json"),
        branchName: "翻译专用",
        version: packageDataEnums.version,
        transMaps: {
            ...standardizedTranslation,
            BedrockEditionLang: bedrockEditionLang,
            JavaEditionLang: javaEditionLang
        },
        transMapNames: [
            ...stdTransMapNames,
            [ "BedrockEditionLang", "基岩版语言文件" ],
            [ "JavaEditionLang", "Java版语言文件" ]
        ]
    });
}

async function main() {
    console.log("Generating output files for vanilla...");
    await generateOutputFiles("vanilla");
    console.log("Generating output files for education...");
    await generateOutputFiles("education");
    console.log("Generating output files for experiment...");
    await generateOutputFiles("experiment");
    console.log("Generating output files for translator...");
    await generateTranslatorHelperFiles();
}

main().catch(err => {
    console.error(err);
    debugger;
}).finally(() => process.exit(0));