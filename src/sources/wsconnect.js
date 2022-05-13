const { WSServer } = require("mcpews");
const { cachedOutput, eventTriggered, testMinecraftVersionInRange } = require("../util/common");
const { adbShell } = require("../util/adb");

function listCommands(session) {
    return new Promise((resolve) => {
        const list = [];
        let i = 0;
        let count = 0;
        function processBody({ body }) {
            list.push(...body.body.split("\n"));
            i++;
            if (i > count) {
                resolve(list);
            } else {
                session.sendCommand(["help", i], processBody);
            }
        }
        session.sendCommand("help", ({ body }) => {
            list.push(...body.body.split("\n"));
            i = body.page;
            count = body.pageCount;
            i++;
            session.sendCommand(["help", i], processBody);
        });
    });
}

function listCommandsLegacy(session) {
    return new Promise((resolve) => {
        const list = [];
        let i = 0;
        let count = 0;
        function processBody({ body }) {
            list.push(...body.body.split("\n"));
            i++;
            if (i > count) {
                resolve(list);
            } else {
                session.sendCommandLegacy("help", "byPage", { page: i }, processBody);
            }
        }
        session.sendCommandLegacy("help", "byPage", {}, ({ body }) => {
            list.push(...body.body.split("\n"));
            i = body.page;
            count = body.pageCount;
            i++;
            session.sendCommandLegacy("help", "byPage", { page: i }, processBody);
        });
    });
}

async function doWSRelatedJobs(cx, device) {
    const wsServer = new WSServer(0);
    const sessionPromise = eventTriggered(wsServer, "client");
    await device.reverse("tcp:19134", "tcp:" + wsServer.address().port);
    await adbShell(device, "input keyevent 48"); // KEYCODE_T
    await adbShell(device, "input text " + JSON.stringify("/connect 127.0.0.1:19134"));
    await adbShell(device, "input keyevent 66"); // KEYCODE_ENTER
    const { session } = await sessionPromise;
    let commandList;
    if (testMinecraftVersionInRange(cx.coreVersion, "1.2", "*")) {
        commandList = await listCommands(session);
    } else {
        commandList = await listCommandsLegacy(session);
    }
    wsServer.disconnectAll();
    wsServer.close();
    return { commandList };
}

async function doWSRelatedJobsCached(cx, device, target) {
    const { version, branch, packageVersion } = cx;
    const cacheId = `version.${version}.autocompletion.${branch.id}.mcpews`;
    let cache = cachedOutput(cacheId);
    let result;
    if (cache && packageVersion == cache.packageVersion) result = cache.result;
    if (!result) {
        result = await doWSRelatedJobs(cx, device);
        cachedOutput(cacheId, { packageVersion, result });
    }
    Object.assign(target, result);
}

module.exports = { doWSRelatedJobsCached };
