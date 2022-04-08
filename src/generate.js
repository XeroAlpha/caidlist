const JSON = require("comment-json");
const { analyzePackageDataEnumsCached } = require("./sources/applicationPackage");
const { analyzeAutocompletionEnumsCached } = require("./sources/autocompletion");
const { fetchStandardizedTranslation } = require("./sources/wiki");
const { fetchJavaEditionLangData } = require("./sources/javaEdition");
const { loadUserTranslation, saveUserTranslation } = require("./sources/userTranslation");
const support = require("./sources/support");
const { matchTranslations } = require("./util/templateMatch");
const { writeTransMapsExcel } = require("./generate/excel");
const { writeTransMapClib } = require("./generate/clib");
const { writeTransMapTextZip } = require("./generate/text");
const { writeTransMapJson, writeTransMapIndexJson } = require("./generate/json");
const { writeLangParityPack, compareEditionLangs } = require("./generate/langParity");
const {
    projectPath,
    cachedOutput,
    forEachObject,
    filterObjectMap,
    keyArrayToObject,
    cascadeMap,
    removeMinecraftNamespace,
    setInlineCommentAfterField
} = require("./util/common");

// [ id, name, description ]
const defaultTransMapNames = [
    ["block", "方块", "用于 setblock、fill 等命令的方块 ID"],
    ["item", "物品", "用于 give、clear 等命令的物品 ID"],
    ["entity", "实体", "用于 summon 命令与 type 选择器参数的实体 ID"],
    ["effect", "状态效果", "用于 effect 命令的状态效果 ID"],
    ["enchant", "魔咒", "用于 enchant 命令的魔咒 ID"],
    ["fog", "迷雾", "用于 fog 命令的迷雾配置 ID"],
    ["location", "结构", "用于 locate 命令的结构 ID"],
    ["gamerule", "游戏规则", "用于 gamerule 命令的游戏规则 ID"],
    ["entitySlot", "槽位类型", "用于 replaceitem 命令与 hasitem 选择器参数的槽位类型 ID"],
    ["damageCause", "伤害来源", "用于 damage 命令的伤害来源 ID"],
    ["entityEvent", "实体事件", "用于 summon 等命令的实体事件 ID"],
    ["entityEventSplit", "根据实体类型分类的实体事件表"],
    ["entityFamily", "实体族", "用于 family 选择器参数的实体族 ID"],
    ["animation", "动画", "用于 playanimation 命令的动画 ID"],
    ["animationController", "动画控制器", "用于 playanimation 命令的动画控制器 ID"],
    ["particleEmitter", "粒子发射器", "用于 particle 命令的粒子发射器 ID"],
    ["featureAndRule", "地物与地物规则", "用于 placefeature 命令的地物 ID 和地物规则 ID"],
    ["sound", "声音", "用于 playsound 命令的声音 ID"],
    ["lootTable", "战利品表", "用于 loot 命令的战利品表选项"],
    ["stdTrans", "标准化译名表", "整合了中文 Minecraft Wiki 与 Minecraft基岩版开发Wiki 的标准化译名表"]
];
const translatorMapNames = [
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
    ["TechnicSprite", "其他技术术语"],
    ["BedrockEditionLang", "基岩版中文语言文件"],
    ["JavaEditionLang", "Java版中文语言文件"],
    ["BedrockEditionLangSource", "基岩版英文语言文件"],
    ["JavaEditionLangSource", "Java版英文语言文件"]
];
async function generateBranchedOutputFiles(cx) {
    const { version, branch, coreVersion } = cx;
    let packageDataEnums = analyzePackageDataEnumsCached(cx);
    let autocompletedEnums = await analyzeAutocompletionEnumsCached(cx);
    let enums = {
        ...packageDataEnums.data[branch.id],
        ...autocompletedEnums
    };
    let lang = packageDataEnums.lang["zh_cn"];
    let standardizedTranslation = await fetchStandardizedTranslation();
    let javaEditionLang = (await fetchJavaEditionLangData())["zh_cn"];
    let userTranslation = loadUserTranslation();
    console.log("Matching translations...");
    let translationResultMaps = {},
        translationStateMaps = {};
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
        originalArray: enums.items.filter((item) => !enums.blocks.includes(item)),
        translationMap: userTranslation.item,
        stdTransMap: cascadeMap(standardizedTranslation, ["ItemSprite", "BlockSprite"], true),
        langKeyPrefix: "item.",
        langKeySuffix: ".name",
        postProcessor(item) {
            const mergedItem = {},
                block = translationResultMaps.block;
            enums.items.forEach((key) => {
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
            const mergedEntity = {};
            enums.entities.forEach((key) => {
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
                const comment = `from: ${enums.entityEventsMap[key].join(", ")}`;
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
                const comment = `from: ${enums.entityFamilyMap[key].join(", ")}`;
                setInlineCommentAfterField(userTranslation.entityFamily, key, comment);
            });
        }
    });
    matchTranslations({
        ...commonOptions,
        name: "animation",
        originalArray: Object.keys(enums.animationMap),
        translationMap: userTranslation.animation,
        stdTransMap: cascadeMap(standardizedTranslation, ["EntitySprite", "ItemSprite"], true),
        postProcessor(animation) {
            forEachObject(animation, (value, key) => {
                if (value) return;
                const relatedEntites = enums.animationMap[key];
                if (relatedEntites.length) {
                    const comment = `from: ${relatedEntites.join(", ")}`;
                    setInlineCommentAfterField(userTranslation.animation, key, comment);
                }
            });
        }
    });
    matchTranslations({
        ...commonOptions,
        name: "animationController",
        originalArray: Object.keys(enums.animationControllerMap),
        translationMap: userTranslation.animationController,
        stdTransMap: cascadeMap(standardizedTranslation, ["EntitySprite", "ItemSprite"], true),
        postProcessor(animationController) {
            forEachObject(animationController, (value, key) => {
                if (value) return;
                const relatedEntites = enums.animationControllerMap[key];
                if (relatedEntites.length) {
                    const comment = `from: ${relatedEntites.join(", ")}`;
                    setInlineCommentAfterField(userTranslation.animationController, key, comment);
                }
            });
        }
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
    matchTranslations({
        ...commonOptions,
        name: "gamerule",
        originalArray: enums.gamerules,
        translationMap: userTranslation.gamerule
    });
    matchTranslations({
        ...commonOptions,
        name: "entitySlot",
        originalArray: enums.entitySlots,
        translationMap: userTranslation.entitySlot
    });
    if (support.lootTable(coreVersion)) {
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
    if (support.damageCommand(coreVersion)) {
        matchTranslations({
            ...commonOptions,
            name: "damageCause",
            originalArray: enums.damageCauses,
            translationMap: userTranslation.damageCause
        });
    }
    if (support.placefeatureCommand(coreVersion)) {
        matchTranslations({
            ...commonOptions,
            name: "featureAndRule",
            originalArray: enums.featuresAndRules,
            translationMap: userTranslation.feature
        });
    }
    translationResultMaps.music = filterObjectMap(
        translationResultMaps.sound,
        (key) => key.startsWith("music.") || key.startsWith("record.")
    );
    translationResultMaps.summonableEntity = filterObjectMap(translationResultMaps.entity, (key) =>
        enums.summonableEntities.includes(key)
    );
    if (enums.lootTools) {
        translationResultMaps.lootTool = keyArrayToObject(enums.lootTools, (k) => {
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
    cachedOutput(`output.translation.${version}.${branch.id}`, translationStateMaps);
    writeTransMapClib(cx, {
        outputFile: projectPath(`output.clib.${version}.${branch.id}`),
        translationResultMaps
    });
    writeTransMapsExcel(projectPath(`output.translation.${version}.${branch.id}`, "xlsx"), translationResultMaps);
    writeTransMapTextZip(cx, {
        outputFile: projectPath(`output.web.${version}.${branch.id}`, "zip"),
        originalEnums: enums,
        transMaps: translationResultMaps,
        transMapNames: defaultTransMapNames,
        stdTransMap: standardizedTranslation,
        stdTransMapNames: translatorMapNames
    });
    writeTransMapJson(cx, {
        outputFile: projectPath(`output.web.${version}.${branch.id}`, "json"),
        originalEnums: enums,
        transMaps: translationResultMaps,
        transMapNames: defaultTransMapNames
    });
    saveUserTranslation(userTranslation);
}

async function generateLangParityPack(cx) {
    const packageDataEnums = analyzePackageDataEnumsCached(cx);
    const standardizedTranslation = await fetchStandardizedTranslation();
    const bedrockEditionLang = packageDataEnums.lang;
    const javaEditionLang = await fetchJavaEditionLangData();
    const userTranslation = loadUserTranslation();
    const overrideRawMap = userTranslation.langParity;
    const overrideMapResult = {};
    matchTranslations({
        resultMaps: overrideMapResult,
        name: "langParity",
        originalArray: Object.keys(overrideRawMap),
        translationMap: overrideRawMap,
        stdTransMap: cascadeMap(standardizedTranslation, [], true),
        javaEditionLangMap: javaEditionLang,
        langMap: bedrockEditionLang
    });
    writeLangParityPack(cx, {
        outputLangFile: projectPath(`output.lang_parity.${cx.version}.output`, "lang"),
        outputPackFile: projectPath(`output.lang_parity.${cx.version}.output`, "mcpack"),
        differences: compareEditionLangs({
            bedrockEditionLang,
            javaEditionLang,
            compareLangId: "zh_cn",
            baseLangId: "en_us"
        }),
        overrideMap: overrideMapResult.langParity
    });
}

async function generateTranslatorHelperFiles(cx) {
    const packageDataEnums = analyzePackageDataEnumsCached(cx);
    const standardizedTranslation = await fetchStandardizedTranslation();
    const bedrockEditionLang = packageDataEnums.lang;
    const javaEditionLang = await fetchJavaEditionLangData();
    const transMaps = {
        ...standardizedTranslation,
        BedrockEditionLang: bedrockEditionLang["zh_cn"],
        JavaEditionLang: javaEditionLang["zh_cn"],
        BedrockEditionLangSource: bedrockEditionLang["en_us"],
        JavaEditionLangSource: javaEditionLang["en_us"]
    };
    writeTransMapTextZip(cx, {
        outputFile: projectPath(`output.web.${cx.version}.translator`, "zip"),
        transMaps,
        transMapNames: translatorMapNames
    });
    writeTransMapJson(cx, {
        outputFile: projectPath(`output.web.${cx.version}.translator`, "json"),
        transMaps,
        transMapNames: translatorMapNames
    });
}

const versionInfoMap = {
    preview: {
        name: "预览版",
        description: "更新速度快，包含较多不稳定的新特性的版本",
        sortOrder: 0
    },
    beta: {
        name: "测试版",
        description: "更新速度快，包含较多不稳定的新特性的版本",
        sortOrder: 0
    },
    release: {
        name: "正式版",
        description: "更新速度慢，向所有人开放的稳定版本",
        sortOrder: 1
    },
    netease: {
        name: "中国版",
        description: "由网易推出的中国本地化版本，通常落后于正式版",
        sortOrder: 2
    },
    netease_dev: {
        // name: "中国版测试版",
        // description: "面向中国版开发者开放的测试版本",
        name: "中国版",
        description:
            "由网易推出的中国本地化版本，通常落后于正式版。由于一些限制，此处使用开发者专用的测试版启动器的数据代替。",
        sortOrder: 3
    },
    bds: {
        name: "专用服务器",
        description: "与正式版同步更新",
        sortOrder: 4,
        disablePackageInspect: true
    }
};
const branchInfoMap = {
    vanilla: {
        name: "原版",
        description: "使用默认设置创建的世界的ID表"
    },
    education: {
        name: "教育版",
        description: "启用了教育版选项后创建的世界的ID表"
    },
    experiment: {
        name: "实验性玩法",
        description: "启用了所有实验性玩法选项后创建的世界的ID表"
    },
    translator: {
        name: "翻译专用",
        description: "为翻译英文文本设计，包含了标准化译名表与语言文件"
    }
};
function generateOutputIndex(cx) {
    const { version } = cx;
    cx.packageInfo = cx.packageVersions[version];
    if (!cx.packageInfo) throw new Error("Unknown version: " + version);
    cx.packageVersion = cx.packageInfo.version;
    cx.coreVersion = cx.packageInfo.coreVersion || cx.packageVersion;
    if (cx.packageInfo.config) {
        forEachObject(cx.packageInfo.config, (v, k) => {
            cx[k] = v;
        });
    }
    cx.versionInfo = versionInfoMap[version];
    let branchList = cx.packageInfo.branches.map((id) => {
        return {
            id,
            ...branchInfoMap[id]
        };
    });
    writeTransMapIndexJson(cx, {
        outputFile: projectPath(`output.web.${version}.index`),
        mergedFile: projectPath(`output.web.index`),
        rootUrl: "./data",
        branchList
    });
    return branchList;
}

async function generateOutputFiles(cx) {
    if (cx.branch.id == "translator") {
        return await generateTranslatorHelperFiles(cx);
    } else if (cx.branch.id == "langParity") {
        return await generateLangParityPack(cx);
    } else {
        return await generateBranchedOutputFiles(cx);
    }
}

module.exports = {
    generateOutputIndex,
    generateOutputFiles
};
