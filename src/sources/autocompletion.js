const { Transform } = require("stream");
const sharp = require("sharp");
const assert = require("assert").strict;
const tesseract = require("node-tesseract-ocr");
const {
    newAdbClient,
    getAnyOnlineDevice,
    waitForAnyDevice,
    adbShell,
    getDeviceSurfaceOrientation,
    openMonkey,
    sendMonkeyCommand
} = require("../util/adb");
const { openMinicap, stopMinicap } = require("../util/captureScreen");
const {
    cachedOutput,
    pause,
    retryUntilComplete,
    formatTimeLeft,
    forEachObject,
    peekDataFromStream,
    sleepAsync
} = require("../util/common");
const support = require("./support");
const { AutocompletionScreen } = require("../live/autocompletionScreen");
const { doWSRelatedJobsCached } = require("./wsconnect");

function guessTruncatedString(truncatedStr, startsWith) {
    let spos, tpos;
    for (spos = 0; spos < startsWith.length; spos++) {
        tpos = truncatedStr.indexOf(startsWith.slice(spos));
        if (tpos >= 0 && tpos <= 3) {
            return startsWith + truncatedStr.slice(tpos - spos + startsWith.length);
        }
    }
    return null;
}

async function analyzeCommandAutocompletionFast(cx, device, screen, command, progressName, approxLength) {
    // 初始状态：游戏HUD
    const autocompletions = [];
    const surfaceOrientation = await getDeviceSurfaceOrientation(device);
    const commandAreaRect = cx.commandAreaRect[surfaceOrientation];
    const monkey = await openMonkey(device);
    screen.updateStatus({ approxLength });

    // 打开聊天栏
    await sendMonkeyCommand(monkey, "press KEYCODE_T");
    await sleepAsync(500);

    console.log(`Starting ${progressName}: ${command}`);
    screen.clearLog();
    screen.log("Input " + command);
    await adbShell(device, "input text " + JSON.stringify(command));

    let reactInterval = 0, reactFrameCount = 0;
    const imageStream = await openMinicap(device);
    const pipeline = imageStream
        .pipe(
            new Transform({
                objectMode: true,
                transform(imageData, encoding, done) {
                    screen.updateScreenshot(imageData);
                    done(null, imageData);
                }
            })
        )
        .pipe(
            new Transform({
                objectMode: true,
                transform(imageData, encoding, done) {
                    const pipe = sharp(imageData);
                    pipe.removeAlpha()
                        .extract({
                            left: commandAreaRect[0],
                            top: commandAreaRect[1],
                            width: commandAreaRect[2],
                            height: commandAreaRect[3]
                        })
                        .negate()
                        .threshold(60);
                    if (cx.dpiScale) {
                        pipe.resize({
                            width: commandAreaRect[2] * cx.dpiScale,
                            height: commandAreaRect[3] * cx.dpiScale,
                            fit: "fill",
                            kernel: "nearest"
                        });
                    }
                    pipe.raw()
                        .toBuffer({ resolveWithObject: true })
                        .then((image) => {
                            if (!this.lastImage || !image.data.equals(this.lastImage.data)) {
                                const now = Date.now();
                                sendMonkeyCommand(monkey, "press KEYCODE_TAB"); // async
                                if (this.lastImageTime) {
                                    reactFrameCount = this.framesBeforeChange;
                                    reactInterval = now - this.lastImageTime;
                                }
                                this.lastImageTime = now;
                                this.framesBeforeChange = 1;
                                done(null, (this.lastImage = image));
                            } else {
                                this.framesBeforeChange++;
                                done();
                            }
                        });
                }
            })
        )
        .pipe(
            new Transform({
                objectMode: true,
                transform(image, encoding, done) {
                    sharp(image.data, { raw: image.info })
                        .png()
                        .toBuffer()
                        .then((pngData) => {
                            const promise = tesseract.recognize(pngData, {
                                ...cx.tesseractOptions,
                                lang: "eng",
                                psm: 7,
                                oem: 3
                            });
                            done(null, promise);
                        });
                }
            })
        ).pipe(
            new Transform({
                objectMode: true,
                transform(promise, encoding, done) {
                    promise.then((text) => {
                        let commandText = text.trim();
                        forEachObject(cx.tesseractMistakes, (v, k) => {
                            let index = 0;
                            while ((index = commandText.indexOf(k, index)) >= 0) {
                                commandText = commandText.slice(0, index) + v + commandText.slice(index + k.length);
                                index += k.length;
                            }
                        });
                        if (commandText.length && (!this.last || this.last != commandText)) {
                            done(null, (this.last = commandText));
                        } else {
                            done();
                        }
                    });
                }
            })
        );

    let autocompletedCommand = command.trim();
    let recogizedCommand = await retryUntilComplete(10, 0, async () => {
        const command = await peekDataFromStream(pipeline, 0);
        assert.equal(command, autocompletedCommand);
        return command;
    });
    let timeStart = Date.now();
    let stepStart = timeStart;
    let stepCount = 0;
    screen.updateStatus({ autocompletedCommand, recogizedCommand, timeStart });
    while (true) {
        recogizedCommand = await retryUntilComplete(10, 500, async () => {
            try {
                return await peekDataFromStream(pipeline, 1000);
            } catch (err) {
                // 跳过重复ID
                await sendMonkeyCommand(monkey, "press KEYCODE_TAB");
                throw err;
            }
        });

        autocompletedCommand = guessTruncatedString(recogizedCommand, command);
        if (!autocompletedCommand) {
            screen.log("Assert failed: " + recogizedCommand);
            throw new Error("Auto-completed command test failed: " + recogizedCommand);
        }

        let autocompletion = autocompletedCommand.slice(command.length);
        if (autocompletions.includes(autocompletion)) {
            console.log("Exit condition: " + autocompletion);
            screen.log("Exit condition: " + autocompletion);
            break;
        } else {
            const now = Date.now();
            const stepSpent = now - stepStart;
            stepStart = now;
            stepCount++;
            screen.updateStatus({
                autocompletedCommand,
                recogizedCommand,
                autocompletion,
                stepSpent,
                resultLength: autocompletions.length,
                reactInterval,
                reactFrameCount
            });
            screen.log("Recognized: " + recogizedCommand);
            autocompletions.push(autocompletion);
            if (approxLength) {
                const stepSpentAvg = (now - timeStart) / stepCount;
                const percentage = ((autocompletions.length / approxLength) * 100).toFixed(1);
                const timeLeft = (approxLength - autocompletions.length) * stepSpentAvg;
                const estTime = now + timeLeft;
                const timeLeftStr = formatTimeLeft(timeLeft / 1000);
                const estTimeStr = new Date(estTime).toLocaleTimeString();
                screen.updateStatus({ percentage, now, stepSpentAvg, timeLeft, estTime });
                console.log(
                    `[${autocompletions.length}/${approxLength} ${percentage}% ${estTimeStr} ~${timeLeftStr}]${progressName} ${recogizedCommand}`
                );
            } else {
                console.log(`[${autocompletions.length}/?]${progressName} ${recogizedCommand}`);
            }
        }
    }

    // 退出聊天栏
    await sendMonkeyCommand(monkey, "press KEYCODE_ESCAPE");
    await sendMonkeyCommand(monkey, "press KEYCODE_ESCAPE");
    await sendMonkeyCommand(monkey, "quit");
    monkey.end();

    await stopMinicap(device, imageStream);

    return autocompletions;
}

async function analyzeAutocompletionEnumCached(cx, options, name, commandPrefix, exclusion) {
    const { version, branch, packageVersion } = cx;
    const { device, target, screen } = options;
    const id = name.replace(/\s+(\S)/g, (_, ch) => ch.toUpperCase());
    const cacheId = `version.${version}.autocompletion.${branch.id}.${name.replace(/\s+/g, "_")}`;
    let cache = cachedOutput(cacheId);
    let result;

    if (Array.isArray(cache)) cache = { result: cache, length: cache.length };
    if (cache && packageVersion == cache.packageVersion) result = cache.result;
    if (!result) {
        const progressName = `${version}.${branch.id}.${name.replace(/\s+/g, "_")}`;
        screen.updateStatus({ enumId: name, commandPrefix });
        result = await analyzeCommandAutocompletionFast(
            cx,
            device,
            screen,
            commandPrefix,
            progressName,
            cache && cache.length
        );
        if (exclusion) result = result.filter((e) => !exclusion.includes(e));
        cachedOutput(cacheId, { packageVersion, result, length: result.length });
    }
    return (target[id] = result);
}

async function analyzeAutocompletionEnumsCached(cx) {
    const { version, branch, packageVersion, coreVersion } = cx;
    const cacheId = `version.${version}.autocompletion.${branch.id}`;
    const cache = cachedOutput(cacheId);
    if (cache && packageVersion == cache.packageVersion) return cache;

    console.log("Connecting ADB host...");
    const adbClient = newAdbClient();
    console.log("Connecting to device...");
    let device = await getAnyOnlineDevice(adbClient);
    if (!device) {
        console.log("Please plug in the device...");
        device = await waitForAnyDevice(adbClient);
    }
    const screen = new AutocompletionScreen();
    screen.updateStatus({
        version,
        branch: branch.id,
        packageVersion
    });

    await pause("Please switch to branch: " + branch.id + "\nInteract if the device is ready");
    const target = { packageVersion };
    const options = {
        device,
        target,
        screen
    };

    if (support.mcpews(version)) {
        await doWSRelatedJobsCached(cx, device, target);
    }

    await analyzeAutocompletionEnumCached(cx, options, "blocks", "/testforblock ~ ~ ~ ");
    await analyzeAutocompletionEnumCached(cx, options, "items", "/clear @s ", ["["]);
    await analyzeAutocompletionEnumCached(cx, options, "entities", "/testfor @e[type=", ["!"]);
    await analyzeAutocompletionEnumCached(cx, options, "summonable entities", "/summon ");
    await analyzeAutocompletionEnumCached(cx, options, "effects", "/effect @s ", ["[", "clear"]);
    await analyzeAutocompletionEnumCached(cx, options, "enchantments", "/enchant @s ", ["["]);
    await analyzeAutocompletionEnumCached(cx, options, "gamerules", "/gamerule ");
    if (support.newLocateCommand(coreVersion)) {
        await analyzeAutocompletionEnumCached(cx, options, "locations", "/locate structure ");
        await analyzeAutocompletionEnumCached(cx, options, "biomes", "/locate biome ");
    } else {
        await analyzeAutocompletionEnumCached(cx, options, "locations", "/locate ");
    }
    await analyzeAutocompletionEnumCached(cx, options, "mobevents", "/mobevent ");
    await analyzeAutocompletionEnumCached(cx, options, "entity slots", "/replaceitem entity @s ", ["["]);
    await analyzeAutocompletionEnumCached(cx, options, "selectors", "/testfor @e[");

    if (support.lootCommand(coreVersion)) {
        await analyzeAutocompletionEnumCached(cx, options, "loot tools", "/loot spawn ~ ~ ~ loot empty ", [
            "mainhand",
            "offhand"
        ]);
    }
    if (support.damageCommand(coreVersion)) {
        await analyzeAutocompletionEnumCached(cx, options, "damage causes", "/damage @s 0 ");
    }
    if (support.hasItemSelectorParam(coreVersion)) {
        await analyzeAutocompletionEnumCached(cx, options, "item with aliases", "/testfor @e[hasitem={item=");
    }
    if (support.placefeatureCommand(coreVersion)) {
        await analyzeAutocompletionEnumCached(cx, options, "features and rules", "/placefeature ");
    }

    if (branch.id == "education") {
        await analyzeAutocompletionEnumCached(cx, options, "abilities", "/ability @s ", ["["]);
    }

    await screen.stop();
    return cachedOutput(cacheId, target);
}

module.exports = {
    analyzeAutocompletionEnumsCached
};
