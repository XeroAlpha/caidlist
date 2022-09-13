const net = require('net');
const pEvent = require('p-event');
const { QuickJSDebugProtocol, QuickJSDebugSession } = require('quickjs-debugger');
const {
    cachedOutput,
    sleepAsync,
    filterObjectMap,
    isExtendFrom,
    isArraySetEqual,
    sortObjectKey,
    stringComparator,
    kvArrayToObject,
    pause
} = require('../util/common');
const { newAdbClient, getAnyOnlineDevice, waitForAnyDevice, adbShell } = require('../util/adb');

/**
 * Only used in QuickJSDebugSession.evaluate
 * @type {import("mojang-minecraft")}
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
 * @param {Record<StateName,StateType[]>} stateValues
 * @param {Record<StateName,StateType>[]} states
 * @param {Record<StateName,StateType>[]} invalidStates
 * @returns {Record<StateName,StateType>[]}
 */
function simplifyState(stateValues, states, invalidStates) {
    const propEntries = [...Object.entries(stateValues)];
    const updateStates = states.slice();
    for (const [propName, propValues] of propEntries) {
        const parentMap = new Map();
        for (const state of updateStates) {
            const stateWithoutProp = filterObjectMap(state, (k) => k !== propName);
            let foundParents = [...parentMap.keys()].filter((parent) => isExtendFrom(parent, stateWithoutProp));
            if (!foundParents.length) {
                const foundValues = [...parentMap.keys()]
                    .filter((parent) => isExtendFrom(stateWithoutProp, parent))
                    .map((key) => parentMap.get(key))
                    .flat(1);
                foundParents = [stateWithoutProp];
                parentMap.set(stateWithoutProp, foundValues);
            }
            for (const parent of foundParents) {
                const foundValues = parentMap.get(parent);
                foundValues.push(state);
            }
        }
        updateStates.length = 0;
        const primeStates = [];
        for (const [parent, childStates] of parentMap.entries()) {
            const validValues = new Set(propValues);
            const invalidChildren = invalidStates.filter((state) => {
                const stateWithoutProp = filterObjectMap(state, (k) => k !== propName);
                return isExtendFrom(parent, stateWithoutProp);
            });
            childStates
                .concat(invalidChildren)
                .forEach((state) => validValues.delete(state[propName]));
            if (validValues.size > 0) {
                primeStates.push(...childStates);
            } else {
                updateStates.push(parent);
            }
        }
        for (const primeState of primeStates) {
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
    Minecraft: 'mojang-minecraft',
    GameTest: 'mojang-gametest',
    MinecraftUI: 'mojang-minecraft-ui',
    MinecraftServerAdmin: 'mojang-minecraft-server-admin',
    MinecraftNet: 'mojang-minecraft-net'
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
            ([keyName, moduleName]) => import(moduleName).then((module) => {
                globalThis[keyName] = module;
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
        await extractor.extract(target, topFrame, session, cx);
    }
    await session.continue();
}

async function analyzeGameTestEnumsCached(cx) {
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

    const server = net.createServer();
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
    protocol.close();
    server.close();
    return cachedOutput(cacheId, target);
}

module.exports = {
    analyzeGameTestEnumsCached
};
