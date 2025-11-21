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
    return Object.fromEntries(slots.map((v, i) => [propNames[i], v]).filter(([, v]) => v !== undefined));
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
            childStates.concat(invalidChildren).forEach((state) => {
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

function simplifyStateAndCheckTrimmed(stateValues, tagStates, invalidStates) {
    const simplifiedState = simplifyStateAndCheck(stateValues, tagStates, invalidStates);
    if (simplifiedState.length === 1) {
        return simplifiedState[0];
    }
    return simplifiedState;
}

function findAliasState(stateValues, invalidStates) {
    const propNames = Object.keys(stateValues);
    const allStates = listAllState(stateValues).map((state) => stateToSlots(state, propNames));
    const invalidStateSlots = invalidStates.map((state) => stateToSlots(state, propNames));
    const validStates = allStates.filter((s) => invalidStateSlots.every((e) => !slotsMatchPattern(s, e)));
    const mappings = [];
    for (let i = 0; i < propNames.length; i++) {
        if (mappings.some((e) => e[i] !== undefined)) continue;
        const mappingGroups = new Map();
        const currentProp = propNames[i];
        for (const stateValue of stateValues[currentProp]) {
            mappingGroups.set(
                stateValue,
                propNames.map(() => new Set())
            );
        }
        for (const state of validStates) {
            for (let j = 0; j < propNames.length; j++) {
                if (i === j) continue;
                mappingGroups.get(state[i])[j].add(state[j]);
            }
        }
        let wellMapped = true;
        const mapping = propNames.map(() => []);
        for (const [stateValue, valueSetSlots] of mappingGroups.entries()) {
            const mappedValueSlots = valueSetSlots.map((e) => (e.size === 1 ? [...e][0] : undefined));
            if (mappedValueSlots.every((e) => e === undefined)) {
                wellMapped = false;
                break;
            }
            for (let j = 0; j < propNames.length; j++) {
                if (i === j) {
                    mapping[i].push(stateValue);
                } else if (mappedValueSlots[j] !== undefined) {
                    mapping[j].push(mappedValueSlots[j]);
                }
            }
        }
        if (!wellMapped) continue;
        for (let j = 0; j < propNames.length; j++) {
            if (mapping[j].length < 2 || new Set(mapping[j]).size !== mapping[j].length) {
                mapping[j] = undefined;
            }
        }
        const mappingCount = mapping.filter((e) => e !== undefined).length;
        if (mappingCount >= 2) {
            mappings.push(mapping);
        }
    }
    return mappings.map((e) => slotsToState(e, propNames));
}

function removeAliasStates(invalidStates, aliasStates) {
    return invalidStates.filter((state) => {
        for (const aliasStateGroup of aliasStates) {
            let hasAllKeys = true;
            let matchedIndex = -1;
            for (const [key, values] of Object.entries(aliasStateGroup)) {
                const val = state[key];
                const valIndex = val !== undefined ? values.indexOf(val) : -1;
                if (val === undefined || valIndex === -1) {
                    hasAllKeys = false;
                    break;
                }
                if (matchedIndex === -1) {
                    matchedIndex = valIndex;
                } else if (matchedIndex !== valIndex) {
                    matchedIndex = -1;
                    break;
                }
            }
            if (hasAllKeys && matchedIndex === -1) {
                return false;
            }
        }
        return true;
    });
}

function extractValidStateOverrides(stateValues, invalidStates) {
    const validStateOverrides = {};
    const filteredInvalidStates = new Set(invalidStates);
    for (const [name, values] of Object.entries(stateValues)) {
        const validValues = new Set(values);
        for (const permutation of invalidStates) {
            const keys = Object.keys(permutation);
            if (keys.length === 1 && keys[0] === name) {
                validValues.delete(permutation[name]);
                filteredInvalidStates.delete(permutation);
            }
        }
        if (validValues.size < values.length) {
            validStateOverrides[name] = [...validValues];
        }
    }
    return [validStateOverrides, [...filteredInvalidStates]];
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
                await Promise.all([session.continue(), pEvent(session, 'stopped')]);
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
        name: 'enchantment-check',
        timeout: 10000,
        async extract({ frame }) {
            const enchantmentSlots = await wrapEvaluate(frame, () => {
                const enchantmentSlotNames = [];
                for (const name of Object.getOwnPropertyNames(Minecraft.EnchantmentSlot)) {
                    enchantmentSlotNames.push(name);
                }
                return enchantmentSlotNames;
            });
            if (enchantmentSlots.length === 0) {
                log(`[Warning] EnchantmentSlot = {}, please restart level`);
                throw new Error(`Invalid environment: EnchantmentSlot has no member`);
            }
        }
    },
    {
        name: 'scope',
        timeout: 10000,
        async extract({ target, frame }) {
            const { tree, flatMap } = await wrapEvaluate(frame, () => {
                const flatDescMap = {};
                const root = {
                    path: '',
                    value: globalThis,
                    desc: {},
                    doNotSort: true
                };
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
                        } catch {
                            desc.integrity = 'non-object';
                        }
                        objects.push(value);
                        objectDesc.push({ path, desc });
                        continue;
                    }
                    if (type === 'bigint' || type === 'symbol' || (type === 'number' && !Number.isFinite(value))) {
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
                    const helpMeta = player.runCommand('help');
                    if (helpMeta.body) {
                        const result = helpMeta.body.split('\n');
                        for (let i = helpMeta.page + 1; i <= helpMeta.pageCount; i++) {
                            const data = player.runCommand(`help ${i}`);
                            result.push(...data.body.split('\n'));
                        }
                        return result;
                    }
                    return null;
                }
                asyncOp()
                    .then((result) => {
                        console.info(`[Command Extractor]${JSON.stringify(result)}`);
                    })
                    .catch((error) => {
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
            const { blockInfo, blockStateInfo } = await wrapEvaluate(frame, () => {
                const blockTypes = Minecraft.BlockTypes.getAll();
                const liquidTypes = Object.keys(Minecraft.LiquidType);
                const blockInfo = {};
                for (const blockType of blockTypes) {
                    const states = [];
                    const invalidStates = [];
                    const { id: blockId } = blockType;
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
                        } catch {
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
                            const canContainLiquid = [];
                            const liquidInteractPattern = {};
                            for (const liquidType of liquidTypes) {
                                if (permutation.canContainLiquid(liquidType)) {
                                    canContainLiquid.push(liquidType);
                                }
                                const interactPattern = [];
                                if (permutation.isLiquidBlocking(liquidType)) {
                                    interactPattern.push('blocking');
                                }
                                if (permutation.canBeDestroyedByLiquidSpread(liquidType)) {
                                    interactPattern.push('broken');
                                }
                                if (permutation.liquidSpreadCausesSpawn(liquidType)) {
                                    interactPattern.push('popped');
                                }
                                liquidInteractPattern[liquidType] =
                                    interactPattern.length > 0 ? interactPattern.join(', ') : 'none';
                            }
                            states.push({
                                state,
                                tags,
                                itemId,
                                canContainLiquid,
                                liquidInteractPattern
                            });
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
                    blockInfo[blockType.id] = {
                        properties,
                        states,
                        invalidStates
                    };
                }
                const blockStates = Minecraft.BlockStates.getAll();
                const blockStateInfo = {};
                for (const blockState of blockStates) {
                    blockStateInfo[blockState.id] = {
                        validValues: blockState.validValues
                    };
                }
                return { blockInfo, blockStateInfo };
            });
            const blocks = {};
            const blockProperties = {};
            const blockTags = {};
            const containLiquidMap = {};
            const liquidInteractMap = {};
            const blockInfoEntries = Object.entries(blockInfo).sort((a, b) => stringComparator(a[0], b[0]));
            let index = 0;
            for (const [propertyName, property] of Object.entries(blockStateInfo)) {
                blockProperties[propertyName] = [
                    {
                        validValues: property.validValues,
                        defaultValue: {}
                    }
                ];
            }
            for (const [blockId, blockType] of blockInfoEntries) {
                setStatus(
                    `[${++index}/${blockInfoEntries.length} ${((index / blockInfoEntries.length) * 100).toFixed(1)}%] Processing block states for ${blockId}`
                );
                const { properties, states, invalidStates } = blockType;
                const tagMap = {};
                const itemIdMap = {};
                const stateValues = Object.fromEntries(properties.map((e) => [e.name, e.validValues]));
                const aliasStates = findAliasState(stateValues, invalidStates);
                const simplifiedInvalidStates = simplifyStateAndCheck(stateValues, invalidStates, []);
                const [validStateOverrides, filteredInvalidStates] = extractValidStateOverrides(
                    stateValues,
                    simplifiedInvalidStates
                );
                for (const property of properties) {
                    let propertyDescriptors = blockProperties[property.name];
                    if (!propertyDescriptors) {
                        propertyDescriptors = blockProperties[property.name] = [];
                    }
                    let propertyDescriptor = propertyDescriptors.find((e) =>
                        isArraySetEqual(e.validValues, property.validValues)
                    );
                    if (!propertyDescriptor) {
                        propertyDescriptor = {
                            validValues: property.validValues,
                            defaultValue: {},
                            hidden: true
                        };
                        propertyDescriptors.push(propertyDescriptor);
                    }
                    propertyDescriptor.defaultValue[blockId] = property.defaultValue;
                }
                const containLiquidStateMap = {};
                const liquidInteractStateMap = {};
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
                    for (const liquidType of state.canContainLiquid) {
                        let containLiquidStates = containLiquidStateMap[liquidType];
                        if (!containLiquidStates) {
                            containLiquidStates = containLiquidStateMap[liquidType] = [];
                        }
                        containLiquidStates.push(state.state);
                    }
                    for (const [liquidType, interactPattern] of Object.entries(state.liquidInteractPattern)) {
                        let interactPatternMap = liquidInteractStateMap[liquidType];
                        if (!interactPatternMap) {
                            interactPatternMap = liquidInteractStateMap[liquidType] = {};
                        }
                        let interactPatternStates = interactPatternMap[interactPattern];
                        if (!interactPatternStates) {
                            interactPatternStates = interactPatternMap[interactPattern] = [];
                        }
                        interactPatternStates.push(state.state);
                    }
                }
                const itemIds = Object.keys(itemIdMap);
                for (const key of itemIds) {
                    itemIdMap[key] = simplifyStateAndCheckTrimmed(stateValues, itemIdMap[key], simplifiedInvalidStates);
                }
                blocks[blockId] = {
                    properties,
                    aliasStates: aliasStates.length > 0 ? aliasStates : undefined,
                    validStateOverrides: Object.keys(validStateOverrides).length > 0 ? validStateOverrides : undefined,
                    invalidStates: removeAliasStates(filteredInvalidStates, aliasStates),
                    itemId: itemIds.length > 1 ? itemIdMap : itemIds[0]
                };
                for (const [tagName, tagStates] of Object.entries(tagMap)) {
                    let tagInfo = blockTags[tagName];
                    if (!tagInfo) {
                        tagInfo = blockTags[tagName] = {};
                    }
                    tagInfo[blockId] = simplifyStateAndCheckTrimmed(stateValues, tagStates, simplifiedInvalidStates);
                }
                for (const [liquidType, containableStates] of Object.entries(containLiquidStateMap)) {
                    let containLiquidSubMap = containLiquidMap[liquidType];
                    if (!containLiquidSubMap) {
                        containLiquidSubMap = containLiquidMap[liquidType] = {};
                    }
                    containLiquidSubMap[blockId] = simplifyStateAndCheckTrimmed(
                        stateValues,
                        containableStates,
                        simplifiedInvalidStates
                    );
                }
                for (const [liquidType, interactStateMap] of Object.entries(liquidInteractStateMap)) {
                    let globalInteractStateMap = liquidInteractMap[liquidType];
                    if (!globalInteractStateMap) {
                        globalInteractStateMap = liquidInteractMap[liquidType] = {};
                    }
                    for (const [interactPattern, patternStates] of Object.entries(interactStateMap)) {
                        let globalStateMap = globalInteractStateMap[interactPattern];
                        if (!globalStateMap) {
                            globalStateMap = globalInteractStateMap[interactPattern] = {};
                        }
                        globalStateMap[blockId] = simplifyStateAndCheckTrimmed(
                            stateValues,
                            patternStates,
                            simplifiedInvalidStates
                        );
                    }
                }
            }
            setStatus('');
            target.blocks = blocks;
            target.blockProperties = sortObjectKey(blockProperties);
            target.blockTags = sortObjectKey(blockTags, 2);
            target.containLiquidMap = sortObjectKey(containLiquidMap, 2);
            target.liquidInteractMap = sortObjectKey(liquidInteractMap, 3);
        }
    },
    {
        name: 'items',
        timeout: 60000,
        async extract({ target, frame }) {
            let ItemInfoList;
            await wrapEvaluate(frame, () => {
                const enchantmentTypes = Minecraft.EnchantmentTypes.getAll();
                const enchantments = enchantmentTypes.map((type) => ({
                    level: type.maxLevel,
                    type
                }));
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
                            const damageChances = [0, 1, 2, 3].map((level) => component.getDamageChance(level));
                            if (damageChances.some((e) => e !== 100)) {
                                componentData.damageChances = damageChances;
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
                            componentData.potionDurationTicks = component.potionEffectType.durationTicks;
                            componentData.potionDeliveryType = component.potionDeliveryType.id;
                        }
                        if (component instanceof Minecraft.ItemDyeableComponent) {
                            assign(componentData, component, ['color', 'defaultColor']);
                        }
                        if (component instanceof Minecraft.ItemCompostableComponent) {
                            assign(componentData, component, ['compostingChance']);
                        }
                        if (component instanceof Minecraft.ItemInventoryComponent) {
                            assign(componentData, component.container, ['containerRules', 'size']);
                        }
                        components[componentId] = componentData;
                        hasComponents = true;
                    });
                    const maxAmountDefault = itemStack.isStackable ? 64 : 1;
                    const defaultWeight = 64 / itemStack.maxAmount;
                    return [
                        itemType.id,
                        {
                            localizationKey: itemStack.localizationKey,
                            unstackable: itemStack.isStackable ? undefined : true,
                            maxAmount: itemStack.maxAmount !== maxAmountDefault ? itemStack.maxAmount : undefined,
                            weight: itemStack.weight !== defaultWeight ? itemStack.weight : undefined,
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
                        const [id, value] = await wrapEvaluate(
                            frame,
                            (index) => {
                                const itemTypes = globalThis.__item_extract_itemTypes;
                                const dump = globalThis.__item_extract_dump;
                                return dump(itemTypes[index]);
                            },
                            i
                        );
                        if (value !== null) {
                            ItemInfoList[id] = value;
                        }
                        setStatus(`[${i}/${length} ${((i / length) * 100).toFixed(1)}%] Item #${i} analyzed: ${id}`);
                    } catch {
                        warn(`Cannot evaluate code for item #${i}: ${err.message}`);
                        corruptedCount += 1;
                    }
                }
                if (corruptedCount > 0 && target.items) {
                    const removedItems = Object.keys(target.items).filter((k) => !(k in ItemInfoList));
                    for (const item of removedItems.splice(0, removedItems.length)) {
                        try {
                            const [id, value] = await wrapEvaluate(
                                frame,
                                (itemId) => {
                                    const dump = globalThis.__item_extract_dump;
                                    const itemType = Minecraft.ItemTypes.get(itemId);
                                    if (!itemType) throw new Error(`Cannot find item ${itemId}`);
                                    if (itemType.id !== itemId) throw new Error(`Item id mismatched: ${itemId}`);
                                    return dump(itemType);
                                },
                                item
                            );
                            if (value !== null) {
                                ItemInfoList[id] = value;
                            }
                            corruptedCount -= 1;
                            setStatus(`Item fixed: ${id}`);
                        } catch {
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
            target.entities = Object.keys(EntityInfoList).sort();
        }
    },
    {
        name: 'effects',
        timeout: 10000,
        async extract({ target, frame }) {
            const EffectList = await wrapEvaluate(frame, () => {
                const result = {};
                for (const effectType of Minecraft.EffectTypes.getAll()) {
                    result[effectType.getName()] = {};
                }
                return result;
            });
            target.effects = Object.keys(EffectList).sort();
        }
    },
    {
        name: 'dimensions',
        timeout: 10000,
        async extract({ target, frame }) {
            const DimensionList = await wrapEvaluate(frame, () => {
                const result = {};
                for (const dimensionType of Minecraft.DimensionTypes.getAll()) {
                    const dimension = Minecraft.world.getDimension(dimensionType.typeId);
                    result[dimensionType.typeId] = {
                        heightRange: [dimension.heightRange.min, dimension.heightRange.max],
                        localizationKey: dimension.localizationKey
                    };
                }
                return result;
            });
            target.dimensions = sortObjectKey(DimensionList);
        }
    },
    {
        name: 'biomes',
        timeout: 10000,
        async extract({ target, frame }) {
            const BiomeList = await wrapEvaluate(frame, () => {
                const result = {};
                for (const biomeType of Minecraft.BiomeTypes.getAll()) {
                    result[biomeType.id] = {};
                }
                return result;
            });
            target.biomes = Object.keys(BiomeList).sort();
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
    },
    {
        name: 'potions',
        timeout: 10000,
        async extract({ target, frame }) {
            const { potionEffects, potionDeliveries } = await wrapEvaluate(frame, () => {
                const potionEffects = {};
                const potionEffectTypes = Minecraft.Potions.getAllEffectTypes();
                for (const potionEffectType of potionEffectTypes) {
                    potionEffects[potionEffectType.id] = {
                        durationTicks: potionEffectType.durationTicks
                    };
                }
                const potionDeliveries = {};
                for (const potionDeliveryType of Minecraft.Potions.getAllDeliveryTypes()) {
                    const items = {};
                    for (const potionEffectType of potionEffectTypes) {
                        const item = Minecraft.Potions.resolve(potionEffectType, potionDeliveryType);
                        if (!items[item.typeId]) {
                            items[item.typeId] = [];
                        }
                        items[item.typeId].push(potionEffectType.id);
                    }
                    potionDeliveries[potionDeliveryType.id] = { items };
                }
                return { potionEffects, potionDeliveries };
            });
            for (const [, v] of Object.entries(potionDeliveries)) {
                if (Object.keys(v.items).length === 1) {
                    v.items = Object.keys(v.items)[0];
                }
            }
            target.potionEffects = sortObjectKey(potionEffects);
            target.potionDeliveries = sortObjectKey(potionDeliveries);
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
    MinecraftDebugUtilities: ['@minecraft/debug-utilities'],
    MinecraftDiagnostics: ['@minecraft/diagnostics'],
    MinecraftGraphics: ['@minecraft/server-graphics']
};

/**
 * @param {MinecraftDebugSession} session
 */
async function evaluateExtractors(cx, target, session, controller) {
    const { coreVersion } = cx;
    await controller.pause();
    const topFrame = await session.getTopStack();
    await topFrame.evaluate(
        (envKeys) => {
            Promise.allSettled(
                envKeys.map(([keyName, moduleNames]) =>
                    Promise.allSettled(moduleNames.map((moduleName) => import(moduleName))).then((resolutions) => {
                        const found = resolutions.find((e) => e.status === 'fulfilled');
                        if (found) {
                            globalThis[keyName] = found.value;
                        }
                    })
                )
            ).then(() => {
                console.info('###PREPARE_ENV_OK###');
            });
        },
        [...Object.entries(ImportEnvironments)]
    );
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
            await extractor.extract({
                target,
                frame: topFrame,
                session,
                controller,
                cx
            });
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
        cpSync(resolvePath(basePath, fileInfo.path), targetPath, {
            recursive: true
        });
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
                    await pushRecursively(
                        device,
                        packPath,
                        posix.join(cx.devBehaviorPackPath, 'gametest_behavior_pack')
                    );
                } else {
                    const packDest = resolvePath(cx.devBehaviorPackPath, 'gametest_behavior_pack');
                    mkdirSync(packDest, { recursive: true });
                    cpSync(packPath, packDest, { recursive: true });
                }
                break;
            } catch {
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
    const { localAddress } = wsSession.socket._socket;
    const server = createServer();
    const port = await getPort({ port: 19144 });
    server.listen(port);
    const socketPromise = pEvent(server, 'connection');
    if (device) {
        await device.reverse('tcp:19144', `tcp:${port}`);
        wsSession.sendCommand('script debugger connect 127.0.0.1 19144');
    } else {
        wsSession.sendCommand(`script debugger connect ${localAddress.replace('::ffff:', '')} ${port}`);
    }
    const socket = await socketPromise;
    if (device) {
        log(`${device.serial} connected via qjs-debugger.`);
    } else {
        log(`${socket.remoteAddress} connected via qjs-debugger.`);
    }
    // Provide cache for infering corrupted items, but not affecting output (not owned by target)
    const target = Object.assign(Object.create(cache ?? {}), {
        packageVersion
    });
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
