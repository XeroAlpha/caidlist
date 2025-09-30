import { createHash } from 'crypto';
import AdmZip from 'adm-zip';
import * as CommentJSON from '@projectxero/comment-json';
import {
    cachedOutput,
    forEachObject,
    filterObjectMap,
    stringComparator,
    compareMinecraftVersion,
    uniqueAndSort,
    sortObjectKey,
    log,
    setStatus,
    warn
} from '../util/common.js';
import { RecipeDataParser } from '../generators/recipe.js';

function iteratePackageEntries(packageZip, filter, processor) {
    const entries = packageZip
        .getEntries()
        .map((entry) => [entry, filter(entry)])
        .filter(([, extra]) => extra !== undefined);
    let nextStatusTime = Date.now();
    for (let i = 0; i < entries.length; i++) {
        const [entry, extra] = entries[i];
        const now = Date.now();
        if (nextStatusTime <= now) {
            const pct = ((i / entries.length) * 100).toFixed(1).padStart(5);
            setStatus(`${pct}% ${entry.entryName}`);
            nextStatusTime = now + 100;
        }
        processor(entry, entry.isDirectory ? null : entry.getData(), extra);
    }
    setStatus('');
}

function generatePackageFileMeta(fileName, packageZip) {
    const files = [];
    log(`Analyzing package entries for hash: ${fileName}`);
    iteratePackageEntries(
        packageZip,
        () => true,
        (entry, data) => {
            if (entry.isDirectory) {
                files.push({ name: entry.entryName, directory: true });
            } else {
                const digest = createHash('sha1');
                digest.update(data);
                files.push({
                    name: entry.entryName,
                    size: data.length,
                    sha1: digest.digest().toString('hex')
                });
            }
        }
    );
    files.sort((a, b) => stringComparator(a.name, b.name));
    return files;
}

function parseMinecraftLang(target, langContent) {
    langContent.split(/(?:\n|\r)+/).forEach((line) => {
        let l = line;
        let lineEnd;
        l = l.trimStart();
        lineEnd = l.indexOf('\t');
        if (lineEnd >= 0) l = l.slice(0, lineEnd);
        lineEnd = l.indexOf('##');
        if (lineEnd >= 0) l = l.slice(0, lineEnd);
        const equPos = l.indexOf('=');
        if (equPos > 0 && equPos < l.length - 1) {
            target[l.slice(0, equPos)] = l.slice(equPos + 1);
        }
    });
}

function analyzeApkPackageLang(packageZip) {
    const langZh = {};
    const langEn = {};
    log('Analyzing package entries for language file...');
    iteratePackageEntries(
        packageZip,
        (entry) => {
            const { entryName } = entry;
            if (entryName.match(/resource_packs\/(?:[^/]+)\/texts\/zh_CN\.lang$/)) {
                return langZh;
            }
            if (entryName.match(/resource_packs\/(?:[^/]+)\/texts\/en_US\.lang$/)) {
                return langEn;
            }
            return undefined;
        },
        (_, data, langObj) => {
            parseMinecraftLang(langObj, data.toString('utf-8'));
        }
    );
    return {
        zh_cn: langZh,
        en_us: langEn
    };
}

const branchEntryNameKeywords = {
    vanilla: ['assets/definitions/', 'vanilla', '~gametest'],
    education: ['assets/definitions/', 'vanilla', 'chemistry', 'education'],
    experiment: ['assets/definitions/', 'vanilla', 'experiment', 'test']
};
const entryAnalyzer = [
    {
        name: 'soundDefinition',
        type: 'json',
        regex: /assets\/resource_packs\/(?:[^/]+)\/sounds\/sound_definitions\.json$/,
        analyze(results, entryName, soundDefinition) {
            const { sounds } = results;
            const formatVersion = soundDefinition.format_version;
            if (formatVersion === '1.14.0') {
                sounds.push(...Object.keys(soundDefinition.sound_definitions));
            } else if (!formatVersion) {
                sounds.push(...Object.keys(soundDefinition));
            } else {
                warn(`Unknown format version: ${formatVersion} - ${entryName}`);
            }
        }
    },
    {
        name: 'particle',
        type: 'json',
        regex: /assets\/resource_packs\/(?:[^/]+)\/particles\/(?:[^/]+)\.json$/,
        analyze(results, entryName, particle) {
            const { particleEmitters } = results;
            const formatVersion = particle.format_version;
            if (formatVersion === '1.10.0' || formatVersion === '1.21.60') {
                particleEmitters.push(particle.particle_effect.description.identifier);
            } else {
                warn(`Unknown format version: ${formatVersion} - ${entryName}`);
            }
        }
    },
    {
        name: 'entityDefinition',
        type: 'json',
        regex: /assets\/resource_packs\/(?:[^/]+)\/entity\/(?:[^/]+)\.json$/,
        analyze(results, entryName, clientEntity) {
            const { entityDefinitionMap } = results.internal;
            const formatVersion = clientEntity.format_version;
            if (this.versionsGroups[0].includes(formatVersion)) {
                const entityDescription = clientEntity['minecraft:client_entity'].description;
                const id = entityDescription.identifier;
                const minEngineVersion = entityDescription.min_engine_version || '0';
                const defData = {
                    minEngineVersion,
                    geometry: entityDescription.geometry || {},
                    animationRefs: entityDescription.animations || {},
                    animationControllers: entityDescription.animation_controllers || [],
                    renderControllers: entityDescription.render_controllers || []
                };
                const existDefData = entityDefinitionMap[id];
                if (!existDefData) {
                    entityDefinitionMap[id] = defData;
                } else if (compareMinecraftVersion(minEngineVersion, existDefData.minEngineVersion) > 0) {
                    entityDefinitionMap[id] = defData;
                }
            } else {
                warn(`Unknown format version: ${formatVersion} - ${entryName}`);
            }
        },
        versionsGroups: [['1.8.0', '1.10.0']]
    },
    {
        name: 'geometry',
        type: 'json',
        regex: /assets\/resource_packs\/(?:[^/]+)\/models\/(?:[^]+)\.json$/,
        analyze(results, entryName, geometry) {
            const { geometryMap } = results;
            const formatVersion = geometry.format_version;
            if (this.versionsGroups[0].includes(formatVersion)) {
                Object.keys(geometry).forEach((geometryId) => {
                    if (geometryId === 'format_version') return;
                    const colonPos = geometryId.indexOf(':');
                    let namespaceRemoved = geometryId;
                    if (colonPos > 0) {
                        namespaceRemoved = geometryId.slice(0, colonPos);
                    }
                    geometryMap[namespaceRemoved] = [];
                });
            } else if (this.versionsGroups[1].includes(formatVersion)) {
                if (Array.isArray(geometry['minecraft:geometry'])) {
                    geometry['minecraft:geometry'].forEach((data) => {
                        geometryMap[data.description.identifier] = [];
                    });
                }
            } else {
                warn(`Unknown format version: ${formatVersion} - ${entryName}`);
            }
        },
        versionsGroups: [
            [undefined, '1.8.0', '1.10.0'],
            ['1.12.0', '1.13.0', '1.14.0', '1.16.0', '1.21.0']
        ]
    },
    {
        name: 'animation',
        type: 'json',
        regex: /assets\/resource_packs\/(?:[^/]+)\/animations\/(?:[^/]+)\.json$/,
        analyze(results, entryName, animations) {
            const { animationMap } = results;
            const formatVersion = animations.format_version;
            if (formatVersion === '1.8.0' || formatVersion === '1.10.0') {
                Object.keys(animations.animations).forEach((animationId) => {
                    animationMap[animationId] = [];
                });
            } else {
                warn(`Unknown format version: ${formatVersion} - ${entryName}`);
            }
        }
    },
    {
        name: 'animationController',
        type: 'json',
        regex: /assets\/resource_packs\/(?:[^/]+)\/animation_controllers\/(?:[^/]+)\.json$/,
        analyze(results, entryName, animationControllers) {
            const { animationControllerMap } = results;
            const formatVersion = animationControllers.format_version;
            if (formatVersion === '1.10.0') {
                Object.keys(animationControllers.animation_controllers).forEach((controllerId) => {
                    animationControllerMap[controllerId] = [];
                });
            } else {
                warn(`Unknown format version: ${formatVersion} - ${entryName}`);
            }
        }
    },
    {
        name: 'renderController',
        type: 'json',
        regex: /assets\/resource_packs\/(?:[^/]+)\/render_controllers\/(?:[^/]+)\.json$/,
        analyze(results, entryName, renderControllers) {
            const { renderControllerMap } = results;
            const formatVersion = renderControllers.format_version;
            if (this.versionsGroups[0].includes(formatVersion)) {
                Object.keys(renderControllers.render_controllers).forEach((controllerId) => {
                    renderControllerMap[controllerId] = [];
                });
            } else {
                warn(`Unknown format version: ${formatVersion} - ${entryName}`);
            }
        },
        versionsGroups: [['1.8.0', '1.10', '1.10.0']]
    },
    {
        name: 'fog',
        type: 'json',
        regex: /assets\/resource_packs\/(?:[^/]+)\/fogs\/(?:[^/]+)\.json$/,
        analyze(results, entryName, fog) {
            const { fogs } = results;
            const formatVersion = fog.format_version;
            if (this.versionsGroups[0].includes(formatVersion)) {
                fogs.push(fog['minecraft:fog_settings'].description.identifier);
            } else {
                warn(`Unknown format version: ${formatVersion} - ${entryName}`);
            }
        },
        versionsGroups: [['1.16.100', '1.21.90']]
    },
    {
        name: 'entityBehavior',
        type: 'json',
        regex: /assets\/behavior_packs\/(?:[^/]+)\/entities\/(?:[^/]+)\.json$/,
        analyze(results, entryName, entity) {
            // TODO: only use newest version
            const { entityEventsMap, entityFamilyMap, entityPropertyDescMap } = results;
            const formatVersion = entity.format_version;
            if (this.versionsGroups[0].includes(formatVersion)) {
                const entityDescription = entity['minecraft:entity'].description;
                if (!entityDescription) return;
                const id = entityDescription.identifier;
                const events = Object.keys(entity['minecraft:entity'].events ?? {});
                const globalComponents = entity['minecraft:entity'].components ?? {};
                const componentGroups = entity['minecraft:entity'].component_groups ?? {};
                events.forEach((event) => {
                    let eventOwners = entityEventsMap[event];
                    if (!eventOwners) eventOwners = entityEventsMap[event] = [];
                    eventOwners.push(id);
                });
                [null, ...Object.keys(componentGroups)].forEach((componentName) => {
                    const groupId = componentName ? `${id}<${componentName}>` : id;
                    const components = componentName ? componentGroups[componentName] : globalComponents;
                    const typeFamilyObj = components['minecraft:type_family']?.family ?? [];
                    const typeFamilies = Array.isArray(typeFamilyObj) ? typeFamilyObj : [typeFamilyObj];
                    typeFamilies.forEach((familyName) => {
                        let familyMembers = entityFamilyMap[familyName];
                        if (!familyMembers) familyMembers = entityFamilyMap[familyName] = [];
                        familyMembers.push(groupId);
                    });
                });
                const entityProperties = entityDescription.properties;
                if (entityProperties) {
                    Object.entries(entityProperties).forEach(([propertyName, propertyDesc]) => {
                        let propertyEntityMap = entityPropertyDescMap[propertyName];
                        if (!propertyEntityMap) {
                            propertyEntityMap = entityPropertyDescMap[propertyName] = {};
                        }
                        const filteredPropertyDesc = {};
                        const safeDescKeys = ['type'];
                        if (propertyDesc.type === 'enum') {
                            safeDescKeys.push('values');
                        }
                        Object.entries(propertyDesc).forEach(([descKey, descValue]) => {
                            if (safeDescKeys.includes(descKey)) {
                                filteredPropertyDesc[descKey] = descValue;
                            }
                        });
                        propertyEntityMap[id] = filteredPropertyDesc;
                    });
                }
            } else {
                warn(`Unknown format version: ${formatVersion} - ${entryName}`);
            }
        },
        versionsGroups: [
            [
                '1.8.0',
                '1.10.0',
                '1.12.0',
                '1.13.0',
                '1.14.0',
                '1.15.0',
                '1.16.0',
                '1.16.100',
                '1.16.210',
                '1.17.10',
                '1.17.20',
                '1.18.10',
                '1.18.20',
                '1.18.30',
                '1.19.0',
                '1.19.30',
                '1.19.50',
                '1.19.60',
                '1.19.80',
                '1.20.0',
                '1.20.10',
                '1.20.60',
                '1.20.70',
                '1.20.80',
                '1.21.0',
                '1.21.10',
                '1.21.20',
                '1.21.30',
                '1.21.40',
                '1.21.50',
                '1.21.60',
                '1.21.70',
                '1.21.80',
                '1.21.90',
                '1.21.100',
                '1.21.110',
                '1.21.12'
            ]
        ]
    },
    {
        name: 'lootTable',
        regex: /assets\/behavior_packs\/(?:[^/]+)\/loot_tables\/(.+)\.json$/,
        analyze(results, entryName) {
            const { lootTables } = results;
            const match = this.regex.exec(entryName);
            if (match) {
                lootTables.push(match[1]);
            }
        }
    },
    {
        name: 'feature',
        type: 'json',
        regexList: [
            /assets\/definitions\/features\/(?:[^/]+)\.json$/,
            /assets\/behavior_packs\/(?:[^/]+)\/features\/(.+)\.json$/
        ],
        analyze(results, entryName, feature) {
            const { features } = results;
            const formatVersion = feature.format_version;
            if (this.versionsGroups[0].includes(formatVersion)) {
                forEachObject(feature, (v) => {
                    if (typeof v === 'object') {
                        features.push(v.description.identifier);
                    }
                });
            } else {
                warn(`Unknown format version: ${formatVersion} - ${entryName}`);
            }
        },
        versionsGroups: [['1.13.0', '1.14.0', '1.16.0', '1.16.100', '1.21.40', '1.21.60']]
    },
    {
        name: 'featureRule',
        type: 'json',
        regexList: [
            /assets\/definitions\/feature_rules\/(?:[^/]+)\.json$/,
            /assets\/behavior_packs\/(?:[^/]+)\/feature_rules\/(.+)\.json$/
        ],
        analyze(results, entryName, featureRule) {
            const { featureRules } = results;
            const formatVersion = featureRule.format_version;
            if (this.versionsGroups[0].includes(formatVersion)) {
                featureRules.push(featureRule['minecraft:feature_rules'].description.identifier);
            } else {
                warn(`Unknown format version: ${formatVersion} - ${entryName}`);
            }
        },
        versionsGroups: [['1.13.0', '1.14.0', '1.16.0', '1.16.100', '1.21.60']]
    },
    {
        name: 'dataDrivenRecipes',
        type: 'json',
        regex: /assets\/behavior_packs\/(?:[^/]+)\/recipes\/(?:[^/]+)\.json$/,
        analyze(results, entryName, recipe) {
            const { dataDrivenRecipeData } = results;
            const formatVersion = recipe.format_version;
            if (this.versionsGroups[0].includes(formatVersion)) {
                for (const [key, value] of Object.entries(recipe)) {
                    if (key === 'format_version') continue;
                    const parser = RecipeDataParser[key];
                    if (parser) {
                        dataDrivenRecipeData[value.description.identifier] = parser(value);
                    } else {
                        warn(`Unknown recipe type: ${key} - ${entryName}`);
                    }
                }
            } else {
                warn(`Unknown format version: ${formatVersion} - ${entryName}`);
            }
        },
        versionsGroups: [
            [
                '1.12',
                '1.14',
                '1.16',
                '1.19',
                '1.20.10',
                '1.20.30',
                '1.20.60',
                '1.21.30',
                '1.21.40',
                '1.21.50',
                '1.21.60',
                '1.21.80',
                '1.21.90'
            ]
        ]
    }
];
function analyzeApkPackageDataEnums(packageZip, branchId) {
    const entryNameKeywords = branchEntryNameKeywords[branchId] || [];
    const entryNameAllowKeywords = entryNameKeywords.filter((e) => !e.startsWith('~'));
    const entryNameDenyKeywords = entryNameKeywords.filter((e) => e.startsWith('~')).map((e) => e.slice(1));
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
        dataDrivenRecipeData: [],
        geometryMap: {},
        animationMap: {},
        animationControllerMap: {},
        renderControllerMap: {},
        entityEventsMap: {},
        entityFamilyMap: {},
        entityPropertyDescMap: {}
    };
    log('Analyzing package entries for data enums...');
    iteratePackageEntries(
        packageZip,
        (entry) => {
            const { entryName } = entry;
            const analyzer = entryAnalyzer.find((e) => {
                if (e.regex) {
                    return e.regex.test(entryName);
                }
                if (e.regexList) {
                    return e.regexList.some((regex) => regex.test(entryName));
                }
                if (e.filter) {
                    return e.filter(entryName, entry);
                }
                return false;
            });
            if (entryNameDenyKeywords.some((keyword) => entryName.includes(keyword))) return undefined;
            if (entryNameAllowKeywords.every((keyword) => !entryName.includes(keyword))) return undefined;
            return analyzer;
        },
        (entry, data, analyzer) => {
            const { entryName } = entry;
            let entryData = data;
            if (analyzer.type === 'json') {
                entryData = CommentJSON.parse(entryData.toString('utf8'));
            }
            try {
                analyzer.analyze(results, entryName, entryData);
            } catch (err) {
                warn(`Analyze Error: ${entryName}`, err);
            }
        }
    );
    forEachObject(results.internal.entityDefinitionMap, (definition, entityId) => {
        const { geometryMap, animationMap, animationControllerMap, renderControllerMap } = results;
        forEachObject(definition.geometry, (ref, action) => {
            if (!geometryMap[ref]) {
                geometryMap[ref] = [];
            }
            if (typeof action !== 'string') {
                warn(`Unexpected geometry category for ${entityId}: ${action}`);
            }
            geometryMap[ref].push(`${entityId}<${action}>`);
        });
        forEachObject(definition.animationRefs, (ref, action) => {
            if (typeof action !== 'string') {
                warn(`Unexpected animation reference for ${entityId}: ${action}`);
            }
            if (ref.startsWith('controller')) {
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
            if (typeof controllerGroup !== 'object') {
                warn(`Unexpected animation controller map for ${entityId}: ${controllerGroup}`);
            }
            forEachObject(controllerGroup, (ref, action) => {
                if (typeof action !== 'string') {
                    warn(`Unexpected animation controller for ${entityId}: ${action}`);
                }
                if (!animationControllerMap[ref]) {
                    animationControllerMap[ref] = [];
                }
                animationControllerMap[ref].push(`${entityId}<${action}>`);
            });
        });
        definition.renderControllers.forEach((renderController) => {
            const flattenedList = [];
            if (typeof renderController === 'string') {
                flattenedList.push(renderController);
            } else if (typeof renderController === 'object') {
                flattenedList.push(...Object.keys(renderController));
            } else {
                warn(`Unexpected render controller for ${entityId}: ${renderController}`);
            }
            flattenedList.forEach((e) => {
                if (!renderControllerMap[e]) {
                    renderControllerMap[e] = [];
                }
                renderControllerMap[e].push(`${entityId}`);
            });
        });
    });
    forEachObject(results, (v, k) => {
        if (k === 'dataDrivenRecipeData') {
            results[k] = sortObjectKey(v);
            return;
        }
        if (k === 'entityPropertyDescMap') {
            results[k] = sortObjectKey(v, 2);
            return;
        }
        if (k.endsWith('Map')) {
            forEachObject(v, (value) => {
                uniqueAndSort(value);
            });
            results[k] = sortObjectKey(v);
            return;
        }
        if (k !== 'internal') {
            uniqueAndSort(v);
        }
    });
    return filterObjectMap(results, (k) => k !== 'internal');
}

const apksInstallPack = ['install_pack.apk', 'split_install_pack.apk', 'com.mojang.minecraftpe.apk', 'base.apk'];
function extractInstallPack(packagePath) {
    const packageApkFile = new AdmZip(packagePath);
    if (packagePath.endsWith('.apks')) {
        log('Unpacking install pack...');
        let installPackApkEntry = null;
        for (let i = 0; i < apksInstallPack.length; i++) {
            installPackApkEntry = packageApkFile.getEntry(apksInstallPack[i]);
            if (installPackApkEntry) break;
        }
        if (!installPackApkEntry) {
            throw new Error('Install Pack not found!');
        }
        const installPackApk = packageApkFile.readFile(installPackApkEntry);
        const installPackApkFile = new AdmZip(installPackApk);
        const packageFileMeta = {};
        for (const packageEntry of packageApkFile.getEntries()) {
            if (packageEntry.entryName.toLowerCase().endsWith('.apk')) {
                const entryData = packageEntry.getData();
                packageFileMeta[packageEntry.entryName] = generatePackageFileMeta(
                    packageEntry.entryName,
                    new AdmZip(entryData)
                );
            }
        }
        sortObjectKey(packageFileMeta);
        return {
            installPack: installPackApkFile,
            packageFileMeta
        };
    }
    return {
        installPack: packageApkFile,
        packageFileMeta: generatePackageFileMeta(packagePath, packageApkFile)
    };
}

export default function analyzePackageDataEnumsCached(cx) {
    const { version, packageInfo, packageVersion } = cx;
    const dataCache = cachedOutput(`version.${version}.package.data`);
    const langCache = cachedOutput(`version.${version}.package.lang`);
    const infoCache = cachedOutput(`version.${version}.package.info`);
    if (dataCache && langCache && infoCache && infoCache.packagePath === packageInfo.path) {
        return {
            data: dataCache,
            lang: langCache,
            packageVersion: infoCache.version,
            packageType: infoCache.type,
            packagePath: packageInfo.path
        };
    }
    const { installPack, packageFileMeta: packageFiles } = extractInstallPack(packageInfo.path);
    const lang = analyzeApkPackageLang(installPack);
    const data = {
        vanilla: analyzeApkPackageDataEnums(installPack, 'vanilla'),
        education: analyzeApkPackageDataEnums(installPack, 'education'),
        experiment: analyzeApkPackageDataEnums(installPack, 'experiment')
    };
    return {
        data: cachedOutput(`version.${version}.package.data`, data),
        lang: cachedOutput(`version.${version}.package.lang`, lang),
        ...cachedOutput(`version.${version}.package.info`, {
            packageVersion,
            packageType: packageInfo.type,
            packagePath: packageInfo.path,
            packageFiles
        })
    };
}
