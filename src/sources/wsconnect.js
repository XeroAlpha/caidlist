import { WSServer, MinecraftDataType } from 'mcpews';
import { pEvent } from 'p-event';
import getPort from 'get-port';
import { cachedOutput, sleepAsync, sortObjectKey, log, setStatus } from '../util/common.js';
import { adbShell } from '../util/adb.js';
import * as support from './support.js';

/**
 * @param {import('mcpews').ServerSession} session
 */
function listCommands(session) {
    return new Promise((resolve) => {
        const list = [];
        let i = 0;
        let count = 0;
        function processBody({ body }) {
            list.push(...body.body.split('\n'));
            i++;
            if (i > count) {
                setStatus('');
                resolve(list);
            } else {
                setStatus(`[${i + 1}/${count}] Listing commands...`);
                session.sendCommand(['help', i], processBody);
            }
        }
        setStatus('[1/?] Listing commands...');
        session.sendCommand('help', ({ body }) => {
            list.push(...body.body.split('\n'));
            i = body.page;
            count = body.pageCount;
            i++;
            setStatus(`[${i + 1}/${count}] Listing commands...`);
            session.sendCommand(['help', i], processBody);
        });
    });
}

/**
 * @param {import('mcpews').ServerSession} session
 */
function listCommandsLegacy(session) {
    return new Promise((resolve) => {
        const list = [];
        let i = 0;
        let count = 0;
        function processBody({ body }) {
            list.push(...body.body.split('\n'));
            i++;
            if (i > count) {
                setStatus('');
                resolve(list);
            } else {
                setStatus(`[${i + 1}/${count}] Listing commands...`);
                session.sendCommandLegacy('help', 'byPage', { page: i }, processBody);
            }
        }
        setStatus('[1/?] Listing commands...');
        session.sendCommandLegacy('help', 'byPage', {}, ({ body }) => {
            list.push(...body.body.split('\n'));
            i = body.page;
            count = body.pageCount;
            i++;
            setStatus(`[${i + 1}/${count}] Listing commands...`);
            session.sendCommandLegacy('help', 'byPage', { page: i }, processBody);
        });
    });
}

/**
 * @param {import('mcpews').ServerSession} session
 * @param {import('mcpews').MinecraftDataType} type
 */
function fetchData(session, type) {
    return new Promise((resolve) => {
        setStatus(`Fetching data from websocket: ${type}`);
        session.fetchData(type, ({ body }) => {
            setStatus('');
            resolve(body);
        });
    });
}

/**
 * @param {import('mcpews').ServerSession} session
 */
async function doWSRelatedJobs(cx, session) {
    let commandList;
    if (support.textCommandWebSocketFormat(cx)) {
        commandList = await listCommands(session);
    } else {
        commandList = await listCommandsLegacy(session);
    }
    if (cx.version !== 'preview_win') {
        return { commandList };
    }
    /**
     * It depends on launch instance instead of world, so we
     * decide to extract them only in preview-win.
     */
    const wsBlockData = (await fetchData(session, MinecraftDataType.Block))
        .reduce((obj, block) => {
            obj[`${block.id}:${block.aux}`] = block.name;
            return obj;
        }, {});
    const wsItemData = (await fetchData(session, MinecraftDataType.Item))
        .reduce((obj, item) => {
            obj[`${item.id}:${item.aux}`] = item.name;
            return obj;
        }, {});
    const wsMobData = (await fetchData(session, MinecraftDataType.Mob))
        .reduce((obj, mob) => {
            obj[mob.id] = mob.name;
            return obj;
        }, {});
    return {
        commandList,
        wsBlockData: sortObjectKey(wsBlockData),
        wsItemData: sortObjectKey(wsItemData),
        wsMobData: sortObjectKey(wsMobData)
    };
}

/** @returns {Promise<import('mcpews').ServerSession>} */
export async function createExclusiveWSSession(device) {
    const port = await getPort({ port: 19134 });
    const wsServer = new WSServer(port);
    const sessionPromise = pEvent(wsServer, 'client');
    if (device) {
        log('Connecting to wsserver: /connect 127.0.0.1:19134');
        await device.reverse('tcp:19134', `tcp:${port}`);
        setStatus('Simulating user actions...');
        await adbShell(device, 'input keyevent KEYCODE_SLASH');
        await sleepAsync(3000);
        await adbShell(device, `input text ${JSON.stringify('connect 127.0.0.1:19134')}`);
        await adbShell(device, 'input keyevent KEYCODE_ENTER');
    } else {
        log(`Type "/connect 127.0.0.1:${port}" in game console to continue analyzing...`);
    }
    setStatus('Waiting for client...');
    const { session } = await sessionPromise;
    setStatus('');
    session.on('disconnect', () => {
        wsServer.close();
    });
    return session;
}

export async function doWSRelatedJobsCached(cx, session, target) {
    const { version, branch, packageVersion } = cx;
    const cacheId = `version.${version}.autocompletion.${branch.id}.mcpews`;
    const cache = cachedOutput(cacheId);
    let result;
    if (cache && packageVersion === cache.packageVersion) result = cache.result;
    if (!result) {
        result = await doWSRelatedJobs(cx, session);
        cachedOutput(cacheId, { packageVersion, result });
    }
    Object.assign(target, result);
}
