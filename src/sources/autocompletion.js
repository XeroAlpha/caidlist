import { Transform } from 'stream';
import sharp from 'sharp';
import { strict as assert } from 'assert';
import { recognize } from 'node-tesseract-ocr';
import {
    getDeviceOrWait,
    adbShell,
    getDeviceSurfaceOrientation,
    openMonkey,
    sendMonkeyCommand,
    isMonkeyAlive
} from '../util/adb.js';
import { openMinicap, stopMinicap } from '../util/captureScreen.js';
import {
    cachedOutput,
    pause,
    retryUntilComplete,
    formatTimeLeft,
    forEachObject,
    readStreamOnce,
    sleepAsync
} from '../util/common.js';
import * as support from './support.js';
import AutocompletionScreen from '../live/autocompletionScreen.js';
import { createExclusiveWSSession, doWSRelatedJobsCached } from './wsconnect.js';

function guessTruncatedString(truncatedStr, startsWith) {
    let spos;
    let tpos;
    for (spos = 0; spos < startsWith.length; spos++) {
        tpos = truncatedStr.indexOf(startsWith.slice(spos));
        if (tpos >= 0 && tpos <= 3) {
            return startsWith + truncatedStr.slice(tpos - spos + startsWith.length);
        }
    }
    return null;
}

/**
 * Only deletions both in A and B are accepted.
 * @param {string[]} base
 * @param {string[]} listA
 * @param {string[]} listB
 */
function mergeOrderedList(base, listA, listB) {
    const chunks = [];
    let ai = 0;
    let bi = 0;
    let ci = 0;
    for (;;) {
        if (ci >= base.length) {
            if (ai < listA.length || bi < listB.length) {
                chunks.push({
                    a: listA.slice(ai),
                    b: listB.slice(bi),
                    c: []
                });
            }
            break;
        }
        const a = listA[ai];
        const b = listB[bi];
        const c = base[ci];
        if (a === b && b === c) {
            ai++; bi++; ci++;
            chunks.push({
                common: true,
                c
            });
        } else {
            const startCi = ci;
            for (;;) {
                if (ci >= base.length) {
                    chunks.push({
                        a: listA.slice(ai),
                        b: listB.slice(bi),
                        c: []
                    });
                    ai = listA.length;
                    bi = listB.length;
                    break;
                }
                const current = base[ci];
                const commonA = listA.indexOf(current, ai);
                const commonB = listB.indexOf(current, bi);
                if (commonA >= 0 && commonB >= 0) {
                    chunks.push({
                        a: listA.slice(ai, commonA),
                        b: listB.slice(bi, commonB),
                        c: base.slice(startCi, ci)
                    });
                    ai = commonA; bi = commonB;
                    break;
                }
                ci++;
            }
        }
    }
    const merged = [];
    const conflicts = [];
    chunks.forEach((e) => {
        if (e.common) {
            merged.push(e.c);
        } else if (e.a.length && e.b.length) {
            if (e.a.length === e.b.length && e.a.every((k, i) => e.b[i] === k)) {
                merged.push(...e.a);
            } else {
                conflicts.push(e);
                merged.push(...e.c);
            }
        } else if (e.a.length) {
            merged.push(...e.a);
        } else if (e.b.length) {
            merged.push(...e.b);
        }
    });
    return { merged, conflicts, hasConflicts: conflicts.length > 0 };
}

async function analyzeCommandAutocompletionFast(cx, device, screen, command, progressName, approxLength) {
    // 初始状态：游戏HUD
    const autocompletions = [];
    const surfaceOrientation = await getDeviceSurfaceOrientation(device);
    const commandAreaRect = cx.commandAreaRect[surfaceOrientation];
    const monkey = await openMonkey(device);
    screen.updateStatus({ approxLength });

    // 打开聊天栏
    await sendMonkeyCommand(monkey, 'press KEYCODE_SLASH');
    await sleepAsync(500);

    console.log(`Starting ${progressName}: ${command}`);
    screen.log(`Input ${command}`);
    await adbShell(device, `input text ${JSON.stringify(command.replace(/^\//, ''))}`);

    let reactInterval = 0;
    let reactFrameCount = 0;
    const imageStream = await openMinicap(device);
    const imagePipeline = imageStream
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
                            fit: 'fill',
                            kernel: 'nearest'
                        });
                    }
                    pipe.raw()
                        .toBuffer({ resolveWithObject: true })
                        .then((image) => {
                            if (!this.lastImage || !image.data.equals(this.lastImage.data)) {
                                const now = Date.now();
                                if (isMonkeyAlive(monkey)) {
                                    sendMonkeyCommand(monkey, 'press KEYCODE_TAB'); // async
                                }
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
                            const promise = recognize(pngData, {
                                ...cx.tesseractOptions,
                                lang: 'eng',
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
                        if (commandText.length && (!this.last || this.last !== commandText)) {
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
        const pickedCommand = await readStreamOnce(imagePipeline, 0);
        assert.equal(pickedCommand, autocompletedCommand);
        return pickedCommand;
    });
    const timeStart = Date.now();
    let stepStart = timeStart;
    let stepCount = 0;
    screen.updateStatus({ autocompletedCommand, recogizedCommand, timeStart });
    for (;;) {
        recogizedCommand = await retryUntilComplete(10, 500, async () => {
            try {
                return await readStreamOnce(imagePipeline, 1000);
            } catch (err) {
                // 跳过重复ID
                await sendMonkeyCommand(monkey, 'press KEYCODE_TAB');
                throw err;
            }
        });

        autocompletedCommand = guessTruncatedString(recogizedCommand, command);
        if (!autocompletedCommand) {
            screen.log(`Assert failed: ${recogizedCommand}`);
            throw new Error(`Auto-completed command test failed: ${recogizedCommand}`);
        }

        const autocompletion = autocompletedCommand.slice(command.length);
        if (autocompletions.includes(autocompletion)) {
            console.log(`Exit condition: ${autocompletion}`);
            screen.log(`Exit condition: ${autocompletion}`);
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
            screen.log(`Recognized: ${recogizedCommand}`);
            autocompletions.push(autocompletion);
            if (approxLength > 0) {
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

    await stopMinicap(device, imageStream);

    // 退出聊天栏
    await sendMonkeyCommand(monkey, 'press KEYCODE_ESCAPE');
    await sendMonkeyCommand(monkey, 'press KEYCODE_ESCAPE');
    await sendMonkeyCommand(monkey, 'quit');
    monkey.end();

    return autocompletions;
}

async function analyzeAutocompletionEnumCached(cx, options, name, commandPrefix, exclusion) {
    const { version, branch, packageVersion } = cx;
    const { device, target, screen } = options;
    const id = name.replace(/\s+(\S)/g, (_, ch) => ch.toUpperCase());
    const cacheId = `version.${version}.autocompletion.${branch.id}.${name.replace(/\s+/g, '_')}`;
    let cache = cachedOutput(cacheId);
    let result;

    if (Array.isArray(cache)) cache = { result: cache, length: cache.length };
    if (cache && packageVersion === cache.packageVersion) result = cache.result;
    if (!result) {
        const progressName = `${version}.${branch.id}.${name.replace(/\s+/g, '_')}`;
        screen.updateStatus({ enumId: name, commandPrefix });

        const cachedResult = cache ? cache.result : [];
        let retryCount = 0;
        for (;;) {
            const previousResult = result || cachedResult;
            screen.updateStatus({ retryCount });
            let resultSample = await analyzeCommandAutocompletionFast(
                cx,
                device,
                screen,
                commandPrefix,
                progressName,
                previousResult.length
            );
            if (exclusion) resultSample = resultSample.filter((e) => !exclusion.includes(e));
            const mergedResult = mergeOrderedList(cachedResult, result || resultSample, resultSample);
            result = mergedResult.merged;
            if (!mergedResult.hasConflicts) {
                const additions = mergedResult.merged.filter((e) => !previousResult.includes(e));
                const deletions = previousResult.filter((e) => !mergedResult.merged.includes(e));
                if (additions.length === 0 && deletions.length === 0) break;
                console.log(`${additions.length} addition(s) and ${deletions.length} deletion(s) detected`);
                screen.log(`Result check failed: changed (${additions.length}++/${deletions.length}--)`);
            } else {
                console.log(`${mergedResult.conflicts.length} conflict(s) detected`);
                screen.log(`Result check failed: conflicted (${mergedResult.conflicts.length} conflicts)`);
            }
            retryCount++;
        }
        screen.log('Result check passed');
        cachedOutput(cacheId, { packageVersion, result, length: result.length });
    }
    return (target[id] = result);
}

export default async function analyzeAutocompletionEnumsCached(cx) {
    const { version, branch, packageVersion } = cx;
    const cacheId = `version.${version}.autocompletion.${branch.id}`;
    const cache = cachedOutput(cacheId);
    if (cache && packageVersion === cache.packageVersion) return cache;

    const device = await getDeviceOrWait();
    const screen = new AutocompletionScreen();
    screen.updateStatus({
        version,
        branch: branch.id,
        packageVersion
    });

    await pause(`Please switch to branch: ${branch.id}\nInteract if the device is ready`);
    const target = { packageVersion };
    const options = {
        device,
        target,
        screen
    };

    if (support.mcpews(cx)) {
        const session = await createExclusiveWSSession(device);
        await doWSRelatedJobsCached(cx, session, target);
        session.disconnect();
    }

    const jobs = [];
    const postJob = (name, commandPrefix, exclusion) => {
        jobs.push(async () => {
            await analyzeAutocompletionEnumCached(cx, options, name, commandPrefix, exclusion);
        });
    };
    postJob('blocks', '/testforblock ~ ~ ~ ');
    postJob('items', '/clear @s ', ['[']);
    postJob('entities', '/testfor @e[type=', ['!']);
    postJob('summonable entities', '/summon ');
    postJob('effects', '/effect @s ', ['[', 'clear']);
    postJob('enchantments', '/enchant @s ', ['[']);
    postJob('gamerules', '/gamerule ');
    if (support.newLocateCommand(cx)) {
        postJob('locations', '/locate structure ');
        postJob('biomes', '/locate biome ');
    } else {
        postJob('locations', '/locate ');
    }
    postJob('mobevents', '/mobevent ');
    postJob('entity slots', '/replaceitem entity @s ', ['[']);
    postJob('selectors', '/testfor @e[');

    if (support.lootCommand(cx)) {
        postJob('loot tools', '/loot spawn ~ ~ ~ loot empty ', [
            'mainhand',
            'offhand'
        ]);
    }
    if (support.damageCommand(cx)) {
        postJob('damage causes', '/damage @s 0 ');
    }
    if (support.hasItemSelectorParam(cx)) {
        postJob('item with aliases', '/testfor @e[hasitem={item=');
    }
    if (support.placefeatureCommand(cx)) {
        postJob('features and rules', '/placefeature ');
    }
    if (support.inputpermissionCommand(cx)) {
        postJob('input permissions', '/inputpermission query @s ', ['[']);
    }
    if (support.cameraCommand(cx)) {
        postJob('camera presets', '/camera @s set ');
    }
    if (support.recipeNewCommand(cx)) {
        postJob('recipes', '/recipe take @s ', ['"*"', '[']);
    }

    if (support.eduCommands(cx)) {
        postJob('abilities', '/ability @s ', ['[']);
    }

    if (support.devCommands(cx)) {
        postJob('particle types', '/particlelegacy ');
        postJob('features', '/placefeature feature ');
        postJob('feature rules', '/placefeature rule ');
        if (support.devCommandsGameSpace(cx)) {
            postJob('options', '/option set ');
            postJob('server tests', '/test servertests ');
            postJob('unit tests', '/test unittests ');
            postJob('functional tests', '/test functionaltests ');
        }
    }

    screen.updateStatus({
        jobCount: jobs.length
    });
    for (let i = 0; i < jobs.length; i++) {
        screen.updateStatus({
            jobIndex: i
        });
        await jobs[i]();
    }

    await screen.stop();
    return cachedOutput(cacheId, target);
}
