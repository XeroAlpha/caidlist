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

function forEachObject(object, f, thisArg) {
    Object.keys(object).forEach(key => f.call(thisArg, object[key], key, object));
}

function replaceObjectKey(object, replaceArgsGroups) {
    let newObject = {};
    forEachObject(object, (value, key) => {
        let replacedKey = replaceArgsGroups.reduce((prev, args) => prev.replace(...args), key);
        newObject[replacedKey] = value;
    });
    return newObject;
}

function compareMinecraftVersion(a, b) {
    const asVersionArray = str => str.split(".").map(e => parseInt(e)).map(e => isNaN(e) ? 0 : e);
    const aver = asVersionArray(a), bver = asVersionArray(b);
    let i, minLength = Math.min(aver.length, bver.length);
    for (i = 0; i < minLength; i++) {
        if (aver[i] == bver[i]) continue;
        return aver[i] - bver[i];
    }
    return aver.length - bver.length;
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
const adb = require("adbkit");
const sharp = require("sharp");
const tesseract = require("node-tesseract-ocr");
const tesseractMistakes = require("./tesseract_mistakes.json");

async function adbShell(adbClient, deviceSerial, command) {
    let stream = await adbClient.shell(deviceSerial, command);
    return await adb.util.readAll(stream);
}

async function getDeviceSurfaceOrientation(adbClient, deviceSerial) {
    let output = await adbShell(adbClient, deviceSerial, "dumpsys input | grep SurfaceOrientation | awk '{print $2}' | head -n 1");
    return parseInt(output.toString().trim());
}

async function getAnyOnlineDevice(adbClient) {
    let devices = await adbClient.listDevices();
    let onlineDevices = devices.filter(device => device.type != "offline");
    if (onlineDevices.length != 0) {
        return onlineDevices[0].id;
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
                    resolve(checkingDevices[0].id);
                    tracker.end();
                }
            });
            tracker.on("error", err => reject(err));
        });
    } else {
        return onlineDevice;
    }
}

async function captureScreen(adbClient, deviceSerial) {
    let screenshotPngStream = await adbClient.screencap(deviceSerial);
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

async function recogizeCommandRemote(adbClient, deviceSerial, surfaceOrientation) {
    return await recogizeCommand(await captureScreen(adbClient, deviceSerial), surfaceOrientation);
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

async function analyzeCommandAutocompletion(adbClient, deviceSerial, command, progressName, approxLength) {
    // 初始状态：游戏HUD
    let autocompletions = [];
    let surfaceOrientation = await getDeviceSurfaceOrientation(adbClient, deviceSerial);

    await checkPause(10, "Press <Enter> to continue");
    
    // 打开聊天栏
    await adbShell(adbClient, deviceSerial, "input keyevent 48"); // KEYCODE_T

    console.log(`Starting ${progressName}: ${command}`);
    await adbShell(adbClient, deviceSerial, "input text " + JSON.stringify(command));

    let autocompletedCommand = command.trim();
    let recogizedCommand = autocompletedCommand;
    await retryUntilComplete(3, 0, async () => {
        let command = await recogizeCommandRemote(adbClient, deviceSerial, surfaceOrientation);
        return command == autocompletedCommand;
    });
    let timeStart = Date.now(), stepCount = 0;
    while(true) {
        await adbShell(adbClient, deviceSerial, "input keyevent 61"); // KEYCODE_TAB
        recogizedCommand = await retryUntilComplete(3, 0, async () => {
            let command = await recogizeCommandRemote(adbClient, deviceSerial, surfaceOrientation);
            return recogizedCommand != command ? command : null;
        });

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
    await adbShell(adbClient, deviceSerial, "input keyevent 111"); // KEYCODE_ESCAPE
    await adbShell(adbClient, deviceSerial, "input keyevent 111"); // KEYCODE_ESCAPE

    return autocompletions;
}

async function analyzeAutocompletionEnumCached(options, name, commandPrefix, exclusion) {
    const {
        adbClient, deviceSerial,
        branch, version, target
    } = options;
    const id = name.replace(/\s+(\S)/g, (_, ch) => ch.toUpperCase());
    const cacheId = `autocompleted.${branch}.${name.replace(/\s+/g, "_")}`;
    let cache = cachedOutput(cacheId), result;

    if (Array.isArray(cache)) cache = { result: cache, length: cache.length };
    if (cache && version == cache.version) result = cache.result;
    if (!result) {
        let progressName = `${branch}.${name.replace(/\s+/g, "_")}`;
        result = await analyzeCommandAutocompletion(adbClient, deviceSerial, commandPrefix, progressName, cache && cache.length);
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
    let deviceSerial = await getAnyOnlineDevice(adbClient);
    if (!deviceSerial) {
        console.log("Please plug in the device...");
        deviceSerial = await waitForAnyDevice(adbClient);
    }

    console.log("Please switch to branch: " + branch);
    await pause("Press <Enter> if the device is ready");
    const target = { version };
    const options = {
        adbClient, deviceSerial,
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

function analyzeApkPackageDataEnums(packageZip) {
    let entries = packageZip.getEntries();

    let sounds = [],
        particleEmitters = [],
        animations = [],
        fogs = [],
        entityEventsMap = {},
        entityFamilyMap = {},
        lang = {};
    console.log("Analyzing package entries...");
    entries.forEach(entry => {
        let entryName = entry.entryName;
        if (!entryName.includes("vanilla")) return;
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
                    let groupId = componentName ? `${id}/${componentName}` : id;
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
        } else if (entryName.match(/^assets\/resource_packs\/(?:[^\/]+)\/texts\/zh_CN\.lang$/)) {
            parseMinecraftLang(lang, entry.getData().toString("utf-8"));
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
        data: {
            sounds,
            particleEmitters,
            animations,
            fogs,
            entityEventsMap,
            entityFamilyMap
        },
        lang: lang
    };
}

const apksInstallPack = [
    "install_pack.apk",
    "split_install_pack.apk",
    "com.mojang.minecraftpe.apk",
    "base.apk"
];
function analyzePackageDataEnums() {
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
        return analyzeApkPackageDataEnums(new AdmZip(installPackApk));
    } else {
        return analyzeApkPackageDataEnums(new AdmZip(packagePath));
    }
}

function analyzePackageDataEnumsCached() {
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
        let result = analyzePackageDataEnums();
        return {
            data: cachedOutput("package.data", result.data),
            lang: cachedOutput("package.lang", result.lang),
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

function parseEnumMapLua(luaContent) {
    let enumMapStack = [{}];
    let itemRegExp = /\['(.*)'\](?:\s*)=(?:\s*)'(.*)'/,
        groupStartRegExp = /\['(.*)'\](?:\s*)=(?:\s*){/,
        groupEndRegExp = /\}(?:,)?/;
    luaContent.split("\n")
        .forEach(line => {
            line = line.trim();
            if (line.startsWith("--")) return;
            let matchResult;
            if (matchResult = itemRegExp.exec(line)) {
                let key = matchResult[1].replace(/\\/g, ""); // 处理 Lua 字符串转义
                let value = matchResult[2].split("|").slice(-1)[0];
                enumMapStack[0][key] = value;
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

async function fetchStandardizedTranslation() {
    return cachedOutput("wiki.standardized_translation", async () => {
        console.log("Fetching standardized translation for blocks...");
        let block = parseEnumMapLua(await fetchMZHWikiRaw("模块:Autolink/Block"));
        console.log("Fetching standardized translation for items...");
        let item = parseEnumMapLua(await fetchMZHWikiRaw("模块:Autolink/Item"));
        console.log("Fetching standardized translation for exclusive things...");
        let exclusive = parseEnumMapLua(await fetchMZHWikiRaw("模块:Autolink/Exclusive"));
        console.log("Fetching standardized translation for others...");
        let other = parseEnumMapLua(await fetchMZHWikiRaw("模块:Autolink/Other"));
        return extendEnumMap({
            BlockSprite: block,
            ItemSprite: item,
            Exclusive: exclusive,
            ...other
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

function fetchJavaEditionLangData() {
    return cachedOutput("java.package.lang", async () => {
        const metaApiHost = "https://launchermeta.mojang.com";
        const assetApiHost = "https://resources.download.minecraft.net";
        console.log("Fetching Java Edition language data...");
        let manifest = await fetchVersionsManifest(metaApiHost);
        let versionMeta = await fetchVersionMeta(metaApiHost, manifest, "latest_snapshot");
        let assetIndex = await fetchVersionAssetIndex(metaApiHost, versionMeta);
        let langAsset = await fetchVersionAsset(assetApiHost, assetIndex, "minecraft/lang/zh_cn.json");
        return JSON.parse(langAsset.toString());
    });
}
//#endregion

//#region Translate Match
const util = require("util");
function filterObjectMap(map, predicate) {
    return JSON.assign({}, map, Object.keys(map).filter(key => predicate(key, map[key], map)));
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
    location: "translation.location"
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

async function main() {
    let packageDataEnums = analyzePackageDataEnumsCached();
    let autocompletedEnums = await analyzeAutocompletionEnumsCached(packageDataEnums.packageType, packageDataEnums.version);
    let enums = {
        ...packageDataEnums.data,
        ...autocompletedEnums.vanilla
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
    translationResultMaps.music = filterObjectMap(translationResultMaps.sound, key => key.startsWith("music.") || key.startsWith("record."));
    translationResultMaps.summonableEntity = filterObjectMap(translationResultMaps.entity, key => enums.summonableEntities.includes(key));

    console.log("Exporting command library...");
    cachedOutput("output.translation.state", translationStateMaps);
    let renamedTranslationResultMaps = replaceObjectKey(translationResultMaps, [
        [/[A-Z]/g, (match, offset) => (offset > 0 ? "_" : "") + match.toLowerCase()], // camelCase -> snake_case
        ["enchant", "enchant_type"],
        ["location", "structure"]
    ]);
    fs.writeFileSync(nodePath.resolve(__dirname, "output", "output.ids.json"), JSON.stringify({
        name: "ID表补丁包",
        author: "CA制作组",
        description: "该命令库将旧ID表替换为更新的版本。",
        uuid: "4b2612c7-3d53-46b5-9b0c-dd1f447d3ee7",
        version: [0, 0, 1],
        require: ["acf728c5-dd5d-4a38-b43d-7c4f18149fbd", "590cdcb5-3cdf-42fa-902c-b578779335ab"],
        minSupportVer: "0.7.4",
        targetSupportVer: packageDataEnums.version,
        mode: "overwrite",
        enums: renamedTranslationResultMaps
    }, null, "\t"));
    writeTransMapsExcel(nodePath.resolve(__dirname, "output", "output.ids.xlsx"), translationResultMaps);
    saveUserTranslation(userTranslation);
}

main().catch(err => {
    console.error(err);
    debugger;
}).finally(() => process.exit(0));