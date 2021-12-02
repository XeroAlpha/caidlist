const AdmZip = require("adm-zip");
const JSON = require("comment-json");
const {
    cachedOutput,
    forEachObject
} = require("../util/common");

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
function extractInstallPack(packagePath) {
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

function analyzePackageDataEnumsCached(packageInfo) {
    let dataCache = cachedOutput("package.data");
    let langCache = cachedOutput("package.lang");
    let infoCache = cachedOutput("package.info");
    if (dataCache && langCache && infoCache && infoCache.packagePath == packageInfo.path) {
        return {
            data: dataCache,
            lang: langCache,
            version: infoCache.version,
            packageType: infoCache.type
        };
    } else {
        let installPack = extractInstallPack(packageInfo.path);
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
                version: packageInfo.version,
                type: packageInfo.type,
                packagePath: packageInfo.path
            })
        };
    }
}

module.exports = {
    analyzePackageDataEnumsCached
};