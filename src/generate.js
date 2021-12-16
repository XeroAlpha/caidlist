const fs = require("fs");
const nodePath = require("path");
const JSON = require("comment-json");
const { analyzePackageDataEnumsCached } = require("./sources/applicationPackage");
const { analyzeAutocompletionEnumsCached } = require("./sources/autocompletion");
const { fetchStandardizedTranslation } = require("./sources/wiki");
const { fetchJavaEditionLangData } = require("./sources/javaEdition");
const {
    loadUserTranslation,
    saveUserTranslation
} = require("./sources/userTranslation");
const { matchTranslations } = require("./util/templateMatch");
const { writeTransMapsExcel } = require("./generate/excel");
const { writeTransMapTextZip } = require("./generate/text");
const {
    writeTransMapJson,
    writeTransMapIndexJson
} = require("./generate/json");
const {
    projectPath,
    cachedOutput,
    forEachObject,
    filterObjectMap,
    replaceObjectKey,
    keyArrayToObject,
    objectToArray,
    testMinecraftVersionInRange,
    cascadeMap,
    removeMinecraftNamespace,
    setInlineCommentAfterField
} = require("./util/common");
const config = require("../data/config");

const branchNameMap = {
    vanilla: "原版",
    education: "教育版",
    experiment: "实验性玩法",
    translator: "翻译专用"
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
async function generateBranchedOutputFiles(cx) {
    const { version, branch, packageVersion } = cx;
    let packageDataEnums = analyzePackageDataEnumsCached(cx);
    let autocompletedEnums = await analyzeAutocompletionEnumsCached(cx);
    let enums = {
        ...packageDataEnums.data[branch.id],
        ...autocompletedEnums
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
    if (testMinecraftVersionInRange(packageVersion, "1.18.0.21", "*")) {
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
    cachedOutput(`output.translation.${version}.${branch.id}`, translationStateMaps);
    let renamedTranslationResultMaps = replaceObjectKey(translationResultMaps, [
        [/[A-Z]/g, (match, offset) => (offset > 0 ? "_" : "") + match.toLowerCase()], // camelCase -> snake_case
        ["enchant", "enchant_type"],
        ["location", "structure"]
    ]);
    fs.writeFileSync(projectPath(`output.clib.${version}.${branch.id}`), JSON.stringify({
        name: "ID表补丁包（" + branchNameMap[branch.id] + "）",
        author: "CA制作组",
        description: "该命令库将旧ID表替换为更新的版本。",
        uuid: "4b2612c7-3d53-46b5-9b0c-dd1f447d3ee7",
        version: [0, 0, 1],
        require: [],
        minSupportVer: "0.7.4",
        targetSupportVer: packageVersion,
        mode: "overwrite",
        enums: renamedTranslationResultMaps
    }, null, "\t"));
    writeTransMapsExcel(
        projectPath(`output.translation.${version}.${branch.id}`, "xlsx"),
        translationResultMaps
    );
    writeTransMapTextZip(cx, {
        outputFile: projectPath(`output.web.${version}.${branch.id}`, "zip"),
        branchNameMap: branchNameMap[branch.id],
        version: packageVersion,
        originalEnums: enums,
        transMaps: translationResultMaps,
        transMapNames: defaultTransMapNames,
        stdTransMap: standardizedTranslation,
        stdTransMapNames
    });
    writeTransMapJson(cx, {
        outputFile: projectPath(`output.web.${version}.${branch.id}`, "json"),
        branchNameMap: branchNameMap[branch.id],
        version: packageVersion,
        originalEnums: enums,
        transMaps: translationResultMaps,
        transMapNames: defaultTransMapNames
    });
    saveUserTranslation(userTranslation);
}

async function generateTranslatorHelperFiles(cx) {
    let packageDataEnums = analyzePackageDataEnumsCached(cx);
    let standardizedTranslation = await fetchStandardizedTranslation();
    let bedrockEditionLang = packageDataEnums.lang;
    let javaEditionLang = await fetchJavaEditionLangData();
    let transMaps = {
        ...standardizedTranslation,
        BedrockEditionLang: bedrockEditionLang,
        JavaEditionLang: javaEditionLang
    };
    let transMapNames = [
        ...stdTransMapNames,
        [ "BedrockEditionLang", "基岩版语言文件" ],
        [ "JavaEditionLang", "Java版语言文件" ]
    ];
    writeTransMapTextZip(cx, {
        outputFile: projectPath(`output.web.${cx.version}.translator`, "zip"),
        transMaps,
        transMapNames
    });
    writeTransMapJson(cx, {
        outputFile: projectPath(`output.web.${cx.version}.translator`, "json"),
        transMaps,
        transMapNames
    });
}

const branchDescriptionMap = {
    vanilla: "使用默认设置创建的世界的ID表",
    education: "启用了教育版选项后创建的世界的ID表",
    experiment: "启用了所有实验性玩法选项后创建的世界的ID表",
    translator: "为翻译英文文本设计，包含了标准化译名表与语言文件"
};
const versionDescriptionMap = {
    beta: {
        id: "beta",
        name: "测试版",
        sortOrder: 0
    },
    release: {
        id: "release",
        name: "正式版",
        sortOrder: 1
    },
    netease: {
        id: "netease",
        name: "中国版",
        sortOrder: 2
    }
};
function generateOutputIndex(cx) {
    const { version } = cx;
    cx.packageInfo = cx.packageVersions[version];
    if (!cx.packageInfo) throw new Error("Unknown version: " + version);
    cx.packageVersion = cx.packageInfo.version;
    if (cx.packageInfo.config) {
        forEachObject(cx.packageInfo.config, (v, k) => {
            cx[k] = v;
        });
    }
    let branchList = cx.packageInfo.branches.map(id => {
        return {
            id,
            name: branchNameMap[id],
            description: branchDescriptionMap[id]
        };
    });
    writeTransMapIndexJson(cx, {
        outputFile: projectPath(`output.web.${version}.index`),
        mergedFile: projectPath(`output.web.index`),
        rootUrl: "./data",
        branchList,
        versionDescription: versionDescriptionMap[version]
    });
    return branchList;
}

async function generateOutputFiles(cx) {
    if (cx.branch.id == "translator") {
        return await generateTranslatorHelperFiles(cx);
    } else {
        return await generateBranchedOutputFiles(cx);
    }
}

module.exports = {
    generateOutputIndex,
    generateOutputFiles
};