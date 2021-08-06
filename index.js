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
 * 4. cachedOutput(id, () => any) => Promise resolves cache ?? any
 *    cache = cache ?? valueOrProcessor()
 * 
 * 5. cachedOutput(id, () => Promise.resolve(any)) => Promise resolves cache ?? any
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
//#endregion

//#region Autocompletion related
const adb = require("adbkit");
const sharp = require("sharp");
const tesseract = require("node-tesseract-ocr");
const tesseractMistakes = require("./tesseract_mistakes.json");
async function getDeviceSurfaceOrientation(adbClient, deviceSerial) {
    let stream = await adbClient.shell(deviceSerial, "dumpsys input | grep SurfaceOrientation | awk '{print $2}' | head -n 1");
    let output = await adb.util.readAll(stream);
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

async function recogizeCommand(adbClient, deviceSerial) {
    let screenshotPngStream = await adbClient.screencap(deviceSerial);
    let screenshotPng = await adb.util.readAll(screenshotPngStream);
    let img = sharp(screenshotPng);
    img.removeAlpha()
        .extract({
            left: config.commandAreaRect[0],
            top: config.commandAreaRect[1],
            width: config.commandAreaRect[2],
            height: config.commandAreaRect[3]
        })
        .negate()
        .threshold(10);
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

async function analyzeCommandAutocompletion(adbClient, deviceSerial, command) {
    // 初始状态：聊天栏
    let autocompletions = [];

    console.log("Please reset the command box");
    await input();

    console.log("Entering " + command);
    await adbClient.shell(deviceSerial, "input text " + JSON.stringify(command));

    let autocompletedCommand = command.trim();
    let recogizedCommand = autocompletedCommand;
    await retryUntilComplete(100, 50, async () => {
        let command = await recogizeCommand(adbClient, deviceSerial);
        return command == autocompletedCommand;
    });
    await sleepAsync(500);
    while(true) {
        await adbClient.shell(deviceSerial, "input keyevent 61"); // Tab
        recogizedCommand = await retryUntilComplete(100, 50, async () => {
            let command = await recogizeCommand(adbClient, deviceSerial);
            return recogizedCommand != command ? command : null;
        });

        autocompletedCommand = guessTruncatedString(recogizedCommand, command);
        if (!autocompletedCommand) {
            throw new Error("Auto-completed command test failed: " + recogizedCommand);
        }

        let autocompletion = autocompletedCommand.slice(command.length);
        if (autocompletions.includes(autocompletion)) {
            console.log("Loop autocompletion detected: " + autocompletion);
            break;
        } else {
            console.log("Autocompletion detected: " + recogizedCommand);
            autocompletions.push(autocompletion);
        }
    }
    return autocompletions;
}

async function analyzeAutocompletionEnums() {
	console.log("Connecting ADB host...");
	let adbClient = adb.createClient();
    console.log("Connecting to device...");
    let deviceSerial = await getAnyOnlineDevice(adbClient);
    if (!deviceSerial) {
        console.log("Please plug in the device...");
        deviceSerial = await waitForAnyDevice(adbClient);
    }

    let surfaceOrientation = await getDeviceSurfaceOrientation(adbClient, deviceSerial);
    if (surfaceOrientation != config.surfaceOrientation) {
        throw new Error("Wrong screen orientation: " + surfaceOrientation);
    }

    console.log("Analyzing blocks...");
    let blocks = await cachedOutput("autocompleted.blocks", async () => {
        return await analyzeCommandAutocompletion(adbClient, deviceSerial, "/testforblock ~ ~ ~ ");
    });

    console.log("Analyzing items...");
    let items = await cachedOutput("autocompleted.items", async () => {
        return (await analyzeCommandAutocompletion(adbClient, deviceSerial, "/clear @s "))
            .filter(item => item != "[");
    });

    let entityNamespaceProcessor = entities => {
        return entities.map((entity, _, allEntities) => {
            if (!entity.includes(":")) {
                let entityNameWithNamespace = "minecraft:" + entity;
                if (allEntities.includes(entityNameWithNamespace)) {
                    return null;
                }
            }
            return entity;
        }).filter(entity => entity != null);
    };
    console.log("Analyzing entities...");
    let entities = await cachedOutput("autocompleted.entities", async () => {
        return entityNamespaceProcessor(
            (await analyzeCommandAutocompletion(adbClient, deviceSerial, "/testfor @e[type="))
                .filter(entity => entity != "!")
        );
    });

    console.log("Analyzing summonable entities...");
    let summonableEntities = await cachedOutput("autocompleted.summonable_entities", async () => {
        return entityNamespaceProcessor(
            await analyzeCommandAutocompletion(adbClient, deviceSerial, "/summon ")
        );
    });

    console.log("Analyzing effects...");
    let effects = await cachedOutput("autocompleted.effects", async () => {
        return (await analyzeCommandAutocompletion(adbClient, deviceSerial, "/effect @s "))
            .filter(effect => effect != "[");
    });

    console.log("Analyzing enchantments...");
    let enchantments = await cachedOutput("autocompleted.enchantments", async () => {
        return (await analyzeCommandAutocompletion(adbClient, deviceSerial, "/enchant @s "))
            .filter(enchantment => enchantment != "[");
    });

    console.log("Analyzing gamerules...");
    let gamerules = await cachedOutput("autocompleted.gamerules", async () => {
        return await analyzeCommandAutocompletion(adbClient, deviceSerial, "/gamerule ");
    });

    console.log("Analyzing locations...");
    let locations = await cachedOutput("autocompleted.locations", async () => {
        return await analyzeCommandAutocompletion(adbClient, deviceSerial, "/locate ");
    });

    console.log("Analyzing mobevents...");
    let mobevents = await cachedOutput("autocompleted.mobevents", async () => {
        return await analyzeCommandAutocompletion(adbClient, deviceSerial, "/mobevent ");
    });

    return {
        blocks,
        items,
        entities,
        summonableEntities,
        effects,
        enchantments,
        gamerules,
        locations,
        mobevents
    };
}

async function analyzeAutocompletionEnumsCached() {
    return cachedOutput("autocompleted", async () => {
        return await analyzeAutocompletionEnums();
    });
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
        entityEventsMap = {},
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
                let owner = entity["minecraft:entity"]["description"]["identifier"];
                let events = Object.keys(entity["minecraft:entity"]["events"] ?? {});
                events.forEach(event => {
                    let eventOwners = entityEventsMap[event];
                    if (!eventOwners) eventOwners = entityEventsMap[event] = [];
                    eventOwners.push(owner);
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
    Object.keys(entityEventsMap).forEach(key => {
        entityEventsMap[key] = entityEventsMap[key].filter((e, i, a) => a.indexOf(e) >= i).sort();
    });

    cachedOutput("package.data", {
        sounds,
        particleEmitters,
        animations,
        entityEventsMap
    });
    cachedOutput("package.lang", lang);

    return {
        data: {
            sounds,
            particleEmitters,
            animations,
            entityEventsMap
        },
        lang,
        version: config.installPackageVersion
    };
}

function analyzePackageDataEnums() {
    let packagePath = config.installPackagePath;
    if (packagePath.endsWith(".apks")) {
        let packageZip = new AdmZip(packagePath);
        let installPackApkEntry = packageZip.getEntry("split_install_pack.apk");
        let installPackApk;
        console.log("Unpacking install pack...");
        if (installPackApkEntry) {
            installPackApk = packageZip.readFile(installPackApkEntry);
        } else {
            installPackApk = packageZip.readFile("base.apk");
        }
        return analyzeApkPackageDataEnums(new AdmZip(installPackApk));
    } else {
        return analyzeApkPackageDataEnums(new AdmZip(packagePath));
    }
}
//#endregion

//#region Wiki Data Extract
const got = require("got");
async function fetchWikiRawChinese(word) {
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
                enumMapStack[0][matchResult[1]] = matchResult[2].split("|").slice(-1)[0];
            } else if (matchResult = groupStartRegExp.exec(line)) {
                let group = {};
                enumMapStack[0][matchResult[1]] = group;
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
        let block = parseEnumMapLua(await fetchWikiRawChinese("模块:Autolink/Block"));
        console.log("Fetching standardized translation for items...");
        let item = parseEnumMapLua(await fetchWikiRawChinese("模块:Autolink/Item"));
        console.log("Fetching standardized translation for exclusive things...");
        let exclusive = parseEnumMapLua(await fetchWikiRawChinese("模块:Autolink/Exclusive"));
        console.log("Fetching standardized translation for others...");
        let other = parseEnumMapLua(await fetchWikiRawChinese("模块:Autolink/Other"));
        return extendEnumMap({
            BlockSprite: block,
            ItemSprite: item,
            Exclusive: exclusive,
            ...other
        });
    });
}
//#endregion

//#region Translate Match
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
    return template.replace(/\{\{([^}]+?)\}\}/g, (_, templateName) => {
        return getter(templateName);
    });
}

function matchTranslation(options) {
    const {
        originalValue,
        translationMap,
        stdTransMap,
        langMap,
        langKeyPrefix,
        langKeySuffix,
        translateCached
    } = options;
    let userTranslation = translationMap[originalValue];
    let stdTranslationKey = originalValue.replace(/^minecraft:/i, "").replace(/_/g, " ");
    let stdTranslation;
    if (stdTransMap) {
        if (userTranslation) {
            if (userTranslation.startsWith("ST: ")) { // 标准化译名模板
                userTranslation = stdTransMap[userTranslation.slice(4)];
                if (!userTranslation) {
                    console.warn("Incorrect STRef: " + originalValue);
                }
                setInlineCommentAfterField(translationMap, originalValue, userTranslation);
            } else if (userTranslation.includes("{{") && userTranslation.includes("}}")) { // 拼接模板
                userTranslation = runTemplate(userTranslation, key => {
                    if (key.startsWith("#")) {
                        key = originalValue + "." + key.slice(1);
                    }
                    return translateCached(key);
                });
                setInlineCommentAfterField(translationMap, originalValue, userTranslation);
            }
        }
        stdTranslation = stdTransMap[stdTranslationKey];
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
    if (stdTranslation) {
        translationMap[originalValue] = "ST: " + stdTranslationKey;
        setInlineCommentAfterField(translationMap, originalValue, `${stdTranslation}`);
        return {
            state: "provided",
            translation: stdTranslation,
            comment: null
        };
    }
    if (langMap) {
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
    translationMap[originalValue] = "";
    setInlineCommentAfterField(translationMap, originalValue, null);
    return {
        state: "notFound",
        translation: "",
        comment: null
    };
}

function matchTranslations(options) {
    const { originalArray } = options;
    let translateResultMap = {};
    let translateStates = {
        provided: [],
        guessFromStd: [],
        guessFromLang: [],
        notFound: []
    };
    let translate = (originalValue) => {
        let result = matchTranslation({
            ...options,
            translateCached,
            originalValue
        });
        translateStates[result.state].push(originalValue);
        translateResultMap[originalValue] = result.translation;
        setInlineCommentAfterField(translateResultMap, originalValue, result.comment);
        return result.translation;
    };
    let translateCached = (originalValue) => {
        let cache = translateResultMap[originalValue];
        if (cache) {
            return cache;
        } else {
            translateResultMap[originalValue] = "<Circular>";
            return translate(originalValue);
        }
    };
    originalArray.forEach(translateCached);
    return {
        states: translateStates,
        result: translateResultMap
    };
}
//#endregion

//#region User Translation
function loadUserTranslation() {
    const initialValue = () => new Object();
    return {
        block: cachedOutput("translation.block", initialValue),
        item: cachedOutput("translation.item", initialValue),
        sound: cachedOutput("translation.sound", initialValue),
        entity: cachedOutput("translation.entity", initialValue),
        entityEvent: cachedOutput("translation.entity_event", initialValue),
        particleEmitter: cachedOutput("translation.particle_emitter", initialValue),
        animation: cachedOutput("translation.animation", initialValue),
        effect: cachedOutput("translation.effect", initialValue),
        enchant: cachedOutput("translation.enchant", initialValue),
        location: cachedOutput("translation.location", initialValue),
    };
}

function saveUserTranslation(userTranslation) {
    cachedOutput("translation.block", userTranslation.block);
    cachedOutput("translation.item", userTranslation.item);
    cachedOutput("translation.sound", userTranslation.sound);
    cachedOutput("translation.entity", userTranslation.entity);
    cachedOutput("translation.entity_event", userTranslation.entityEvent);
    cachedOutput("translation.particle_emitter", userTranslation.particleEmitter);
    cachedOutput("translation.animation", userTranslation.animation);
    cachedOutput("translation.effect", userTranslation.effect);
    cachedOutput("translation.enchant", userTranslation.enchant);
    cachedOutput("translation.location", userTranslation.location);
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
    let packageDataEnums = analyzePackageDataEnums();
    let autocompletedEnums = await analyzeAutocompletionEnumsCached();
    let enums = {
        ...packageDataEnums.data,
        ...autocompletedEnums
    };
    let lang = packageDataEnums.lang;
    let standardizedTranslation = await fetchStandardizedTranslation();
    let userTranslation = loadUserTranslation();
    console.log("Matching translations...");
    let block = matchTranslations({
        originalArray: enums.blocks,
        translationMap: userTranslation.block,
        stdTransMap: {
            ...standardizedTranslation["Exclusive"],
            ...standardizedTranslation["ItemSprite"],
            ...standardizedTranslation["BlockSprite"]
        },
        langMap: lang,
        langKeyPrefix: "tile.",
        langKeySuffix: ".name"
    });
    let item = matchTranslations({
        originalArray: enums.items.filter(item => !enums.blocks.includes(item)),
        translationMap: userTranslation.item,
        stdTransMap: {
            ...standardizedTranslation["Exclusive"],
            ...standardizedTranslation["BlockSprite"],
            ...standardizedTranslation["ItemSprite"]
        },
        langMap: lang,
        langKeyPrefix: "item.",
        langKeySuffix: ".name"
    });
    let sound = matchTranslations({
        originalArray: enums.sounds,
        translationMap: userTranslation.sound,
        stdTransMap: {
            ...standardizedTranslation["Exclusive"],
            ...standardizedTranslation["EntitySprite"]
        }
    });
    let entity = matchTranslations({
        originalArray: enums.entities,
        translationMap: userTranslation.entity,
        stdTransMap: {
            ...standardizedTranslation["Exclusive"],
            ...standardizedTranslation["EntitySprite"]
        },
        langMap: lang,
        langKeyPrefix: "entity.",
        langKeySuffix: ".name"
    });
    let entityEvent = matchTranslations({
        originalArray: Object.keys(enums.entityEventsMap),
        translationMap: userTranslation.entityEvent,
        stdTransMap: {
            ...standardizedTranslation["Exclusive"],
            ...standardizedTranslation["EntitySprite"]
        }
    });
    let particleEmitter = matchTranslations({
        originalArray: enums.particleEmitters,
        translationMap: userTranslation.particleEmitter
    });
    let animation = matchTranslations({
        originalArray: enums.animations,
        translationMap: userTranslation.animation,
        stdTransMap: {
            ...standardizedTranslation["Exclusive"],
            ...standardizedTranslation["EntitySprite"]
        }
    });
    let effect = matchTranslations({
        originalArray: enums.effects,
        translationMap: userTranslation.effect,
        stdTransMap: {
            ...standardizedTranslation["Exclusive"],
            ...standardizedTranslation["EffectSprite"]
        },
    });
    let enchant = matchTranslations({
        originalArray: enums.enchantments,
        translationMap: userTranslation.enchant
    });
    let location = matchTranslations({
        originalArray: enums.locations,
        translationMap: userTranslation.location
    });
    Object.keys(entityEvent.result).forEach(key => {
        let comment = `from: ${enums.entityEventsMap[key].join(", ")}`;
        setInlineCommentAfterField(userTranslation.entityEvent, key, comment);
    });
    let mergedItem = {};
    enums.items.forEach(key => {
        if (key in block.result) {
            JSON.assign(mergedItem, block.result, [key]);
        } else {
            JSON.assign(mergedItem, item.result, [key]);
        }
    });
    let music = filterObjectMap(sound.result, key => key.startsWith("music.") || key.startsWith("record."));
    let summonableEntity = filterObjectMap(entity.result, key => enums.summonableEntities.includes(key));
    console.log("Exporting command library...");
    cachedOutput("output.translation.state", {
        block: block.states,
        item: item.states,
        sound: sound.states,
        entity: entity.states,
        entityEvent: entityEvent.states,
        particleEmitter: particleEmitter.states,
        animation: animation.states,
        effect: effect.states,
        enchant: enchant.states,
        location: location.states
    });
    let translationMaps = {
        block: block.result,
        item: mergedItem,
        sound: sound.result,
        music: music,
        entity: entity.result,
        summonable_entity: summonableEntity,
        entity_event: entityEvent.result,
        particle_emitter: particleEmitter.result,
        animation: animation.result,
        effect: effect.result,
        enchant_type: enchant.result,
        structure: location.result
    };
    cachedOutput("output.ids", {
        name: "ID表补丁包",
        author: "CA制作组",
        description: "该命令库将旧ID表替换为更新的版本。",
        uuid: "4b2612c7-3d53-46b5-9b0c-dd1f447d3ee7",
        version: [0, 0, 1],
        require: [],
        minSupportVer: "0.7.4",
        targetSupportVer: packageDataEnums.version,
        mode: "overwrite",
        enums: translationMaps
    });
    writeTransMapsExcel(nodePath.resolve(__dirname, "output", "ids.xlsx"), translationMaps);
    saveUserTranslation(userTranslation);
}

main().catch(err => {
    console.error(err);
    debugger;
}).finally(() => process.exit(0));