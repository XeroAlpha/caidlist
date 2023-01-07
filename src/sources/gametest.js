import { createServer } from 'net';
import { pEvent } from 'p-event';
import { QuickJSDebugProtocol, QuickJSDebugSession } from 'quickjs-debugger';
import {
    cachedOutput,
    sleepAsync,
    filterObjectMap,
    isExtendFrom,
    isArraySetEqual,
    sortObjectKey,
    stringComparator,
    kvArrayToObject,
    pause
} from '../util/common.js';
import {
    newAdbClient,
    getAnyOnlineDevice,
    waitForAnyDevice,
    adbShell
} from '../util/adb.js';
import doWSRelatedJobsCached from './wsconnect.js';

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
        async extract(target, frame) {
            const { tree, flatMap } = parseOrThrow(await frame.evaluate(() => {
                const flatDescMap = {};
                const root = { path: '', value: globalThis, desc: {}, doNotSort: true };
                const nodeQueue = [root];
                const objects = [];
                const objectDesc = [];
                const functionOwnNames = ['name', 'length', 'arguments', 'caller'];
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
                            desc.value = String(value);
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
                        objects.push(value);
                        objectDesc.push({ path, desc });
                        continue;
                    }
                    desc.value = value;
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
                    console.info(`[Command Extractor]${JSON.stringify(result)}`);
                }).catch((error) => {
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
        async extract(target, frame) {
            const blockInfoList = parseOrThrow(await frame.evaluate(() => {
                const blockTypes = Minecraft.MinecraftBlockTypes.getAllBlockTypes();
                const player = [...Minecraft.world.getPlayers()][0];
                const playerPos = player.location;
                const playerBlockPos = new Minecraft.BlockLocation(playerPos.x, playerPos.y, playerPos.z);
                const currentBlock = player.dimension.getBlock(playerBlockPos);
                const originPermutation = currentBlock.permutation;
                const result = {};
                for (const blockType of blockTypes) {
                    const states = [];
                    const invalidStates = [];
                    const { canBeWaterlogged } = blockType;
                    const basePermutation = blockType.createDefaultBlockPermutation();
                    const properties = basePermutation.getAllProperties().map((property) => ({
                        name: property.name,
                        validValues: property.validValues.slice(),
                        defaultValue: property.value
                    }));
                    const loopFields = properties.map((property) => ({
                        ...property,
                        loopIndex: 0,
                        loopCount: property.validValues.length
                    }));
                    for (;;) {
                        const permutation = basePermutation.clone();
                        const state = {};
                        for (const loopField of loopFields) {
                            const value = loopField.validValues[loopField.loopIndex];
                            state[loopField.name] = value;
                        }
                        let applicable = false;
                        try {
                            for (const property of permutation.getAllProperties()) {
                                property.value = state[property.name];
                            }
                            applicable = true;
                        } catch (err) {
                            invalidStates.push(state);
                        }
                        console.log(`Dumping ${blockType.id}${JSON.stringify(state)}`);
                        if (applicable) {
                            const tags = permutation.getTags().slice();
                            const components = [];
                            states.push({ state, tags, components });
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
                currentBlock.setPermutation(originPermutation);
                return JSON.stringify(result);
            }));
            const blocks = {};
            const blockProperties = {};
            const blockTags = {};
            for (const [blockId, blockType] of Object.entries(blockInfoList).sort(stringComparator)) {
                const { properties, states, invalidStates, canBeWaterlogged } = blockType;
                const tagMap = {};
                const stateValues = kvArrayToObject(properties.map((e) => [e.name, e.validValues]));
                blocks[blockId] = {
                    properties,
                    invalidStates: simplifyStateAndCheck(stateValues, invalidStates, []),
                    canBeWaterlogged
                };
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
                }
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
    // {
    //     name: 'blockData',
    //     async extract(target, frame, session) {
    //         parseOrThrow(await frame.evaluate(() => {
    //             const tickQueue = [];
    //             const tickHandle = Minecraft.world.events.tick.subscribe(() => {
    //                 while (tickQueue.length) {
    //                     tickQueue.shift()();
    //                 }
    //             });
    //             const player = [...Minecraft.world.getPlayers()][0];
    //             const { dimension } = player;
    //             const blockTypes = Minecraft.MinecraftBlockTypes.getAllBlockTypes();
    //             const playerLocation = player.location;
    //             const base = [Math.floor(playerLocation.x), Math.floor(playerLocation.y), Math.floor(playerLocation.z)];
    //             const blockDataCount = 16;
    //             async function asyncOp() {
    //                 const result = {};
    //                 const fillCommand = [
    //                     'fill',
    //                     base[0] + 1, base[1], base[2] - 1,
    //                     base[0] + blockDataCount * 2 + 1, base[1] + 2, base[2] + 1,
    //                     'barrier'
    //                 ].join(' ');
    //                 for (let i = 0; i < blockTypes.length; i++) {
    //                     const blockType = blockTypes[i];
    //                     const statusPromptCommand = [
    //                         'title', '@s', 'actionbar', `${i}/${blockTypes.length}:${blockType.id}`
    //                     ].join(' ');
    //                     player.runCommandAsync(statusPromptCommand);
    //                     try {
    //                         await player.runCommandAsync(fillCommand);
    //                     } catch (err) {
    //                         // No blocks to fill barriar
    //                     }
    //                     const promises = [];
    //                     for (let j = 0; j < blockDataCount; j++) {
    //                         const blockLocation = new Minecraft.BlockLocation(base[0] + j * 2 + 2, base[1] + 1, base[2]);
    //                         const setBlockCommand = [
    //                             'setblock',
    //                             blockLocation.x, blockLocation.y, blockLocation.z,
    //                             blockType.id, j
    //                         ].join(' ');
    //                         const promise = player.runCommandAsync(setBlockCommand)
    //                             .then(() => new Promise((resolve) => { tickQueue.push(resolve); }))
    //                             .then(() => dimension.getBlock(blockLocation));
    //                         promises.push(promise);
    //                     }
    //                     const setBlockResults = await Promise.allSettled(promises);
    //                     result[blockType.id] = setBlockResults.map((e) => {
    //                         if (e.status === 'rejected') {
    //                             return String(e.reason);
    //                         }
    //                         if (e.value.typeId === blockType.id) {
    //                             const properties = {};
    //                             const blockProperties = e.value.permutation.getAllProperties();
    //                             blockProperties.forEach((prop) => {
    //                                 properties[prop.name] = prop.value;
    //                             });
    //                             return properties;
    //                         }
    //                         return `converted to ${e.value.typeId}`;
    //                     });
    //                 }
    //                 const cleanCommand = [
    //                     'fill',
    //                     base[0] + 1, base[1], base[2] - 1,
    //                     base[0] + blockDataCount * 2 + 1, base[1] + 2, base[2] + 1,
    //                     'air'
    //                 ].join(' ');
    //                 try {
    //                     await player.runCommandAsync(cleanCommand);
    //                 } catch (err) {
    //                     // No blocks to fill air
    //                 }
    //                 return result;
    //             }
    //             asyncOp().then((result) => {
    //                 console.info(`[BlockData Extractor]${JSON.stringify(result)}`);
    //             }).catch((error) => {
    //                 console.info(`[BlockData Extractor]ERROR: ${error}`);
    //             }).finally(() => {
    //                 Minecraft.world.events.tick.unsubscribe(tickHandle);
    //             });
    //             return 'null';
    //         }));
    //         session.continue();
    //         const res = await pEvent(session, 'log', (ev) => ev.message.startsWith('[BlockData Extractor]'));
    //         session.pause();
    //         const ret = res.message.replace('[BlockData Extractor]', '');
    //         if (ret.startsWith('ERROR')) {
    //             throw new Error(ret);
    //         } else {
    //             const blockDataMap = JSON.parse(ret);
    //             for (const [id, states] of Object.entries(blockDataMap)) {
    //                 const blockDescription = target.blocks[id];
    //                 const defaultState = states[0];
    //                 if (typeof defaultState === 'object') {
    //                     const filteredStates = states.map((e, i) => {
    //                         if (i === 0) return e;
    //                         if (typeof e === 'object') {
    //                             return e;
    //                         }
    //                         return null;
    //                     });
    //                     const nonNullCount = filteredStates.reduce((acc, e) => acc + (e !== null ? 1 : 0));
    //                     if (nonNullCount <= 1) continue;
    //                     const allDataBitValues = [];
    //                     let bitCount = 0;
    //                     // eslint-disable-next-line no-bitwise
    //                     for (let i = 1, j = 1; j < filteredStates.length; i += 1, j <<= 1) {
    //                         allDataBitValues.push([0, 1]);
    //                         bitCount = i;
    //                     }
    //                     for (const property of blockDescription.properties) {
    //                         const dataValueMap = {};
    //                         for (const validValue of property.validValues) {
    //                             const statedDataBits = [];
    //                             const invalidDataBits = [];
    //                             for (let i = 0; i < filteredStates.length; i++) {
    //                                 const bits = [];
    //                                 // eslint-disable-next-line no-bitwise
    //                                 for (let j = 1; j < filteredStates.length; j <<= 1) {
    //                                     // eslint-disable-next-line no-bitwise
    //                                     bits.push((i & j) === j ? 1 : 0);
    //                                 }
    //                                 if (!filteredStates[i]) {
    //                                     invalidDataBits.push(bits);
    //                                 } else if (filteredStates[i][property.name] === validValue) {
    //                                     statedDataBits.push(bits);
    //                                 }
    //                             }
    //                             const simplifiedState = simplifyStateAndCheck(allDataBitValues, statedDataBits, invalidDataBits);
    //                             const stateBitsExpr = [];
    //                             for (const state of simplifiedState) {
    //                                 const bitExpr = [];
    //                                 for (let i = 0; i < bitCount; i++) {
    //                                     if (i in state) {
    //                                         bitExpr.push(state[i]);
    //                                     } else {
    //                                         bitExpr.push('x');
    //                                     }
    //                                 }
    //                                 bitExpr.reverse();
    //                                 stateBitsExpr.push(bitExpr.join(''));
    //                             }
    //                             dataValueMap[validValue] = stateBitsExpr.join(' | ');
    //                         }
    //                         property.dataValueMap = dataValueMap;
    //                     }
    //                 }
    //             }
    //         }
    //     }
    // },
    {
        name: 'items',
        async extract(target, frame) {
            const ItemInfoList = parseOrThrow(await frame.evaluate(() => {
                const result = {};
                for (const itemType of Minecraft.ItemTypes.getAll()) {
                    const itemStack = new Minecraft.ItemStack(itemType);
                    const components = itemStack.getComponents()
                        .map((component) => component.constructor.id);
                    result[itemType.id] = { components };
                }
                return JSON.stringify(result);
            }));
            const items = Object.keys(ItemInfoList).sort();
            target.items = items;
        }
    },
    {
        name: 'entities',
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
    }
];

const ImportEnvironments = {
    Minecraft: ['Minecraft', 'mojang-minecraft', '@minecraft/server'],
    GameTest: ['GameTest', 'mojang-gametest', '@minecraft/server-gametest'],
    MinecraftUI: ['mojang-minecraft-ui', '@minecraft/server-ui'],
    MinecraftServerAdmin: ['mojang-minecraft-server-admin', '@minecraft/server-admin'],
    MinecraftNet: ['mojang-minecraft-net', '@minecraft/server-net']
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
            console.info('PREPARE_ENV_OK');
        });
    }, [...Object.entries(ImportEnvironments)]);
    await Promise.all([
        pEvent(session, 'log', (ev) => ev.message === 'PREPARE_ENV_OK'),
        session.continue()
    ]);
    await session.pause();
    for (const extractor of Extractors) {
        if (extractor.match && !extractor.match(coreVersion)) continue;
        try {
            console.log(`Extracting ${extractor.name} from GameTest`);
            await extractor.extract(target, topFrame, session, cx);
        } catch (err) {
            console.error(`Failed to extract ${extractor.name}`, err);
        }
    }
    await session.continue();
}

export default async function analyzeGameTestEnumsCached(cx) {
    const { version, packageVersion } = cx;
    const cacheId = `version.${version}.gametest.all`;
    const cache = cachedOutput(cacheId);
    if (cache && packageVersion === cache.packageVersion) return cache;

    console.log('Connecting ADB host...');
    const adbClient = newAdbClient();
    console.log('Connecting to device...');
    let device = await getAnyOnlineDevice(adbClient);
    if (!device) {
        console.log('Please plug in the device...');
        device = await waitForAnyDevice(adbClient);
    }
    await pause('Please switch to branch: gametest\nInteract if the device is ready');

    const server = createServer();
    server.listen(0);
    const socketPromise = pEvent(server, 'connection');
    await device.reverse('tcp:19144', `tcp:${server.address().port}`);
    await adbShell(device, 'input keyevent 48'); // KEYCODE_T
    await sleepAsync(500);
    await adbShell(device, `input text ${JSON.stringify('/script debugger connect 127.0.0.1 19144')}`);
    await adbShell(device, 'input keyevent 66'); // KEYCODE_ENTER
    const socket = await socketPromise;
    const protocol = new QuickJSDebugProtocol(socket);
    const session = new QuickJSDebugSession(protocol);
    const target = { packageVersion };
    await evaluateExtractors(cx, target, session);
    await doWSRelatedJobsCached(cx, device, {});
    protocol.close();
    server.close();
    return cachedOutput(cacheId, target);
}
