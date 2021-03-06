const AdmZip = require("adm-zip");
const JSON = require("comment-json");
const {
    cachedOutput,
    forEachObject,
    filterObjectMap,
    compareMinecraftVersion,
    uniqueAndSort
} = require("../util/common");

function parseMinecraftLang(target, langContent) {
    langContent.split(/(?:\n|\r)+/).forEach((line) => {
        let lineEnd, equPos;
        line = line.trimStart();
        lineEnd = line.indexOf("\t");
        if (lineEnd >= 0) line = line.slice(0, lineEnd);
        lineEnd = line.indexOf("##");
        if (lineEnd >= 0) line = line.slice(0, lineEnd);
        equPos = line.indexOf("=");
        if (equPos > 0 && equPos < line.length - 1) {
            target[line.slice(0, equPos)] = line.slice(equPos + 1);
        }
    });
}

function analyzeApkPackageLang(packageZip) {
    const entries = packageZip.getEntries();
    const langZh = {};
    const langEn = {};
    console.log("Analyzing package entries for language file...");
    entries.forEach((entry) => {
        const entryName = entry.entryName;
        if (entryName.match(/^assets\/resource_packs\/(?:[^\/]+)\/texts\/zh_CN\.lang$/)) {
            parseMinecraftLang(langZh, entry.getData().toString("utf-8"));
        }
        if (entryName.match(/^assets\/resource_packs\/(?:[^\/]+)\/texts\/en_US\.lang$/)) {
            parseMinecraftLang(langEn, entry.getData().toString("utf-8"));
        }
    });
    return {
        zh_cn: langZh,
        en_us: langEn
    };
}

const branchEntryNameKeywords = {
    vanilla: ["assets/definitions/", "vanilla", "~gametest"],
    education: ["assets/definitions/", "vanilla", "chemistry", "education"],
    experiment: ["assets/definitions/", "vanilla", "experiment", "test"]
};
const entryAnalyzer = [
    {
        name: "soundDefinition",
        type: "json",
        regex: /^assets\/resource_packs\/(?:[^\/]+)\/sounds\/sound_definitions\.json$/,
        analyze(results, entryName, soundDefinition) {
            const { sounds } = results;
            const formatVersion = soundDefinition["format_version"];
            if (formatVersion == "1.14.0") {
                sounds.push(...Object.keys(soundDefinition["sound_definitions"]));
            } else if (!formatVersion) {
                sounds.push(...Object.keys(soundDefinition));
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        }
    },
    {
        name: "particle",
        type: "json",
        regex: /^assets\/resource_packs\/(?:[^\/]+)\/particles\/(?:[^\/]+)\.json$/,
        analyze(results, entryName, particle) {
            const { particleEmitters } = results;
            const formatVersion = particle["format_version"];
            if (formatVersion == "1.10.0") {
                particleEmitters.push(particle["particle_effect"]["description"]["identifier"]);
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        }
    },
    {
        name: "entityDefinition",
        type: "json",
        regex: /^assets\/resource_packs\/(?:[^\/]+)\/entity\/(?:[^\/]+)\.json$/,
        analyze(results, entryName, clientEntity) {
            const { entityDefinitionMap } = results.internal;
            const formatVersion = clientEntity["format_version"];
            if (this.versionsGroups[0].includes(formatVersion)) {
                const entityDescription = clientEntity["minecraft:client_entity"]["description"];
                const id = entityDescription["identifier"];
                const minEngineVersion = entityDescription["min_engine_version"] || "0";
                const defData = {
                    minEngineVersion,
                    geometry: entityDescription["geometry"] || {},
                    animationRefs: entityDescription["animations"] || {},
                    animationControllers: entityDescription["animation_controllers"] || [],
                    renderControllers: entityDescription["render_controllers"] || []
                };
                const existDefData = entityDefinitionMap[id];
                if (!existDefData) {
                    entityDefinitionMap[id] = defData;
                } else {
                    if (compareMinecraftVersion(minEngineVersion, existDefData.minEngineVersion) > 0) {
                        entityDefinitionMap[id] = defData;
                    }
                }
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        },
        versionsGroups: [["1.8.0", "1.10.0"]]
    },
    {
        name: "geometry",
        type: "json",
        regex: /^assets\/resource_packs\/(?:[^\/]+)\/models\/(?:[^]+)\.json$/,
        analyze(results, entryName, geometry) {
            const { geometryMap } = results;
            const formatVersion = geometry["format_version"];
            if (this.versionsGroups[0].includes(formatVersion)) {
                Object.keys(geometry).forEach((geometryId) => {
                    if (geometryId == "format_version") return;
                    const colonPos = geometryId.indexOf(":");
                    if (colonPos > 0) {
                        geometryId = geometryId.slice(0, colonPos);
                    }
                    geometryMap[geometryId] = [];
                });
            } else if (this.versionsGroups[1].includes(formatVersion)) {
                if (Array.isArray(geometry["minecraft:geometry"])) {
                    geometry["minecraft:geometry"].forEach((data) => {
                        geometryMap[data["description"]["identifier"]] = [];
                    });
                }
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        },
        versionsGroups: [
            [undefined, "1.8.0", "1.10.0"],
            ["1.12.0", "1.13.0", "1.14.0", "1.16.0"]
        ]
    },
    {
        name: "animation",
        type: "json",
        regex: /^assets\/resource_packs\/(?:[^\/]+)\/animations\/(?:[^\/]+)\.json$/,
        analyze(results, entryName, animations) {
            const { animationMap } = results;
            const formatVersion = animations["format_version"];
            if (formatVersion == "1.8.0" || formatVersion == "1.10.0") {
                Object.keys(animations["animations"]).forEach((animationId) => {
                    animationMap[animationId] = [];
                });
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        }
    },
    {
        name: "animationController",
        type: "json",
        regex: /^assets\/resource_packs\/(?:[^\/]+)\/animation_controllers\/(?:[^\/]+)\.json$/,
        analyze(results, entryName, animationControllers) {
            const { animationControllerMap } = results;
            const formatVersion = animationControllers["format_version"];
            if (formatVersion == "1.10.0") {
                Object.keys(animationControllers["animation_controllers"]).forEach((controllerId) => {
                    animationControllerMap[controllerId] = [];
                });
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        }
    },
    {
        name: "renderController",
        type: "json",
        regex: /^assets\/resource_packs\/(?:[^\/]+)\/render_controllers\/(?:[^\/]+)\.json$/,
        analyze(results, entryName, renderControllers) {
            const { renderControllerMap } = results;
            const formatVersion = renderControllers["format_version"];
            if (this.versionsGroups[0].includes(formatVersion)) {
                Object.keys(renderControllers["render_controllers"]).forEach((controllerId) => {
                    renderControllerMap[controllerId] = [];
                });
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        },
        versionsGroups: [["1.8.0", "1.10", "1.10.0"]]
    },
    {
        name: "fog",
        type: "json",
        regex: /^assets\/resource_packs\/(?:[^\/]+)\/fogs\/(?:[^\/]+)\.json$/,
        analyze(results, entryName, fog) {
            const { fogs } = results;
            const formatVersion = fog["format_version"];
            if (formatVersion == "1.16.100") {
                fogs.push(fog["minecraft:fog_settings"]["description"]["identifier"]);
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        }
    },
    {
        name: "entityBehavior",
        type: "json",
        regex: /^assets\/behavior_packs\/(?:[^\/]+)\/entities\/(?:[^\/]+)\.json$/,
        analyze(results, entryName, entity) {
            const { entityEventsMap, entityFamilyMap } = results;
            const formatVersion = entity["format_version"];
            if (this.versionsGroups[0].includes(formatVersion)) {
                const entityDescription = entity["minecraft:entity"]["description"];
                if (!entityDescription) return;
                const id = entityDescription["identifier"];
                const events = Object.keys(entity["minecraft:entity"]["events"] ?? {});
                const globalComponents = entity["minecraft:entity"]["components"] ?? {};
                const componentGroups = entity["minecraft:entity"]["component_groups"] ?? {};
                events.forEach((event) => {
                    let eventOwners = entityEventsMap[event];
                    if (!eventOwners) eventOwners = entityEventsMap[event] = [];
                    eventOwners.push(id);
                });
                [null, ...Object.keys(componentGroups)].forEach((componentName) => {
                    const groupId = componentName ? `${id}<${componentName}>` : id;
                    const components = componentName ? componentGroups[componentName] : globalComponents;
                    const typeFamilyObj = components["minecraft:type_family"]?.family ?? [];
                    const typeFamilies = JSON.CommentArray.isArray(typeFamilyObj) ? typeFamilyObj : [typeFamilyObj];
                    typeFamilies.forEach((familyName) => {
                        let familyMembers = entityFamilyMap[familyName];
                        if (!familyMembers) familyMembers = entityFamilyMap[familyName] = [];
                        familyMembers.push(groupId);
                    });
                });
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        },
        versionsGroups: [
            [
                "1.8.0",
                "1.10.0",
                "1.12.0",
                "1.13.0",
                "1.14.0",
                "1.15.0",
                "1.16.0",
                "1.16.100",
                "1.16.210",
                "1.17.10",
                "1.17.20",
                "1.18.10",
                "1.18.20",
                "1.18.30",
                "1.19.0"
            ]
        ]
    },
    {
        name: "lootTable",
        regex: /^assets\/behavior_packs\/(?:[^\/]+)\/loot_tables\/(.+)\.json$/,
        analyze(results, entryName) {
            const { lootTables } = results;
            const match = this.regex.exec(entryName);
            if (match) {
                lootTables.push(match[1]);
            }
        }
    },
    {
        name: "feature",
        type: "json",
        regexList: [
            /^assets\/definitions\/features\/(?:[^\/]+)\.json$/,
            /^assets\/behavior_packs\/(?:[^\/]+)\/features\/(.+)\.json$/
        ],
        analyze(results, entryName, feature) {
            const { features } = results;
            const formatVersion = feature["format_version"];
            if (this.versionsGroups[0].includes(formatVersion)) {
                forEachObject(feature, (v, k) => {
                    if (typeof v == "object") {
                        features.push(v["description"]["identifier"]);
                    }
                });
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        },
        versionsGroups: [["1.13.0", "1.14.0", "1.16.0", "1.16.100"]]
    },
    {
        name: "featureRule",
        type: "json",
        regexList: [
            /^assets\/definitions\/feature_rules\/(?:[^\/]+)\.json$/,
            /^assets\/behavior_packs\/(?:[^\/]+)\/feature_rules\/(.+)\.json$/
        ],
        analyze(results, entryName, featureRule) {
            const { featureRules } = results;
            const formatVersion = featureRule["format_version"];
            if (this.versionsGroups[0].includes(formatVersion)) {
                featureRules.push(featureRule["minecraft:feature_rules"]["description"]["identifier"]);
            } else {
                console.warn("Unknown format version: " + formatVersion + " - " + entryName);
            }
        },
        versionsGroups: [["1.13.0", "1.14.0", "1.16.0", "1.16.100"]]
    }
];
function analyzeApkPackageDataEnums(packageZip, branchId) {
    const entries = packageZip.getEntries();
    const entryNameKeywords = branchEntryNameKeywords[branchId] || [];
    const entryNameAllowKeywords = entryNameKeywords.filter(e => !e.startsWith("~"));
    const entryNameDenyKeywords = entryNameKeywords.filter(e => e.startsWith("~")).map(e => e.slice(1));
    const results = {
        internal: {
            entityDefinitionMap: {}
        },
        sounds: [],
        particleEmitters: [],
        fogs: [],
        lootTables: [],
        features: [],
        featureRules: [],
        geometryMap: {},
        animationMap: {},
        animationControllerMap: {},
        renderControllerMap: {},
        entityEventsMap: {},
        entityFamilyMap: {}
    };
    console.log("[" + branchId + "]Analyzing package entries for data enums...");
    entries.forEach((entry) => {
        const entryName = entry.entryName;
        const analyzer = entryAnalyzer.find((e) => {
            if (e.regex) {
                return e.regex.test(entryName);
            } else if (e.regexList) {
                return e.regexList.some((regex) => regex.test(entryName));
            } else if (e.filter) {
                return e.filter(entryName, entry);
            }
        });
        if (analyzer) {
            if (entryNameDenyKeywords.some((keyword) => entryName.includes(keyword))) return;
            if (entryNameAllowKeywords.every((keyword) => !entryName.includes(keyword))) return;
            let entryData = entry.getData();
            if (analyzer.type == "json") {
                entryData = JSON.parse(entryData.toString("utf8"));
            }
            try {
                analyzer.analyze(results, entryName, entryData);
            } catch (err) {
                console.error("Analyze Error: " + entryName);
                console.error(err);
            }
        }
    });
    forEachObject(results.internal.entityDefinitionMap, (definition, entityId) => {
        const { geometryMap, animationMap, animationControllerMap, renderControllerMap } = results;
        forEachObject(definition.geometry, (ref, action) => {
            if (!geometryMap[ref]) {
                geometryMap[ref] = [];
            }
            geometryMap[ref].push(`${entityId}<${action}>`);
        });
        forEachObject(definition.animationRefs, (ref, action) => {
            if (ref.startsWith("controller")) {
                if (!animationControllerMap[ref]) {
                    animationControllerMap[ref] = [];
                }
                animationControllerMap[ref].push(`${entityId}<${action}>`);
            } else {
                if (!animationMap[ref]) {
                    animationMap[ref] = [];
                }
                animationMap[ref].push(`${entityId}<${action}>`);
            }
        });
        definition.animationControllers.forEach((controllerGroup) => {
            forEachObject(controllerGroup, (ref, action) => {
                if (!animationControllerMap[ref]) {
                    animationControllerMap[ref] = [];
                }
                animationControllerMap[ref].push(`${entityId}<${action}>`);
            });
        });
        definition.renderControllers.forEach((renderController) => {
            if (!renderControllerMap[renderController]) {
                renderControllerMap[renderController] = [];
            }
            renderControllerMap[renderController].push(`${entityId}`);
        });
    });
    forEachObject(results, (v, k) => {
        if (k.endsWith("Map")) {
            forEachObject(v, (value) => {
                uniqueAndSort(value);
            });
        } else if (k != "internal") {
            uniqueAndSort(v);
        }
    });
    return filterObjectMap(results, (k) => k != "internal");
}

const apksInstallPack = ["install_pack.apk", "split_install_pack.apk", "com.mojang.minecraftpe.apk", "base.apk"];
function extractInstallPack(packagePath) {
    if (packagePath.endsWith(".apks")) {
        const packageZip = new AdmZip(packagePath);
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

function analyzePackageDataEnumsCached(cx) {
    const { version, packageInfo, packageVersion } = cx;
    const dataCache = cachedOutput(`version.${version}.package.data`);
    const langCache = cachedOutput(`version.${version}.package.lang`);
    const infoCache = cachedOutput(`version.${version}.package.info`);
    if (dataCache && langCache && infoCache && infoCache.packagePath == packageInfo.path) {
        return {
            data: dataCache,
            lang: langCache,
            packageVersion: infoCache.version,
            packageType: infoCache.type,
            packagePath: packageInfo.path
        };
    } else {
        const installPack = extractInstallPack(packageInfo.path);
        const lang = analyzeApkPackageLang(installPack);
        const data = {
            vanilla: analyzeApkPackageDataEnums(installPack, "vanilla"),
            education: analyzeApkPackageDataEnums(installPack, "education"),
            experiment: analyzeApkPackageDataEnums(installPack, "experiment")
        };
        return {
            data: cachedOutput(`version.${version}.package.data`, data),
            lang: cachedOutput(`version.${version}.package.lang`, lang),
            ...cachedOutput(`version.${version}.package.info`, {
                packageVersion,
                packageType: packageInfo.type,
                packagePath: packageInfo.path
            })
        };
    }
}

module.exports = {
    analyzePackageDataEnumsCached
};
