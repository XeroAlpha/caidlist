import * as CommentJSON from '@projectxero/comment-json';
import analyzePackageDataEnumsCached from './sources/applicationPackage.js';
import analyzeAutocompletionEnumsCached from './sources/autocompletion.js';
import { fetchStandardizedTranslation, writeHiddenEntryLog } from './sources/wiki.js';
import fetchJavaEditionLangData from './sources/javaEdition.js';
import { fetchDocumentationIds, doSchemaTranslation } from './sources/documentation.js';
import { loadUserTranslation, saveUserTranslation } from './sources/userTranslation.js';
import analyzeGameTestEnumsCached from './sources/gametest.js';
import * as support from './sources/support.js';
import { matchTranslations } from './util/templateMatch.js';
import writeTransMapsExcel from './generators/excel.js';
import writeTransMapClib from './generators/clib.js';
import { writeTransMapTextZip } from './generators/text.js';
import { writeTransMapJson, writeTransMapIndexJson } from './generators/json.js';
import { writeLangParityPack, compareEditionLangs } from './generators/langParity.js';
import {
    projectPath,
    cachedOutput,
    forEachObject,
    filterObjectMap,
    keyArrayToObject,
    cascadeMap,
    removeMinecraftNamespace,
    setInlineCommentAfterField,
    deepCopy
} from './util/common.js';
import { buildBSDocFromTransMap, buildBSTransKeys } from './generators/blockState.js';

const BASE_LANG_ID = 'en_us';
const USER_LANG_ID = 'zh_cn';

// [ id, name, description ]
const defaultTransMapNames = [
    ['block', '方块', '用于 setblock、fill 等命令的方块 ID'],
    ['item', '物品', '用于 give、clear 等命令的物品 ID'],
    ['entity', '实体', '用于 summon 命令与 type 选择器参数的实体 ID'],
    ['effect', '状态效果', '用于 effect 命令的状态效果 ID'],
    ['enchant', '魔咒', '用于 enchant 命令的魔咒 ID'],
    ['fog', '迷雾', '用于 fog 命令的迷雾配置 ID'],
    ['biome', '生物群系', '用于 locate 命令的生物群系 ID'],
    ['location', '结构', '用于 locate 命令的结构 ID'],
    ['gamerule', '游戏规则', '用于 gamerule 命令的游戏规则 ID'],
    ['entitySlot', '实体槽位类型', '用于 replaceitem 命令与 hasitem 选择器参数的槽位类型 ID'],
    ['damageCause', '伤害类型', '用于 damage 命令的伤害类型 ID'],
    ['entityEvent', '实体事件', '用于 summon 等命令的实体事件 ID'],
    ['entityEventSplit', '根据实体类型分类的实体事件表'],
    ['entityFamily', '实体族', '用于 family 选择器参数的实体族 ID'],
    ['animation', '动画', '用于 playanimation 命令的动画 ID'],
    ['animationController', '动画控制器', '用于 playanimation 命令的动画控制器 ID'],
    ['particleEmitter', '粒子发射器', '用于 particle 命令的粒子发射器 ID'],
    ['featureAndRule', '地物与地物规则', '用于 placefeature 命令的地物 ID 和地物规则 ID'],
    ['sound', '声音', '用于 playsound 命令的声音 ID'],
    ['lootTable', '战利品表', '用于 loot 命令的战利品表选项'],
    ['command', '命令', '可见的命令列表'],
    ['stdTrans', '标准化译名表', '整合了中文 Minecraft Wiki 与 Minecraft基岩版开发Wiki 的标准化译名表']
];
const translatorMapNames = [
    ['BlockSprite', '方块'],
    ['ItemSprite', '物品'],
    ['EntitySprite', '实体'],
    ['EffectSprite', '状态效果'],
    ['EnchantmentSprite', '魔咒'],
    ['BiomeSprite', '生物群系'],
    ['EnvSprite', '环境'],
    ['Exclusive', '基岩版独占'],
    ['VanillaSprite', '其他原版内容'],
    ['AddonSprite', '附加包术语'],
    ['ModPESprite', 'ModPE术语'],
    ['InnerCoreSprite', 'InnerCore术语'],
    ['TechnicSprite', '其他技术术语'],
    ['BedrockEditionLang', '基岩版中文语言文件'],
    ['JavaEditionLang', 'Java版中文语言文件'],
    ['BedrockEditionLangSource', '基岩版英文语言文件'],
    ['JavaEditionLangSource', 'Java版英文语言文件']
];
const documentationMapNames = [
    ['entityFilter', '实体过滤器'],
    ['entityBehavior', '实体AI意向'],
    ['entityAttribute', '实体特性'],
    ['entityBuiltinEvent', '实体内置事件'],
    ['entityComponent', '实体组件'],
    ['entityProperty', '实体属性'],
    ['entityTrigger', '实体触发器'],
    ['featureType', '地物类型'],
    ['molangQuery', 'Molang查询函数']
];
const gtMapNames = [
    ['block', '方块'],
    ['item', '物品'],
    ['entity', '实体'],
    ['blockState', '方块状态'],
    ['blockTag', '方块标签'],
    ['itemTag', '物品标签']
];
async function generateBranchedOutputFiles(cx) {
    const { version, branch, coreVersion, versionInfo } = cx;
    const packageDataEnums = analyzePackageDataEnumsCached(cx);
    const autocompletedEnums = await analyzeAutocompletionEnumsCached(cx);
    const enums = {
        ...packageDataEnums.data[branch.id],
        ...autocompletedEnums
    };
    const lang = packageDataEnums.lang[USER_LANG_ID];
    const standardizedTranslation = await fetchStandardizedTranslation();
    const javaEditionLang = (await fetchJavaEditionLangData())[USER_LANG_ID];
    const userTranslation = loadUserTranslation();
    console.log('Matching translations...');
    const translationResultMaps = {};
    const translationStateMaps = {};
    const commonOptions = {
        resultMaps: translationResultMaps,
        stateMaps: translationStateMaps,
        stdTransMap: cascadeMap(standardizedTranslation, [], true),
        javaEditionLangMap: javaEditionLang,
        langMap: lang,
        autoMatch: ['stdTrans', 'lang', 'langLikely']
    };
    if (versionInfo.disableAutoMatch) {
        commonOptions.autoMatch = null;
    }
    matchTranslations({
        ...commonOptions,
        name: 'glossary',
        originalArray: Object.keys(userTranslation.glossary),
        translationMap: userTranslation.glossary,
        stdTransMap: cascadeMap(standardizedTranslation, [], true),
        autoMatch: null
    });
    matchTranslations({
        ...commonOptions,
        name: 'block',
        originalArray: enums.blocks,
        translationMap: userTranslation.block,
        stdTransMap: cascadeMap(standardizedTranslation, ['BlockSprite', 'ExclusiveBlockSprite'], true),
        langKeyPrefix: 'tile.',
        langKeySuffix: '.name'
    });
    matchTranslations({
        ...commonOptions,
        name: 'item',
        originalArray: enums.items.filter((item) => !enums.blocks.includes(item)),
        translationMap: userTranslation.item,
        stdTransMap: cascadeMap(standardizedTranslation, ['ItemSprite', 'ExclusiveItemSprite'], true),
        langKeyPrefix: 'item.',
        langKeySuffix: '.name',
        postProcessor(item) {
            const mergedItem = {};
            const { block } = translationResultMaps;
            enums.items.forEach((key) => {
                if (key in block) {
                    CommentJSON.assign(mergedItem, block, [key]);
                } else {
                    CommentJSON.assign(mergedItem, item, [key]);
                }
            });
            return mergedItem;
        }
    });
    matchTranslations({
        ...commonOptions,
        name: 'entity',
        originalArray: removeMinecraftNamespace(enums.entities),
        translationMap: userTranslation.entity,
        stdTransMap: cascadeMap(standardizedTranslation, ['EntitySprite'], true),
        langKeyPrefix: 'entity.',
        langKeySuffix: '.name',
        postProcessor(entity) {
            const mergedEntity = {};
            enums.entities.forEach((key) => {
                if (key in entity) {
                    CommentJSON.assign(mergedEntity, entity, [key]);
                } else {
                    mergedEntity[key] = entity[`minecraft:${key}`];
                }
            });
            return mergedEntity;
        }
    });
    matchTranslations({
        ...commonOptions,
        name: 'effect',
        originalArray: enums.effects,
        translationMap: userTranslation.effect,
        stdTransMap: cascadeMap(standardizedTranslation, ['EffectSprite'], true)
    });
    matchTranslations({
        ...commonOptions,
        name: 'enchant',
        originalArray: enums.enchantments,
        translationMap: userTranslation.enchant,
        stdTransMap: cascadeMap(standardizedTranslation, ['EnchantmentSprite'], true)
    });
    matchTranslations({
        ...commonOptions,
        name: 'fog',
        originalArray: enums.fogs,
        translationMap: userTranslation.fog,
        stdTransMap: cascadeMap(standardizedTranslation, ['BiomeSprite'], true)
    });
    matchTranslations({
        ...commonOptions,
        name: 'location',
        originalArray: enums.locations,
        translationMap: userTranslation.location,
        stdTransMap: cascadeMap(standardizedTranslation, ['EnvSprite'], true)
    });
    if (support.newLocateCommand(coreVersion)) {
        matchTranslations({
            ...commonOptions,
            name: 'biome',
            originalArray: enums.biomes,
            translationMap: userTranslation.biome,
            stdTransMap: cascadeMap(standardizedTranslation, ['BiomeSprite'], true)
        });
    }
    matchTranslations({
        ...commonOptions,
        name: 'entityEvent',
        originalArray: Object.keys(enums.entityEventsMap),
        translationMap: userTranslation.entityEvent,
        stdTransMap: cascadeMap(standardizedTranslation, ['EntitySprite'], true),
        postProcessor(entityEvent) {
            forEachObject(entityEvent, (value, key) => {
                if (value) return;
                const comment = `from: ${enums.entityEventsMap[key].join(', ')}`;
                setInlineCommentAfterField(userTranslation.entityEvent, key, comment);
            });
        }
    });
    matchTranslations({
        ...commonOptions,
        name: 'entityFamily',
        originalArray: Object.keys(enums.entityFamilyMap),
        translationMap: userTranslation.entityFamily,
        stdTransMap: cascadeMap(standardizedTranslation, ['EntitySprite'], true),
        postProcessor(entityFamily) {
            forEachObject(entityFamily, (value, key) => {
                if (value) return;
                const comment = `from: ${enums.entityFamilyMap[key].join(', ')}`;
                setInlineCommentAfterField(userTranslation.entityFamily, key, comment);
            });
        }
    });
    matchTranslations({
        ...commonOptions,
        name: 'animation',
        originalArray: Object.keys(enums.animationMap),
        translationMap: userTranslation.animation,
        stdTransMap: cascadeMap(standardizedTranslation, ['EntitySprite'], true),
        postProcessor(animation) {
            forEachObject(animation, (value, key) => {
                if (value) return;
                const relatedEntites = enums.animationMap[key];
                if (relatedEntites.length) {
                    const comment = `from: ${relatedEntites.join(', ')}`;
                    setInlineCommentAfterField(userTranslation.animation, key, comment);
                }
            });
        }
    });
    matchTranslations({
        ...commonOptions,
        name: 'animationController',
        originalArray: Object.keys(enums.animationControllerMap),
        translationMap: userTranslation.animationController,
        stdTransMap: cascadeMap(standardizedTranslation, ['EntitySprite'], true),
        postProcessor(animationController) {
            forEachObject(animationController, (value, key) => {
                if (value) return;
                const relatedEntites = enums.animationControllerMap[key];
                if (relatedEntites.length) {
                    const comment = `from: ${relatedEntites.join(', ')}`;
                    setInlineCommentAfterField(userTranslation.animationController, key, comment);
                }
            });
        }
    });
    matchTranslations({
        ...commonOptions,
        name: 'particleEmitter',
        originalArray: enums.particleEmitters,
        translationMap: userTranslation.particleEmitter,
        autoMatch: null
    });
    matchTranslations({
        ...commonOptions,
        name: 'sound',
        originalArray: enums.sounds,
        translationMap: userTranslation.sound
    });
    matchTranslations({
        ...commonOptions,
        name: 'gamerule',
        originalArray: enums.gamerules,
        translationMap: userTranslation.gamerule
    });
    matchTranslations({
        ...commonOptions,
        name: 'entitySlot',
        originalArray: enums.entitySlots,
        translationMap: userTranslation.entitySlot
    });
    if (support.mcpews(version)) {
        matchTranslations({
            ...commonOptions,
            name: 'command',
            originalArray: enums.commandList.map((e) => e.replace(/^\//, '')),
            translationMap: userTranslation.command,
            stdTransMap: cascadeMap(standardizedTranslation, [], true)
        });
    }
    if (support.lootTable(coreVersion)) {
        matchTranslations({
            ...commonOptions,
            name: 'lootTable',
            originalArray: enums.lootTables,
            translationMap: userTranslation.lootTable
        });
        const nameWrapped = {};
        forEachObject(translationResultMaps.lootTable, (value, key) => {
            const wrappedKey = CommentJSON.stringify(key);
            if (key.includes('/')) {
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
    if (support.damageCommand(coreVersion)) {
        matchTranslations({
            ...commonOptions,
            name: 'damageCause',
            originalArray: enums.damageCauses,
            translationMap: userTranslation.damageCause
        });
    }
    if (support.placefeatureCommand(coreVersion)) {
        matchTranslations({
            ...commonOptions,
            name: 'featureAndRule',
            originalArray: enums.featuresAndRules,
            translationMap: userTranslation.feature
        });
    }
    translationResultMaps.music = filterObjectMap(
        translationResultMaps.sound,
        (key) => key.startsWith('music.') || key.startsWith('record.')
    );
    translationResultMaps.summonableEntity = filterObjectMap(translationResultMaps.entity, (key) => enums.summonableEntities.includes(key));
    if (enums.lootTools) {
        translationResultMaps.lootTool = keyArrayToObject(enums.lootTools, (k) => {
            let key = k;
            if (k.startsWith('minecraft:')) key = k.slice('minecraft:'.length);
            if (key in translationResultMaps.item) {
                return translationResultMaps.item[key];
            }
            return '';
        });
    } else {
        translationResultMaps.lootTool = {};
    }
    delete translationResultMaps.glossary;
    delete translationStateMaps.glossary;

    console.log('Exporting files...');
    cachedOutput(`output.translation.${version}.${branch.id}`, translationStateMaps);
    writeTransMapClib(cx, {
        outputFile: projectPath(`output.clib.${version}.${branch.id}`),
        translationResultMaps,
        patchOptions: branch.patch ? {
            sourceFile: projectPath(`output.clib.${version}.${branch.patch.from}`),
            patchFile: projectPath(`output.clib.${version}.patch.${branch.id}`),
            uuid: branch.patch.uuid
        } : undefined
    });
    writeTransMapsExcel(projectPath(`output.translation.${version}.${branch.id}`, 'xlsx'), translationResultMaps);
    writeTransMapTextZip(cx, {
        outputFile: projectPath(`output.web.${version}.${branch.id}`, 'zip'),
        originalEnums: enums,
        transMaps: translationResultMaps,
        transMapNames: defaultTransMapNames,
        stdTransMap: standardizedTranslation,
        stdTransMapNames: translatorMapNames
    });
    writeTransMapJson(cx, {
        outputFile: projectPath(`output.web.${version}.${branch.id}`, 'json'),
        originalEnums: enums,
        transMaps: translationResultMaps,
        transMapNames: defaultTransMapNames
    });
    saveUserTranslation(userTranslation);
    writeHiddenEntryLog(cx, standardizedTranslation);
}

async function generateLangParityPack(cx) {
    const packageDataEnums = analyzePackageDataEnumsCached(cx);
    const standardizedTranslation = await fetchStandardizedTranslation();
    const bedrockEditionLang = packageDataEnums.lang;
    const javaEditionLang = await fetchJavaEditionLangData();
    const userTranslation = loadUserTranslation();
    const overrideRawMap = userTranslation.langParity;
    const overrideMapResult = deepCopy({
        ...standardizedTranslation,
        JESource: javaEditionLang[BASE_LANG_ID],
        Source: bedrockEditionLang[BASE_LANG_ID]
    });
    matchTranslations({
        resultMaps: overrideMapResult,
        name: 'LangParity',
        originalArray: Object.keys(overrideRawMap),
        translationMap: overrideRawMap,
        stdTransMap: cascadeMap(standardizedTranslation, [], true),
        javaEditionLangMap: javaEditionLang,
        langMap: bedrockEditionLang
    });
    writeLangParityPack(cx, {
        outputDifferenceFile: projectPath(`output.lang_parity.${cx.version}.difference`, 'json'),
        outputLangFile: projectPath(`output.lang_parity.${cx.version}.output`, 'lang'),
        outputPackFile: projectPath(`output.lang_parity.${cx.version}.output`, 'mcpack'),
        differences: compareEditionLangs({
            bedrockEditionLang,
            javaEditionLang,
            compareLangId: USER_LANG_ID,
            baseLangId: BASE_LANG_ID
        }),
        overrideMap: overrideMapResult.LangParity
    });
    writeHiddenEntryLog(cx, standardizedTranslation);
}

async function generateTranslatorHelperFiles(cx) {
    const packageDataEnums = analyzePackageDataEnumsCached(cx);
    const standardizedTranslation = await fetchStandardizedTranslation();
    const bedrockEditionLang = packageDataEnums.lang;
    const javaEditionLang = await fetchJavaEditionLangData();
    const transMaps = {
        ...standardizedTranslation,
        BedrockEditionLang: bedrockEditionLang[USER_LANG_ID],
        JavaEditionLang: javaEditionLang[USER_LANG_ID],
        BedrockEditionLangSource: bedrockEditionLang[BASE_LANG_ID],
        JavaEditionLangSource: javaEditionLang[BASE_LANG_ID]
    };
    writeTransMapTextZip(cx, {
        outputFile: projectPath(`output.web.${cx.version}.translator`, 'zip'),
        transMaps,
        transMapNames: translatorMapNames
    });
    writeTransMapJson(cx, {
        outputFile: projectPath(`output.web.${cx.version}.translator`, 'json'),
        transMaps,
        transMapNames: translatorMapNames
    });
}

async function generateDocumentationOutputFiles(cx) {
    const ids = await fetchDocumentationIds(cx);
    const standardizedTranslation = await fetchStandardizedTranslation();
    const userTranslation = loadUserTranslation().documentation;
    const resultContainer = {};
    const transMaps = {};
    if (!userTranslation.glossary) {
        userTranslation.glossary = {};
    }
    matchTranslations({
        resultMaps: resultContainer,
        name: 'glossary',
        originalArray: Object.keys(userTranslation.glossary),
        translationMap: userTranslation.glossary,
        stdTransMap: cascadeMap(standardizedTranslation, [], true)
    });
    forEachObject(ids, (table, tableId) => {
        transMaps[tableId] = doSchemaTranslation(table, (map, keys) => {
            if (!userTranslation[tableId]) {
                userTranslation[tableId] = {};
            }
            matchTranslations({
                resultMaps: resultContainer,
                name: tableId,
                originalArray: keys,
                translationMap: userTranslation[tableId],
                stdTransMap: cascadeMap(standardizedTranslation, [], true),
                langMap: map,
                langKeyPrefix: '',
                langKeySuffix: '',
                autoMatch: ['lang']
            });
            return resultContainer[tableId];
        });
    });
    writeTransMapTextZip(cx, {
        outputFile: projectPath(`output.web.${cx.version}.documentation`, 'zip'),
        transMaps,
        transMapNames: documentationMapNames
    });
    writeTransMapJson(cx, {
        outputFile: projectPath(`output.web.${cx.version}.documentation`, 'json'),
        transMaps,
        transMapNames: documentationMapNames
    });
    saveUserTranslation({ documentation: userTranslation });
    writeHiddenEntryLog(cx, standardizedTranslation);
}

async function generateGameTestOutputFiles(cx) {
    const { version, branch, versionInfo } = cx;
    const ids = await analyzeGameTestEnumsCached(cx);
    const standardizedTranslation = await fetchStandardizedTranslation();
    const javaEditionLang = (await fetchJavaEditionLangData())[USER_LANG_ID];
    const userTranslation = loadUserTranslation();
    console.log('Matching translations...');
    const translationResultMaps = {};
    const commonOptions = {
        resultMaps: translationResultMaps,
        stdTransMap: cascadeMap(standardizedTranslation, [], true),
        javaEditionLangMap: javaEditionLang,
        autoMatch: ['stdTrans']
    };
    if (versionInfo.disableAutoMatch) {
        commonOptions.autoMatch = null;
    }
    matchTranslations({
        ...commonOptions,
        name: 'glossary',
        originalArray: Object.keys(userTranslation.glossary),
        translationMap: userTranslation.glossary,
        stdTransMap: cascadeMap(standardizedTranslation, [], true),
        autoMatch: null
    });
    const removePrefix = (s) => s.replace(/^minecraft:/, '');
    const blockIds = Object.keys(ids.blocks);
    const itemIds = Object.keys(ids.items);
    const itemIdsExclusive = itemIds.filter((e) => !blockIds.includes(e));
    const entityIds = ids.entities;
    matchTranslations({
        ...commonOptions,
        name: 'block',
        originalArray: blockIds.map(removePrefix),
        translationMap: userTranslation.block,
        stdTransMap: cascadeMap(standardizedTranslation, ['BlockSprite', 'ExclusiveBlockSprite'], true),
        postProcessor(result) {
            const mergedResult = {};
            blockIds.forEach((key) => {
                mergedResult[key] = result[removePrefix(key)];
            });
            return mergedResult;
        }
    });
    matchTranslations({
        ...commonOptions,
        name: 'item',
        originalArray: itemIdsExclusive.map(removePrefix),
        translationMap: userTranslation.item,
        stdTransMap: cascadeMap(standardizedTranslation, ['ItemSprite', 'ExclusiveItemSprite'], true),
        postProcessor(result) {
            const mergedResult = {};
            const { block } = translationResultMaps;
            itemIds.forEach((key) => {
                if (key in block) {
                    CommentJSON.assign(mergedResult, block, [key]);
                } else {
                    mergedResult[key] = result[removePrefix(key)];
                }
            });
            return mergedResult;
        }
    });
    matchTranslations({
        ...commonOptions,
        name: 'entity',
        originalArray: entityIds,
        translationMap: userTranslation.entity,
        stdTransMap: cascadeMap(standardizedTranslation, ['EntitySprite'], true)
    });
    matchTranslations({
        ...commonOptions,
        name: 'blockState',
        originalArray: buildBSTransKeys(ids.blockProperties),
        translationMap: userTranslation.blockState,
        stdTransMap: cascadeMap(standardizedTranslation, ['BlockSprite'], true),
        autoMatch: [],
        postProcessor(result) {
            const { block } = translationResultMaps;
            return buildBSDocFromTransMap(ids.blockProperties, result, block);
        }
    });
    const blockTagIds = Object.keys(ids.blockTags);
    matchTranslations({
        ...commonOptions,
        name: 'blockTag',
        originalArray: blockTagIds,
        translationMap: userTranslation.blockTag,
        stdTransMap: cascadeMap(standardizedTranslation, ['BlockSprite', 'ExclusiveBlockSprite'], true),
        autoMatch: []
    });
    const itemTagIds = Object.keys(ids.itemTags);
    matchTranslations({
        ...commonOptions,
        name: 'itemTag',
        originalArray: itemTagIds,
        translationMap: userTranslation.itemTag,
        stdTransMap: cascadeMap(standardizedTranslation, ['ItemSprite', 'ExclusiveItemSprite'], true),
        autoMatch: []
    });
    delete translationResultMaps.glossary;

    console.log('Exporting files...');
    writeTransMapTextZip(cx, {
        outputFile: projectPath(`output.web.${version}.${branch.id}`, 'zip'),
        transMaps: translationResultMaps,
        transMapNames: gtMapNames
    });
    writeTransMapJson(cx, {
        outputFile: projectPath(`output.web.${version}.${branch.id}`, 'json'),
        transMaps: translationResultMaps,
        transMapNames: gtMapNames
    });
    saveUserTranslation(userTranslation);
    writeHiddenEntryLog(cx, standardizedTranslation);
}

const versionInfoMap = {
    beta: {
        name: '测试版',
        description: '更新速度快，包含较多不稳定的新特性的版本',
        sortOrder: 0,
        branches: [
            'vanilla',
            'education',
            'experiment',
            'gametest',
            'translator',
            'documentation',
            'langParity'
        ]
    },
    release: {
        name: '正式版',
        description: '更新速度慢，向所有人开放的稳定版本',
        sortOrder: 1,
        branches: [
            'vanilla',
            'education',
            'experiment',
            'documentation'
        ]
    },
    netease: {
        name: '中国版',
        description: '由网易推出的中国本地化版本，通常落后于正式版',
        sortOrder: 2,
        branches: [
            'vanilla',
            'experiment'
        ]
    },
    netease_dev: {
        // name: "中国版测试版",
        // description: "面向中国版开发者开放的测试版本",
        name: '中国版',
        description:
            '由网易推出的中国本地化版本，通常落后于正式版。由于一些限制，此处使用开发者专用的测试版启动器的数据代替。',
        sortOrder: 3,
        branches: [
            'vanilla',
            'experiment'
        ]
    },
    education: {
        name: '教育版',
        description: '为教室使用而设计的教学版本',
        sortOrder: 4,
        branches: [
            'vanilla'
        ]
    },
    preview_win: {
        name: '预览版（Windows）',
        description: '更新速度比 Android 端快，但仅包含 WebSocket 与 Scripting API 相关内容',
        sortOrder: 5,
        disableAdb: true,
        hidden: true,
        branches: [
            'gametest'
        ]
    },
    bds_preview: {
        name: '专用服务器预览版',
        description: '与预览版同步更新',
        sortOrder: 6,
        branches: [
            'bds'
        ]
    },
    bds_release: {
        name: '专用服务器正式版',
        description: '与正式版同步更新',
        sortOrder: 7,
        branches: [
            'bds'
        ]
    },
    dev: {
        sortOrder: 8,
        disableAutoMatch: true,
        hidden: true,
        branches: [
            'vanilla',
            'education',
            'experiment',
            'gametest'
        ]
    }
};
const branchInfoMap = {
    vanilla: {
        name: '原版',
        description: '使用默认设置创建的世界的ID表'
    },
    education: {
        name: '教育版',
        description: '启用了教育版选项后创建的世界的ID表',
        patch: { from: 'vanilla', uuid: 'fa5e8807-b1e9-402f-aafa-0376e1b79ee2' }
    },
    experiment: {
        name: '实验性玩法',
        description: '启用了所有实验性玩法选项后创建的世界的ID表',
        patch: { from: 'vanilla', uuid: '67ae284f-dc3e-4a13-85f8-a455a1874962' }
    },
    gametest: {
        name: 'Script API',
        description: '通过 Script API / GameTest 获取的ID表'
    },
    translator: {
        name: '翻译专用',
        description: '为翻译英文文本设计，包含了标准化译名表与语言文件'
    },
    documentation: {
        name: '文档',
        description: '开发者文档中出现的ID及其描述'
    },
    langParity: {
        name: '译名比较',
        description: '比较基岩版翻译与标准化译名，展示两者的差异',
        hidden: true
    }
};

export function generateOutputIndex(cx) {
    const { version } = cx;
    cx.packageInfo = cx.packageVersions[version];
    if (!cx.packageInfo) throw new Error(`Unknown version: ${version}`);
    cx.packageVersion = cx.packageInfo.version;
    cx.coreVersion = cx.packageInfo.coreVersion || cx.packageVersion;
    if (cx.packageInfo.config) {
        forEachObject(cx.packageInfo.config, (v, k) => {
            cx[k] = v;
        });
    }
    cx.versionInfo = versionInfoMap[version];
    const { branches } = cx.versionInfo;
    const rewriteHiddenBranches = [];
    if (cx.versionInfo.hidden) {
        rewriteHiddenBranches.push(...branches);
    } else if (cx.versionInfo.hiddenBranches) {
        rewriteHiddenBranches.push(...cx.versionInfo.hiddenBranches);
    }
    const branchList = branches.map((id) => ({
        id,
        hidden: rewriteHiddenBranches.includes(id),
        ...branchInfoMap[id]
    }));
    writeTransMapIndexJson(cx, {
        outputFile: projectPath(`output.web.${version}.index`),
        mergedFile: projectPath('output.web.index'),
        rootUrl: '.',
        branchList
    });
    return branchList;
}

export async function generateOutputFiles(cx) {
    if (cx.branch.id === 'translator') {
        return generateTranslatorHelperFiles(cx);
    }
    if (cx.branch.id === 'langParity') {
        return generateLangParityPack(cx);
    }
    if (cx.branch.id === 'documentation') {
        return generateDocumentationOutputFiles(cx);
    }
    if (cx.branch.id === 'gametest') {
        return generateGameTestOutputFiles(cx);
    }
    return generateBranchedOutputFiles(cx);
}
