/* eslint-disable no-bitwise */
import { createServer } from 'net';
import { pEvent } from 'p-event';
import getPort from 'get-port';
import { QuickJSDebugProtocol, QuickJSDebugSession } from 'quickjs-debugger';
import { resolve as resolvePath, posix } from 'path';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import {
    cachedOutput,
    filterObjectMap,
    isExtendFrom,
    isArraySetEqual,
    sortObjectKey,
    stringComparator,
    kvArrayToObject,
    pause,
    projectRoot,
    testMinecraftVersionInRange,
    log,
    warn
} from '../util/common.js';
import { getDeviceOrWait, pushRecursively } from '../util/adb.js';
import { createExclusiveWSSession, doWSRelatedJobsCached } from './wsconnect.js';

/**
 * Only used in QuickJSDebugSession.evaluate
 * @type {import("@minecraft/server")}
 */
const Minecraft = {};

function parseOrThrow(result) {
    if (typeof result === 'string') {
        return JSON.parse(result);
    }
    throw result;
}

/**
 * @template {string | number} StateName
 * @template {string | number | boolean} StateType
 * @param {Record<StateName,StateType[]>} stateValues 属性可取值列表
 * @param {Record<StateName,StateType>[]} states 最小项列表
 * @param {Record<StateName,StateType>[]} invalidStates 无关项列表（最简状态组列表）
 * @returns {Record<StateName,StateType>[]} 最简状态组列表
 */
function simplifyState(stateValues, states, invalidStates) {
    // 下一代迭代状态组列表
    const updateStates = states.slice();
    // 循环每个属性
    for (const [propName, propValues] of Object.entries(stateValues)) {
        // isExtendFrom(o, p) 可以简单粗暴地认为 o 代表的最小项集合 包含于 p 代表的最小项集合
        // 在此我们定义 o 是 p 的子状态组，而 p 是 o 的父状态组

        // 一个表，键是公共状态组，值是除去当前属性外公共状态组的父状态组列表
        // 一个状态组可以重复出现在不同的父状态组列表中
        // 由于属性遍历在最外层，因此此时所有的状态组（最小项）都必然持有当前属性
        // 所以只要父状态组列表中出现当前属性的值都来了一遍
        // 那说明公共状态组就是父状态组列表中所有状态简化的结果
        // 退一步说，就算真的有星际码农往里面传的不是最小项而是有重叠的状态组
        // 导致某个状态已经被合并过不存在这个属性（即【任意值】）
        // 那请看下文
        const parentMap = new Map();
        // 遍历所有状态组
        for (const state of updateStates) {
            // 去除当前属性的状态组（即当前属性可为任何值的状态组）
            const stateWithoutProp = filterObjectMap(state, (k) => k !== propName);
            // 从公共状态组中寻找 stateWithoutProp 子状态组们
            let foundParents = [...parentMap.keys()].filter((parent) => isExtendFrom(parent, stateWithoutProp));
            if (!foundParents.length) {
                // 很显然，到这里没有找到任何一个公共状态组，使得 stateWithoutProp 是它的父状态组
                // 不过没关系，我们可以把 stateWithoutProp 当成公共状态组
                // 之后找一找新的公共状态组（stateWithoutProp）的父状态组
                // 感谢 parentMap，父状态组的父状态组还是父状态组
                // 只要在 parentMap 中找到某个键是新的公共状态组的父状态组
                // 那么它的值肯定都是新的公共状态组的父状态组
                // 我他妈好像忘记去重了 不过不影响
                const foundValues = [...parentMap.keys()]
                    .filter((parent) => isExtendFrom(stateWithoutProp, parent))
                    .map((key) => parentMap.get(key))
                    .flat(1);
                // 加进去了，好耶
                // 所以 parentMap 的键不存在说靠前的公共状态组是靠后的公共状态组的父状态组的情况
                foundParents = [stateWithoutProp];
                parentMap.set(stateWithoutProp, foundValues);
            }
            for (const parent of foundParents) {
                // 把自己这个状态组加到父状态组列表里去
                const foundValues = parentMap.get(parent);
                foundValues.push(state);
            }
        }
        // 清空状态组列表
        updateStates.length = 0;
        // 未被合并的状态组列表
        const primeStates = [];
        for (const [parent, childStates] of parentMap.entries()) {
            // 一个集合，用来验证是不是该有的值都有了
            const validValues = new Set(propValues);
            // 从无关项列表中找到所有除去当前属性外的公共状态组的父状态组
            const invalidChildren = invalidStates.filter((state) => {
                // 去除当前属性的状态组（即当前属性可为任何值的状态组）
                const stateWithoutProp = filterObjectMap(state, (k) => k !== propName);
                // 是公共状态组的父状态组了
                return isExtendFrom(parent, stateWithoutProp);
            });
            // 检查是否该有的值都有了
            // childStates 中重复的值不影响
            // 接上文，如果出现任意值，就表示所有值都出现过了，因此直接清空
            // invalidChildren 中不可能出现任意值，因为无关项列表与最小项列表不可重叠
            childStates
                .concat(invalidChildren)
                .forEach((state) => {
                    if (propName in state) {
                        validValues.delete(state[propName]);
                    } else {
                        validValues.clear();
                    }
                });
            if (validValues.size > 0) {
                // 不是全都有
                primeStates.push(...childStates);
            } else {
                updateStates.push(parent);
            }
        }
        for (const primeState of primeStates) {
            // 确认一下这个状态组是否已经被合并掉了
            // 顺带去个重（我怎么感觉这个才是重点）
            // 应该可以替换成标记的形式？
            if (!updateStates.find((state) => isExtendFrom(primeState, state))) {
                updateStates.push(primeState);
            }
        }
    }
    return updateStates;
}

function listAllState(stateValues) {
    const loopFields = Object.entries(stateValues).map(([propName, propValues]) => ({
        name: propName,
        validValues: propValues,
        loopIndex: 0,
        loopCount: propValues.length
    }));
    const result = [];
    for (;;) {
        const state = {};
        for (const loopField of loopFields) {
            const value = loopField.validValues[loopField.loopIndex];
            state[loopField.name] = value;
        }
        result.push(state);
        let cursor = loopFields.length - 1;
        while (cursor >= 0) {
            const loopField = loopFields[cursor];
            loopField.loopIndex += 1;
            if (loopField.loopIndex < loopField.loopCount) {
                break;
            } else {
                loopField.loopIndex = 0;
                cursor -= 1;
            }
        }
        if (cursor < 0) break;
    }
    return result;
}

function testResultValid(stateValues, result, states, invalidStates) {
    const allStates = listAllState(stateValues);
    const resultStates = [];
    for (const stateCondition of result) {
        const satisifiedStates = allStates.filter((state) => isExtendFrom(state, stateCondition));
        resultStates.push(...satisifiedStates.filter((state) => !resultStates.includes(state)));
    }
    const isEqual = (a, b) => isExtendFrom(a, b) && isExtendFrom(b, a);
    const isInclusive = states.every((state) => resultStates.find((e) => isEqual(e, state)));
    const stateAndInvalid = states.concat(invalidStates);
    const isExclusive = resultStates.every((state) => stateAndInvalid.find((e) => isEqual(e, state)));
    return isInclusive && isExclusive;
}

function simplifyStateAndCheck(stateValues, tagStates, invalidStates) {
    const simplifiedState = simplifyState(stateValues, tagStates, invalidStates);
    if (!testResultValid(stateValues, simplifiedState, tagStates, invalidStates)) {
        throw new Error('Simplified failed');
    }
    return simplifiedState;
}

const Extractors = [
    {
        name: 'scope',
        timeout: 10000,
        async extract(target, frame) {
            const { tree, flatMap } = parseOrThrow(await frame.evaluate(() => {
                const flatDescMap = {};
                const root = { path: '', value: globalThis, desc: {}, doNotSort: true };
                const nodeQueue = [root];
                const objects = [];
                const objectDesc = [];
                const functionOwnNames = ['name', 'length', 'arguments', 'caller'];
                const nativeFunctionRegex = /\{\s*\[native code\]\s*\}/;
                const defaultProto = {
                    object: Object.prototype,
                    function: Function.prototype
                };
                while (nodeQueue.length) {
                    const { path, value, desc, doNotSort } = nodeQueue.shift();
                    const childPathPrefix = path === '' ? '' : `${path}.`;
                    const type = typeof value;
                    desc.type = type;
                    if (type === 'object' || type === 'function') {
                        if (value === null) {
                            desc.value = null;
                            continue;
                        }
                        const ref = objects.indexOf(value);
                        if (ref >= 0) {
                            delete desc.type;
                            desc.ref = objectDesc[ref].path;
                            flatDescMap[path] = objectDesc[ref].path;
                            continue;
                        }
                        if (type === 'function') {
                            desc.name = value.name;
                            if (nativeFunctionRegex.test(String(value))) {
                                desc.native = true;
                            } else {
                                desc.value = String(value);
                            }
                            desc.length = value.length;
                        }
                        flatDescMap[path] = { ...desc };
                        const proto = Object.getPrototypeOf(value);
                        const keys = Object.getOwnPropertyNames(value);
                        if (!doNotSort) keys.sort();
                        keys.push(...Object.getOwnPropertySymbols(value));
                        keys.forEach((key) => {
                            if (type === 'function' && functionOwnNames.indexOf(key) >= 0) return;
                            const child = {};
                            const descriptor = Object.getOwnPropertyDescriptor(value, key);
                            if (typeof key === 'symbol') {
                                if (!desc.symbolProperties) desc.symbolProperties = {};
                                desc.symbolProperties[key.toString()] = child;
                            } else if (descriptor && descriptor.enumerable) {
                                if (!desc.enumerableProperties) desc.enumerableProperties = {};
                                desc.enumerableProperties[key] = child;
                            } else {
                                if (!desc.properties) desc.properties = {};
                                desc.properties[key] = child;
                            }
                            if (descriptor) {
                                if ('value' in descriptor) {
                                    child.value = {};
                                    nodeQueue.push({
                                        path: `${childPathPrefix}${String(key)}`,
                                        value: descriptor.value,
                                        desc: child.value
                                    });
                                }
                                if (descriptor.writable === false) {
                                    child.readOnly = true;
                                }
                                if (descriptor.get !== undefined) {
                                    child.getter = {};
                                    nodeQueue.push({
                                        path: `${childPathPrefix}${String(key)}.[[Get]]`,
                                        value: descriptor.get,
                                        desc: child.getter
                                    });
                                }
                                if (descriptor.set !== undefined) {
                                    child.setter = {};
                                    nodeQueue.push({
                                        path: `${childPathPrefix}${String(key)}.[[Set]]`,
                                        value: descriptor.set,
                                        desc: child.setter
                                    });
                                }
                                if (!descriptor.configurable) {
                                    child.configurable = false;
                                }
                            }
                        });
                        if (proto === null) {
                            desc.prototype = null;
                        } else if (proto !== defaultProto[type]) {
                            desc.prototype = {};
                            nodeQueue.push({
                                path: `${childPathPrefix}[[Prototype]]`,
                                value: proto,
                                desc: desc.prototype
                            });
                        }
                        try {
                            if (!Object.isExtensible(value)) {
                                if (Object.isFrozen(value)) {
                                    desc.integrity = 'frozen';
                                } else if (Object.isSealed(value)) {
                                    desc.integrity = 'sealed';
                                } else {
                                    desc.integrity = 'preventExtensible';
                                }
                            }
                        } catch (err) {
                            desc.integrity = 'non-object';
                        }
                        objects.push(value);
                        objectDesc.push({ path, desc });
                        continue;
                    }
                    if (type === 'bigint' || type === 'symbol') {
                        desc.value = value.toString();
                    } else {
                        desc.value = value;
                    }
                    flatDescMap[path] = desc;
                }
                return JSON.stringify({ tree: root.desc, flatMap: flatDescMap });
            }));
            delete tree.enumerableProperties.totalTicks;
            delete flatMap.totalTicks;
            target.scopeTree = tree;
            target.scopeKeys = Object.keys(flatMap).sort();
        }
    },
    {
        name: 'commands',
        timeout: 10000,
        async extract(target, frame, session) {
            parseOrThrow(await frame.evaluate(() => {
                const player = [...Minecraft.world.getPlayers()][0];
                async function asyncOp() {
                    const helpMeta = await player.runCommandAsync('help');
                    if (helpMeta.body) {
                        const result = helpMeta.body.split('\n');
                        for (let i = helpMeta.page + 1; i <= helpMeta.pageCount; i++) {
                            const data = await player.runCommandAsync(`help ${i}`);
                            result.push(...data.body.split('\n'));
                        }
                        return result;
                    }
                    return null;
                }
                asyncOp().then((result) => {
                    // eslint-disable-next-line no-console
                    console.info(`[Command Extractor]${JSON.stringify(result)}`);
                }).catch((error) => {
                    // eslint-disable-next-line no-console
                    console.info(`[Command Extractor]ERROR: ${error}`);
                });
                return 'null';
            }));
            session.continue();
            const res = await pEvent(session, 'log', (ev) => ev.message.startsWith('[Command Extractor]'));
            session.pause();
            const ret = res.message.replace('[Command Extractor]', '');
            if (ret.startsWith('ERROR')) {
                throw new Error(ret);
            } else {
                target.commands = JSON.parse(ret);
            }
        }
    },
    {
        name: 'blocks',
        timeout: 60000,
        async extract(target, frame) {
            const blockInfoList = parseOrThrow(await frame.evaluate(() => {
                const blockTypes = Minecraft.BlockTypes.getAll();
                const result = {};
                for (const blockType of blockTypes) {
                    const states = [];
                    const invalidStates = [];
                    const { id: blockId, canBeWaterlogged } = blockType;
                    const basePermutation = Minecraft.BlockPermutation.resolve(blockId);
                    const properties = Object.entries(basePermutation.getAllStates()).map(([name, defaultValue]) => ({
                        name,
                        validValues: Minecraft.BlockStates.get(name).validValues,
                        defaultValue
                    }));
                    properties.sort((a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0));
                    const loopFields = properties.map((property) => ({
                        ...property,
                        loopIndex: 0,
                        loopCount: property.validValues.length
                    }));
                    for (;;) {
                        const state = {};
                        for (const loopField of loopFields) {
                            const value = loopField.validValues[loopField.loopIndex];
                            state[loopField.name] = value;
                        }
                        let permutation = null;
                        try {
                            permutation = Minecraft.BlockPermutation.resolve(blockId, state);
                            if (permutation.type.id !== blockId) {
                                throw new Error('State property invalid');
                            }
                            for (const k of Object.keys(state)) {
                                if (permutation.getState(k) !== state[k]) {
                                    throw new Error('State property invalid');
                                }
                            }
                        } catch (err) {
                            permutation = null;
                            invalidStates.push(state);
                        }
                        // Uncomment to discover where the game crashes
                        // console.info(`Dumping ${blockType.id}${JSON.stringify(state)}`);
                        if (permutation) {
                            const tags = permutation.getTags().slice();
                            const itemStack = permutation.getItemStack();
                            let itemId = itemStack && itemStack.typeId;
                            if (itemId === blockId) {
                                itemId = '<same>';
                            }
                            states.push({ state, tags, itemId });
                        }
                        let cursor = loopFields.length - 1;
                        while (cursor >= 0) {
                            const loopField = loopFields[cursor];
                            loopField.loopIndex += 1;
                            if (loopField.loopIndex < loopField.loopCount) {
                                break;
                            } else {
                                loopField.loopIndex = 0;
                                cursor -= 1;
                            }
                        }
                        if (cursor < 0) break;
                    }
                    result[blockType.id] = { properties, states, invalidStates, canBeWaterlogged };
                }
                return JSON.stringify(result);
            }));
            const blocks = {};
            const blockProperties = {};
            const blockTags = {};
            const blockInfoEntries = Object.entries(blockInfoList).sort((a, b) => stringComparator(a[0], b[0]));
            for (const [blockId, blockType] of blockInfoEntries) {
                const { properties, states, invalidStates, canBeWaterlogged } = blockType;
                const tagMap = {};
                const itemIdMap = {};
                const stateValues = kvArrayToObject(properties.map((e) => [e.name, e.validValues]));
                for (const property of properties) {
                    let propertyDescriptors = blockProperties[property.name];
                    if (!propertyDescriptors) {
                        propertyDescriptors = blockProperties[property.name] = [];
                    }
                    let propertyDescriptor = propertyDescriptors.find(
                        (e) => isArraySetEqual(e.validValues, property.validValues)
                    );
                    if (!propertyDescriptor) {
                        propertyDescriptors.push(propertyDescriptor = {
                            validValues: property.validValues,
                            defaultValue: {}
                        });
                    }
                    propertyDescriptor.defaultValue[blockId] = property.defaultValue;
                }
                for (const state of states) {
                    for (const tag of state.tags) {
                        let tagList = tagMap[tag];
                        if (!tagList) {
                            tagList = tagMap[tag] = [];
                        }
                        tagList.push(state.state);
                    }
                    if (state.itemId) {
                        let itemIdStates = itemIdMap[state.itemId];
                        if (!itemIdStates) {
                            itemIdStates = itemIdMap[state.itemId] = [];
                        }
                        itemIdStates.push(state.state);
                    }
                }
                const itemIds = Object.keys(itemIdMap);
                for (const key of itemIds) {
                    itemIdMap[key] = simplifyStateAndCheck(stateValues, itemIdMap[key], invalidStates);
                }
                blocks[blockId] = {
                    properties,
                    invalidStates: simplifyStateAndCheck(stateValues, invalidStates, []),
                    itemId: itemIds.length > 1 ? itemIdMap : itemIds[0],
                    canBeWaterlogged
                };
                for (const [tagName, tagStates] of Object.entries(tagMap)) {
                    const simplifiedState = simplifyStateAndCheck(stateValues, tagStates, invalidStates);
                    let tagInfo = blockTags[tagName];
                    if (!tagInfo) {
                        tagInfo = blockTags[tagName] = {};
                    }
                    if (simplifiedState.length === 1) {
                        [tagInfo[blockId]] = simplifiedState;
                    } else {
                        tagInfo[blockId] = simplifiedState;
                    }
                }
            }
            target.blocks = blocks;
            target.blockProperties = sortObjectKey(blockProperties);
            target.blockTags = sortObjectKey(blockTags);
        }
    },
    {
        name: 'items',
        timeout: 60000,
        async extract(target, frame) {
            let ItemInfoList;
            try {
                ItemInfoList = parseOrThrow(await frame.evaluate(() => {
                    const result = {};
                    const assign = (o, source, keys) => keys.forEach((k) => (o[k] = source[k]));
                    const enchantmentTypes = Minecraft.EnchantmentTypes.getAll();
                    const enchantments = enchantmentTypes.map((type) => ({ level: type.maxLevel, type }));
                    enchantments.sort((a, b) => (a.type.id > b.type.id ? 1 : a.type.id < b.type.id ? -1 : 0));
                    const itemTypes = Minecraft.ItemTypes.getAll();
                    for (let i = 0; i < itemTypes.length; i++) {
                        const itemType = itemTypes[i];
                        if (itemType.id === 'minecraft:air') {
                            continue;
                        }
                        // Uncomment to discover where the game crashes
                        // console.warn(`Dumping ${itemType.id}`);
                        const itemStack = new Minecraft.ItemStack(itemType);
                        const componentInstances = itemStack.getComponents();
                        const commonComponents = {};
                        const components = {};
                        let hasComponents = false;
                        componentInstances.forEach((component) => {
                            const componentData = {};
                            const componentId = component.typeId;
                            if (component instanceof Minecraft.ItemEnchantableComponent) {
                                const enchantmentSlots = component.slots.filter((e) => e);
                                const existedEnchantments = component.getEnchantments();
                                const applicableEnchantments = enchantments.filter((e) => component.canAddEnchantment(e));
                                if (enchantmentSlots.length > 0) {
                                    componentData.enchantmentSlots = enchantmentSlots;
                                }
                                if (existedEnchantments.length > 0) {
                                    componentData.enchantments = existedEnchantments.map((e) => e.type.id || e.type);
                                }
                                if (applicableEnchantments.length > 0) {
                                    componentData.applicableEnchantments = applicableEnchantments.map((e) => e.type.id);
                                }
                            }
                            if (component instanceof Minecraft.ItemCooldownComponent) {
                                if (component.cooldownTicks > 0) {
                                    assign(componentData, component, ['cooldownCategory', 'cooldownTicks']);
                                }
                            }
                            if (component instanceof Minecraft.ItemDurabilityComponent) {
                                if (component.damage > 0) {
                                    componentData.defaultDamage = component.damage;
                                }
                                assign(componentData, component, ['maxDurability']);
                                const damageChance = component.getDamageChance();
                                if (damageChance !== 100) {
                                    componentData.damageChance = damageChance;
                                }
                            }
                            if (component instanceof Minecraft.ItemFoodComponent) {
                                assign(componentData, component, [
                                    'canAlwaysEat',
                                    'nutrition',
                                    'saturationModifier',
                                    'usingConvertsTo'
                                ]);
                            }
                            components[componentId] = componentData;
                            hasComponents = true;
                        });
                        const maxAmountDefault = itemStack.isStackable ? 64 : 1;
                        result[itemType.id] = {
                            unstackable: itemStack.isStackable ? undefined : true,
                            maxAmount: itemStack.maxAmount !== maxAmountDefault ? itemStack.maxAmount : undefined,
                            tags: [...new Set(itemStack.getTags())],
                            components: hasComponents ? components : undefined,
                            ...commonComponents
                        };
                    }
                    return JSON.stringify(result);
                }));
            } catch (err) {
                warn(`Cannot evaluate code for ItemRegistry: ${err.message}`);
                parseOrThrow(await frame.evaluate(() => {
                    const enchantmentTypes = Minecraft.EnchantmentTypes.getAll();
                    const enchantments = enchantmentTypes.map((type) => ({ level: type.maxLevel, type }));
                    enchantments.sort((a, b) => (a.type.id > b.type.id ? 1 : a.type.id < b.type.id ? -1 : 0));
                    globalThis.__item_extract_enchantments = enchantments;
                    return '"OK"';
                }));
                const length = parseOrThrow(await frame.evaluate(() => {
                    const itemTypes = Minecraft.ItemTypes.getAll();
                    globalThis.__item_extract_itemTypes = itemTypes;
                    return String(itemTypes.length);
                }));
                ItemInfoList = {};
                for (let i = 0; i < length; i++) {
                    try {
                        const [id, value] = parseOrThrow(await frame.evaluate((index) => {
                            const assign = (o, source, keys) => keys.forEach((k) => (o[k] = source[k]));
                            const itemTypes = globalThis.__item_extract_itemTypes;
                            const enchantments = globalThis.__item_extract_enchantments;
                            const itemType = itemTypes[index];
                            if (itemType.id === 'minecraft:air') {
                                return [itemType.id, null];
                            }
                            const itemStack = new Minecraft.ItemStack(itemType);
                            const componentInstances = itemStack.getComponents();
                            const commonComponents = {};
                            const components = {};
                            let hasComponents = false;
                            componentInstances.forEach((component) => {
                                const componentData = {};
                                const componentId = component.typeId;
                                if (component instanceof Minecraft.ItemEnchantableComponent) {
                                    const enchantmentSlots = component.slots.filter((e) => e);
                                    const existedEnchantments = component.getEnchantments();
                                    const applicableEnchantments = enchantments.filter((e) => component.canAddEnchantment(e));
                                    if (enchantmentSlots.length > 0) {
                                        componentData.enchantmentSlots = enchantmentSlots;
                                    }
                                    if (existedEnchantments.length > 0) {
                                        componentData.enchantments = existedEnchantments.map((e) => e.type.id || e.type);
                                    }
                                    if (applicableEnchantments.length > 0) {
                                        componentData.applicableEnchantments = applicableEnchantments.map((e) => e.type.id);
                                    }
                                }
                                if (component instanceof Minecraft.ItemCooldownComponent) {
                                    if (component.cooldownTicks > 0) {
                                        assign(componentData, component, ['cooldownCategory', 'cooldownTicks']);
                                    }
                                }
                                if (component instanceof Minecraft.ItemDurabilityComponent) {
                                    if (component.damage > 0) {
                                        componentData.defaultDamage = component.damage;
                                    }
                                    assign(componentData, component, ['maxDurability']);
                                    const damageChance = component.getDamageChance();
                                    if (damageChance !== 100) {
                                        componentData.damageChance = damageChance;
                                    }
                                }
                                if (component instanceof Minecraft.ItemFoodComponent) {
                                    assign(componentData, component, [
                                        'canAlwaysEat',
                                        'nutrition',
                                        'saturationModifier',
                                        'usingConvertsTo'
                                    ]);
                                }
                                components[componentId] = componentData;
                                hasComponents = true;
                            });
                            const maxAmountDefault = itemStack.isStackable ? 64 : 1;
                            return JSON.stringify([itemType.id, {
                                unstackable: itemStack.isStackable ? undefined : true,
                                maxAmount: itemStack.maxAmount !== maxAmountDefault ? itemStack.maxAmount : undefined,
                                tags: [...new Set(itemStack.getTags())],
                                components: hasComponents ? components : undefined,
                                ...commonComponents
                            }]);
                        }, i));
                        if (value !== null) {
                            ItemInfoList[id] = value;
                        }
                    } catch (err2) {
                        warn(`Cannot evaluate code for Item #${i}: ${err.message}`);
                    }
                }
            }
            const itemIds = Object.keys(ItemInfoList).sort();
            const itemTags = {};
            itemIds.forEach((itemId) => {
                ItemInfoList[itemId].tags.forEach((itemTag) => {
                    let itemTagIds = itemTags[itemTag];
                    if (!itemTagIds) {
                        itemTagIds = itemTags[itemTag] = [];
                    }
                    itemTagIds.push(itemId);
                });
            });
            target.items = sortObjectKey(ItemInfoList);
            target.itemTags = sortObjectKey(itemTags);
        }
    },
    {
        name: 'entities',
        timeout: 10000,
        async extract(target, frame) {
            const EntityInfoList = parseOrThrow(await frame.evaluate(() => {
                const result = {};
                for (const entityType of Minecraft.EntityTypes.getAll()) {
                    result[entityType.id] = {};
                }
                return JSON.stringify(result);
            }));
            const entities = Object.keys(EntityInfoList).sort();
            target.entities = entities;
        }
    },
    {
        name: 'effects',
        timeout: 10000,
        async extract(target, frame) {
            const EffectList = parseOrThrow(await frame.evaluate(() => {
                const result = [];
                for (const effectType of Minecraft.EffectTypes.getAll()) {
                    result.push(effectType.getName());
                }
                return JSON.stringify(result);
            }));
            const effects = EffectList.sort();
            target.effects = effects;
        }
    },
    {
        name: 'dimensions',
        timeout: 10000,
        async extract(target, frame) {
            const DimensionList = parseOrThrow(await frame.evaluate(() => {
                const result = [];
                for (const dimensionType of Minecraft.DimensionTypes.getAll()) {
                    result.push(dimensionType.typeId);
                }
                return JSON.stringify(result);
            }));
            const dimensions = DimensionList.sort();
            target.dimensions = dimensions;
        }
    },
    {
        name: 'biomes',
        timeout: 10000,
        async extract(target, frame) {
            const BiomeList = parseOrThrow(await frame.evaluate(() => {
                const result = [];
                for (const biomeType of Minecraft.BiomeTypes.getAll()) {
                    result.push(biomeType.id);
                }
                return JSON.stringify(result);
            }));
            const biomes = BiomeList.sort();
            target.biomes = biomes;
        }
    },
    {
        name: 'enchantments',
        timeout: 10000,
        async extract(target, frame) {
            const EnchantmentList = parseOrThrow(await frame.evaluate(() => {
                const result = {};
                for (const enchantmentType of Minecraft.EnchantmentTypes.getAll()) {
                    result[enchantmentType.id] = {
                        maxLevel: enchantmentType.maxLevel
                    };
                }
                return JSON.stringify(result);
            }));
            target.enchantments = sortObjectKey(EnchantmentList);
        }
    }
];

const ImportEnvironments = {
    Minecraft: ['mojang-minecraft', '@minecraft/server'],
    GameTest: ['mojang-gametest', '@minecraft/server-gametest'],
    MinecraftUI: ['mojang-minecraft-ui', '@minecraft/server-ui'],
    MinecraftAdmin: ['mojang-minecraft-server-admin', '@minecraft/server-admin'],
    MinecraftNet: ['mojang-minecraft-net', '@minecraft/server-net'],
    MinecraftCommon: ['@minecraft/common'],
    MinecraftEditor: ['@minecraft/server-editor'],
    MinecraftDebugUtilities: ['@minecraft/debug-utilities']
};
/**
 * @param {QuickJSDebugSession} session
 */
async function evaluateExtractors(cx, target, session) {
    const { coreVersion } = cx;
    await session.pause();
    const topFrame = await session.getTopStack();
    await topFrame.evaluate((envKeys) => {
        Promise.allSettled(envKeys.map(
            ([keyName, moduleNames]) => Promise.allSettled(moduleNames.map(
                (moduleName) => import(moduleName)
            )).then((resolutions) => {
                const found = resolutions.find((e) => e.status === 'fulfilled');
                if (found) {
                    globalThis[keyName] = found.value;
                }
            })
        )).then(() => {
            // eslint-disable-next-line no-console
            console.info('###PREPARE_ENV_OK###');
        });
    }, [...Object.entries(ImportEnvironments)]);
    await Promise.all([
        pEvent(session, 'log', (ev) => ev.message.includes('###PREPARE_ENV_OK###')),
        session.continue()
    ]);
    await session.pause();
    const defaultTimeout = session.protocol.requestTimeout;
    const errors = [];
    for (const extractor of Extractors) {
        if (extractor.match && !extractor.match(coreVersion)) continue;
        try {
            log(`Extracting ${extractor.name} from GameTest`);
            session.protocol.requestTimeout = extractor.timeout || defaultTimeout;
            await extractor.extract(target, topFrame, session, cx);
        } catch (err) {
            warn(`Failed to extract ${extractor.name}`, err);
            errors.push(err);
            break;
        }
    }
    await session.continue();
    if (errors.length) {
        throw new AggregateError(errors);
    }
}

function generateBehaviorPack(cx) {
    const { coreVersion } = cx;
    const basePath = resolvePath(projectRoot, 'data', 'gametest_behavior_pack');
    const outPath = resolvePath(projectRoot, 'output', 'scripting_injector');
    const options = JSON.parse(readFileSync(resolvePath(basePath, 'generator.json'), 'utf-8'));
    if (existsSync(outPath)) {
        rmSync(outPath, { recursive: true });
    }
    mkdirSync(outPath);
    const fileMap = {};
    options.staticFiles.forEach((e) => {
        fileMap[e] = e;
    });
    options.versionRelatedFiles.forEach((e) => {
        if (testMinecraftVersionInRange(coreVersion, ...e.range)) {
            fileMap[e.target] = e.path;
        }
    });
    Object.entries(fileMap).forEach(([target, source]) => {
        const targetPath = resolvePath(outPath, target);
        mkdirSync(resolvePath(targetPath, '..'), { recursive: true });
        cpSync(resolvePath(basePath, source), targetPath, { recursive: true });
    });
    return outPath;
}

export default async function analyzeGameTestEnumsCached(cx) {
    const { version, packageVersion, versionInfo } = cx;
    const cacheId = `version.${version}.gametest.all`;
    const cache = cachedOutput(cacheId);
    if (cache && packageVersion === cache.packageVersion) return cache;

    let device;
    if (!versionInfo.disableAdb) {
        device = await getDeviceOrWait();
    }
    const packPath = generateBehaviorPack(cx);
    if (cx.devBehaviorPackPath) {
        for (;;) {
            try {
                if (device) {
                    await pushRecursively(device, packPath, posix.join(cx.devBehaviorPackPath, 'gametest_behavior_pack'));
                } else {
                    const packDest = resolvePath(cx.devBehaviorPackPath, 'gametest_behavior_pack');
                    mkdirSync(packDest, { recursive: true });
                    cpSync(packPath, packDest, { recursive: true });
                }
                break;
            } catch (err) {
                warn(`[GameTest] Cannot grant access to ${cx.devBehaviorPackPath}`);
                await pause('[GameTest] Please clear all the data of Minecraft');
            }
        }
    }
    await pause('Please switch to branch: gametest\nInteract if the device is ready');

    const wsSession = await createExclusiveWSSession(device);
    const server = createServer();
    const port = await getPort({ port: 19144 });
    server.listen(port);
    const socketPromise = pEvent(server, 'connection');
    if (device) {
        await device.reverse('tcp:19144', `tcp:${port}`);
        wsSession.sendCommand('script debugger connect 127.0.0.1 19144');
    } else {
        wsSession.sendCommand(`script debugger connect 127.0.0.1 ${port}`);
    }
    const socket = await socketPromise;
    const debugProtocol = new QuickJSDebugProtocol(socket);
    const debugSession = new QuickJSDebugSession(debugProtocol);
    const target = { packageVersion };
    debugSession.resume();
    await evaluateExtractors(cx, target, debugSession);
    await doWSRelatedJobsCached(cx, wsSession, {});
    debugProtocol.close();
    server.close();
    wsSession.disconnect();
    return cachedOutput(cacheId, target);
}
