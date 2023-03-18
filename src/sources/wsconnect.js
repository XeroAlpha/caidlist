import { WSServer } from 'mcpews';
import { pEvent } from 'p-event';
import { cachedOutput, testMinecraftVersionInRange, sleepAsync } from '../util/common.js';
import { adbShell } from '../util/adb.js';

function listCommands(session) {
    return new Promise((resolve) => {
        const list = [];
        let i = 0;
        let count = 0;
        function processBody({ body }) {
            list.push(...body.body.split('\n'));
            i++;
            if (i > count) {
                resolve(list);
            } else {
                session.sendCommand(['help', i], processBody);
            }
        }
        session.sendCommand('help', ({ body }) => {
            list.push(...body.body.split('\n'));
            i = body.page;
            count = body.pageCount;
            i++;
            session.sendCommand(['help', i], processBody);
        });
    });
}

function listCommandsLegacy(session) {
    return new Promise((resolve) => {
        const list = [];
        let i = 0;
        let count = 0;
        function processBody({ body }) {
            list.push(...body.body.split('\n'));
            i++;
            if (i > count) {
                resolve(list);
            } else {
                session.sendCommandLegacy('help', 'byPage', { page: i }, processBody);
            }
        }
        session.sendCommandLegacy('help', 'byPage', {}, ({ body }) => {
            list.push(...body.body.split('\n'));
            i = body.page;
            count = body.pageCount;
            i++;
            session.sendCommandLegacy('help', 'byPage', { page: i }, processBody);
        });
    });
}

async function doWSRelatedJobs(cx, session) {
    let commandList;
    if (testMinecraftVersionInRange(cx.coreVersion, '1.2', '*')) {
        commandList = await listCommands(session);
    } else {
        commandList = await listCommandsLegacy(session);
    }
    return { commandList };
}

/** @returns {Promise<import('mcpews').Session>} */
export async function createExclusiveWSSession(device) {
    const wsServer = new WSServer(19134);
    const sessionPromise = pEvent(wsServer, 'client');
    if (device) {
        await device.reverse('tcp:19134', 'tcp:19134');
        await adbShell(device, 'input keyevent 48'); // KEYCODE_T
        await sleepAsync(500);
        await adbShell(device, `input text ${JSON.stringify('/connect 127.0.0.1:19134')}`);
        await adbShell(device, 'input keyevent 66'); // KEYCODE_ENTER
    } else {
        console.log('Type "/connect 127.0.0.1:19134" in game console to continue analyzing...');
    }
    const { session } = await sessionPromise;
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
