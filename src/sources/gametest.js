/* eslint-disable no-bitwise */
import { createServer } from 'net';
import { pEvent } from 'p-event';
import getPort from 'get-port';
import { QuickJSDebugConnection, MinecraftDebugSession } from 'quickjs-debugger';
import { resolve as resolvePath, posix } from 'path';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import {
    cachedOutput,
    isArraySetEqual,
    setStatus,
    sortObjectKey,
    stringComparator,
    kvArrayToObject,
    pause,
    projectRoot,
    testMinecraftVersionInRange,
    log,
    warn,
    sleepAsync
} from '../util/common.js';
import { getDeviceOrWait, pushRecursively } from '../util/adb.js';
import { createExclusiveWSSession, doWSRelatedJobsCached } from './wsconnect.js';

/**
 * Only used in MinecraftDebugSession.evaluate
 * @type {import("@minecraft/server")}
 */
const Minecraft = {};

/**
 * @param {import("quickjs-debugger").QuickJSStackFrame} frame
 */
async function wrapEvaluate(frame, f, args) {
    const serializedArgs = JSON.stringify(args);
    const code = `(()=>{try{return (JSON.stringify((${String(f)})(${serializedArgs})))}catch(e){return e}})()`;
    const errorOrResult = await frame.evaluateExpression(code);
    if (errorOrResult.type !== 'string') {
        throw await errorOrResult.inspect();
    }
    const val = JSON.parse(errorOrResult.primitiveValue);
    return val;
}

function stateToSlots(state, propNames) {
    return propNames.map((name) => state[name]);
}

function slotsToState(slots, propNames) {
    return kvArrayToObject(
        slots
            .map((v, i) => [propNames[i], v])
            .filter(([, v]) => v !== undefined)
    );
}

function slotsMatchPattern(input, pattern) {
    return pattern.every((e, i) => e === undefined || input[i] === e);
}

function slotsEquals(a, b) {
    return a.every((e, i) => e === b[i]);
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
    const propNames = Object.keys(stateValues);
    // 无关项状态组列表
    const invStates = invalidStates.map((s) => stateToSlots(s, propNames));
    // 下一代迭代状态组列表
    const updateStates = states.map((s) => stateToSlots(s, propNames));
    // 循环每个属性
    for (let propIndex = 0; propIndex < propNames.length; propIndex += 1) {
        const propName = propNames[propIndex];
        // slotsMatchPattern(o, p) 可以简单粗暴地认为 o 代表的最小项集合 包含于 p 代表的最小项集合
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
            const stateWithoutProp = [...state];
            stateWithoutProp[propIndex] = undefined;
            // 从公共状态组中寻找 stateWithoutProp 子状态组们
            let foundParents = [...parentMap.keys()].filter((parent) => slotsMatchPattern(parent, stateWithoutProp));
            if (!foundParents.length) {
                // 很显然，到这里没有找到任何一个公共状态组，使得 stateWithoutProp 是它的父状态组
                // 不过没关系，我们可以把 stateWithoutProp 当成公共状态组
                // 之后找一找新的公共状态组（stateWithoutProp）的父状态组
                // 感谢 parentMap，父状态组的父状态组还是父状态组
                // 只要在 parentMap 中找到某个键是新的公共状态组的父状态组
                // 那么它的值肯定都是新的公共状态组的父状态组
                // 我他妈好像忘记去重了 不过不影响
                const foundValues = [...parentMap.keys()]
                    .filter((parent) => slotsMatchPattern(stateWithoutProp, parent))
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
        // 提前缓存无关项列表除去当前属性外的公共状态组
        const invWithoutProp = invStates.map((state) => {
            // 去除当前属性的状态组（即当前属性可为任何值的状态组）
            const stateWithoutProp = [...state];
            stateWithoutProp[propIndex] = undefined;
            return stateWithoutProp;
        });
        // 未被合并的状态组列表
        const primeStates = [];
        for (const [parent, childStates] of parentMap.entries()) {
            // 一个集合，用来验证是不是该有的值都有了
            const validValues = new Set(stateValues[propName]);
            // 从无关项列表中找到所有除去当前属性外的公共状态组的父状态组
            const invalidChildren = invWithoutProp.filter((state) => slotsMatchPattern(parent, state));
            // 检查是否该有的值都有了
            // childStates 中重复的值不影响
            // 接上文，如果出现任意值，就表示所有值都出现过了，因此直接清空
            // invalidChildren 中不可能出现任意值，因为无关项列表与最小项列表不可重叠
            childStates
                .concat(invalidChildren)
                .forEach((state) => {
                    if (state[propIndex] !== undefined) {
                        validValues.delete(state[propIndex]);
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
            if (!updateStates.find((state) => slotsMatchPattern(primeState, state))) {
                updateStates.push(primeState);
            }
        }
    }
    return updateStates.map((s) => slotsToState(s, propNames));
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
    const propNames = Object.keys(stateValues);
    const allStates = listAllState(stateValues).map((state) => stateToSlots(state, propNames));
    const inputStates = new Set();
    for (const state of states) {
        const stateSlots = stateToSlots(state, propNames);
        inputStates.add(allStates.find((s) => slotsEquals(s, stateSlots)));
    }
    const inputStatesWithInvalid = new Set(inputStates);
    for (const stateCondition of invalidStates) {
        const stateConditionPattern = stateToSlots(stateCondition, propNames);
        const satisifiedStates = allStates.filter((state) => slotsMatchPattern(state, stateConditionPattern));
        satisifiedStates.forEach((s) => inputStatesWithInvalid.add(s));
    }
    const resultStates = new Set();
    for (const stateCondition of result) {
        const stateConditionPattern = stateToSlots(stateCondition, propNames);
        const satisifiedStates = allStates.filter((state) => slotsMatchPattern(state, stateConditionPattern));
        satisifiedStates.forEach((s) => resultStates.add(s));
    }
    const isInclusive = [...inputStates].every((state) => resultStates.has(state));
    const isExclusive = [...resultStates].every((state) => inputStatesWithInvalid.has(state));
    return isInclusive && isExclusive;
}

function simplifyStateAndCheck(stateValues, tagStates, invalidStates) {
    const simplifiedState = simplifyState(stateValues, tagStates, invalidStates);
    if (!testResultValid(stateValues, simplifiedState, tagStates, invalidStates)) {
        throw new Error('Simplified failed');
    }
    return simplifiedState;
}

/**
 * @param {MinecraftDebugSession} session
 */
function createPauseController(session, breakpoints) {
    if (breakpoints) {
        const applyBreakpoints = (enable) => {
            const perFileMap = {};
            for (const { file, line } of breakpoints) {
                const fileBreakpoints = perFileMap[file] ?? (perFileMap[file] = []);
                fileBreakpoints.push({ line });
            }
            for (const [fileName, fileBreakpoints] of Object.entries(perFileMap)) {
                session.setBreakpoints(fileName, enable ? fileBreakpoints : []);
            }
        };
        return {
            pause: async () => {
                applyBreakpoints(true);
                await Promise.all([
                    session.continue(),
                    pEvent(session, 'stopped')
                ]);
            },
            continue: async () => {
                applyBreakpoints(false);
                await session.continue();
            }
        };
    }
    return {
        pause: () => session.pause(),
        continue: () => session.continue()
    };
}

const Extractors = [
    {
        name: 'scope',
        timeout: 10000,
        async extract({ target, frame }) {
            const { tree, flatMap } = await wrapEvaluate(frame, () => {
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
                return { tree: root.desc, flatMap: flatDescMap };
            });
            delete tree.enumerableProperties.totalTicks;
            delete flatMap.totalTicks;
            target.scopeTree = tree;
            target.scopeKeys = Object.keys(flatMap).sort();
        }
    },
    {
        name: 'commands',
        timeout: 10000,
        async extract({ target, frame, session, controller }) {
            await wrapEvaluate(frame, () => {
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
                return null;
            });
            const [res] = await Promise.all([
                pEvent(session, 'log', (ev) => ev.message.startsWith('[Command Extractor]')),
                controller.continue()
            ]);
            await controller.pause();
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
        async extract({ target, frame }) {
            const blockInfoList = await wrapEvaluate(frame, () => {
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
                return result;
            });
            const blocks = {};
            const blockProperties = {};
            const blockTags = {};
            const blockInfoEntries = Object.entries(blockInfoList).sort((a, b) => stringComparator(a[0], b[0]));
            let index = 0;
            for (const [blockId, blockType] of blockInfoEntries) {
                setStatus(`[${++index}/${blockInfoEntries.length} ${((index / blockInfoEntries.length) * 100).toFixed(1)}%] Processing block states for ${blockId}`);
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
            setStatus('');
            target.blocks = blocks;
            target.blockProperties = sortObjectKey(blockProperties);
            target.blockTags = sortObjectKey(blockTags);
        }
    },
    {
        name: 'items',
        timeout: 60000,
        async extract({ target, frame }) {
            let ItemInfoList;
            await wrapEvaluate(frame, () => {
                const enchantmentTypes = Minecraft.EnchantmentTypes.getAll();
                const enchantments = enchantmentTypes.map((type) => ({ level: type.maxLevel, type }));
                enchantments.sort((a, b) => (a.type.id > b.type.id ? 1 : a.type.id < b.type.id ? -1 : 0));
                globalThis.__item_extract_enchantments = enchantments;
                return '"OK"';
            });
            const length = await wrapEvaluate(frame, () => {
                const itemTypes = Minecraft.ItemTypes.getAll();
                globalThis.__item_extract_itemTypes = itemTypes;
                return String(itemTypes.length);
            });
            await wrapEvaluate(frame, () => {
                const assign = (o, source, keys) => keys.forEach((k) => (o[k] = source[k]));
                const enchantments = globalThis.__item_extract_enchantments;
                globalThis.__item_extract_dump = (itemType) => {
                    if (itemType.id === 'minecraft:air') {
                        return [itemType.id, null];
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
                        if (component instanceof Minecraft.ItemPotionComponent) {
                            componentData.potionEffectType = component.potionEffectType.id;
                            componentData.potionLiquidType = component.potionLiquidType.id;
                            componentData.potionModifierType = component.potionModifierType.id;
                        }
                        if (component instanceof Minecraft.ItemDyeableComponent) {
                            assign(componentData, component, [
                                'color',
                                'defaultColor'
                            ]);
                        }
                        if (component instanceof Minecraft.ItemCompostableComponent) {
                            assign(componentData, component, ['compostingChance']);
                        }
                        components[componentId] = componentData;
                        hasComponents = true;
                    });
                    const maxAmountDefault = itemStack.isStackable ? 64 : 1;
                    return [
                        itemType.id,
                        {
                            unstackable: itemStack.isStackable ? undefined : true,
                            maxAmount: itemStack.maxAmount !== maxAmountDefault ? itemStack.maxAmount : undefined,
                            tags: [...new Set(itemStack.getTags())],
                            components: hasComponents ? components : undefined,
                            ...commonComponents
                        }
                    ];
                };
                return '"OK"';
            });
            try {
                ItemInfoList = await wrapEvaluate(frame, () => {
                    const result = {};
                    const itemTypes = globalThis.__item_extract_itemTypes;
                    const dump = globalThis.__item_extract_dump;
                    for (let i = 0; i < itemTypes.length; i++) {
                        const [id, value] = dump(itemTypes[i]);
                        if (value !== null) {
                            result[id] = value;
                        }
                    }
                    return result;
                });
            } catch (err) {
                warn(`Cannot evaluate code for item registry: ${err.message}`);
                ItemInfoList = {};
                let corruptedCount = 0;
                for (let i = 0; i < length; i++) {
                    try {
                        const [id, value] = await wrapEvaluate(frame, (index) => {
                            const itemTypes = globalThis.__item_extract_itemTypes;
                            const dump = globalThis.__item_extract_dump;
                            return dump(itemTypes[index]);
                        }, i);
                        if (value !== null) {
                            ItemInfoList[id] = value;
                        }
                        setStatus(`[${i}/${length} ${((i / length) * 100).toFixed(1)}%] Item #${i} analyzed: ${id}`);
                    } catch (err2) {
                        warn(`Cannot evaluate code for item #${i}: ${err.message}`);
                        corruptedCount += 1;
                    }
                }
                if (corruptedCount > 0 && target.items) {
                    const removedItems = Object.keys(target.items).filter((k) => !(k in ItemInfoList));
                    for (const item of removedItems.splice(0, removedItems.length)) {
                        try {
                            const [id, value] = await wrapEvaluate(frame, (itemId) => {
                                const dump = globalThis.__item_extract_dump;
                                const itemType = Minecraft.ItemTypes.get(itemId);
                                if (!itemType) throw new Error(`Cannot find item ${itemId}`);
                                if (itemType.id !== itemId) throw new Error(`Item id mismatched: ${itemId}`);
                                return dump(itemType);
                            }, item);
                            if (value !== null) {
                                ItemInfoList[id] = value;
                            }
                            corruptedCount -= 1;
                            setStatus(`Item fixed: ${id}`);
                        } catch (err2) {
                            warn(`Failed to fix item ${item}: ${err.message}`);
                            removedItems.push(item);
                        }
                    }
                    if (removedItems.length === corruptedCount) {
                        removedItems.forEach((k) => {
                            ItemInfoList[k] = target.items[k];
                        });
                    } else if (corruptedCount > 0) {
                        warn(`Cannot fix ${corruptedCount} corrupted items: ${removedItems.length} item(s) removed`);
                    }
                }
                setStatus('');
            }
            await wrapEvaluate(frame, () => {
                delete globalThis.__item_extract_enchantments;
                delete globalThis.__item_extract_itemTypes;
                delete globalThis.__item_extract_dump;
                return '"OK"';
            });
            const itemIds = Object.keys(ItemInfoList).sort();
            const itemTags = {};
            itemIds.forEach((itemId) => {
                const itemInfo = ItemInfoList[itemId];
                if (itemInfo.components) {
                    itemInfo.components = sortObjectKey(itemInfo.components);
                }
                itemInfo.tags.forEach((itemTag) => {
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
        async extract({ target, frame }) {
            const EntityInfoList = await wrapEvaluate(frame, () => {
                const result = {};
                for (const entityType of Minecraft.EntityTypes.getAll()) {
                    result[entityType.id] = {};
                }
                return result;
            });
            const entities = Object.keys(EntityInfoList).sort();
            target.entities = entities;
        }
    },
    {
        name: 'effects',
        timeout: 10000,
        async extract({ target, frame }) {
            const EffectList = await wrapEvaluate(frame, () => {
                const result = [];
                for (const effectType of Minecraft.EffectTypes.getAll()) {
                    result.push(effectType.getName());
                }
                return result;
            });
            const effects = EffectList.sort();
            target.effects = effects;
        }
    },
    {
        name: 'dimensions',
        timeout: 10000,
        async extract({ target, frame }) {
            const DimensionList = await wrapEvaluate(frame, () => {
                const result = [];
                for (const dimensionType of Minecraft.DimensionTypes.getAll()) {
                    result.push(dimensionType.typeId);
                }
                return result;
            });
            const dimensions = DimensionList.sort();
            target.dimensions = dimensions;
        }
    },
    {
        name: 'biomes',
        timeout: 10000,
        async extract({ target, frame }) {
            const BiomeList = await wrapEvaluate(frame, () => {
                const result = [];
                for (const biomeType of Minecraft.BiomeTypes.getAll()) {
                    result.push(biomeType.id);
                }
                return result;
            });
            const biomes = BiomeList.sort();
            target.biomes = biomes;
        }
    },
    {
        name: 'enchantments',
        timeout: 10000,
        async extract({ target, frame }) {
            const EnchantmentList = await wrapEvaluate(frame, () => {
                const result = {};
                for (const enchantmentType of Minecraft.EnchantmentTypes.getAll()) {
                    result[enchantmentType.id] = {
                        maxLevel: enchantmentType.maxLevel
                    };
                }
                return result;
            });
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
 * @param {MinecraftDebugSession} session
 */
async function evaluateExtractors(cx, target, session, controller) {
    const { coreVersion } = cx;
    await controller.pause();
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
        controller.continue()
    ]);
    await controller.pause();
    const defaultTimeout = session.connection.requestTimeout;
    const errors = [];
    for (const extractor of Extractors) {
        if (extractor.match && !extractor.match(coreVersion)) continue;
        try {
            log(`Extracting ${extractor.name} from GameTest`);
            session.connection.requestTimeout = extractor.timeout || defaultTimeout;
            await extractor.extract({ target, frame: topFrame, session, controller, cx });
        } catch (err) {
            warn(`Failed to extract ${extractor.name}`, err);
            errors.push(err);
        }
    }
    await controller.continue();
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
    options.files.forEach((e) => {
        if (!e.range || testMinecraftVersionInRange(coreVersion, ...e.range)) {
            fileMap[e.target] = e;
        }
    });
    const breakpoints = [];
    Object.entries(fileMap).forEach(([target, fileInfo]) => {
        const targetPath = resolvePath(outPath, target);
        mkdirSync(resolvePath(targetPath, '..'), { recursive: true });
        cpSync(resolvePath(basePath, fileInfo.path), targetPath, { recursive: true });
        if (fileInfo.breakpoints) {
            breakpoints.push(...fileInfo.breakpoints);
        }
    });
    return {
        path: outPath,
        moduleUuid: options.moduleUuid,
        breakpoints
    };
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
    const { path: packPath, moduleUuid: targetModuleUuid, breakpoints } = generateBehaviorPack(cx);
    if (cx.devBehaviorPackPath) {
        let warningShown = false;
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
                if (!warningShown) {
                    warn(`[GameTest] Cannot grant access to ${cx.devBehaviorPackPath}`);
                    warningShown = true;
                }
                setStatus('[GameTest] Please clear all the data of Minecraft');
                await sleepAsync(1000);
            }
        }
        if (warningShown) {
            setStatus('');
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
    // Provide cache for infering corrupted items, but not affecting output (not owned by target)
    const target = Object.assign(Object.create(cache ?? {}), { packageVersion });
    const debugConn = new QuickJSDebugConnection(socket);
    const debugSession = new MinecraftDebugSession(debugConn);
    debugSession.on('protocol', (ev) => {
        target.protocolVersion = debugConn.requestVersion = ev.version;
        debugSession.setProtocolInfo({ version: ev.version, targetModuleUuid });
    });
    await pEvent(debugSession, 'protocol');
    debugSession.setStopOnException(false);
    debugSession.resume();
    const controller = createPauseController(debugSession, breakpoints);
    await evaluateExtractors(cx, target, debugSession, controller);
    await doWSRelatedJobsCached(cx, wsSession, {});
    debugConn.close();
    server.close();
    wsSession.disconnect();
    return cachedOutput(cacheId, target);
}
