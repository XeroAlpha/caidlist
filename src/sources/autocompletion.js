import { Transform } from 'stream';
import sharp from 'sharp';
import { strict as assert } from 'assert';
import { recognize } from 'node-tesseract-ocr';
import { getDeviceOrWait } from '../util/adb.js';
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
import { ScrcpyPNGStream, openScrcpy, press, waitForScrcpyReady, stopScrcpy, isScrcpyStopped } from '../util/scrcpy.js';

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

async function analyzeCommandAutocompletionFast(cx, device, screen, command, progressName, approxLength, aggressiveMode) {
    // 初始状态：游戏HUD
    const autocompletions = [];
    const { commandAreaRect: rect } = cx;
    const scrcpy = openScrcpy(device);
    const imageStream = new ScrcpyPNGStream(scrcpy, [
        '-filter:v', [
            `crop=x=${rect[0]}:y=${rect[1]}:w=${rect[2]}:h=${rect[3]}`,
            'format=pix_fmts=gray',
            'negate',
            'maskfun=low=60:high=60:fill=0:sum=256'
        ].join(',')
    ]);
    screen.updateStatus({ approxLength });

    console.log(`Starting ${progressName}: ${command}`);
    await waitForScrcpyReady(scrcpy);

    // 打开聊天栏
    await press(scrcpy, 'KEYCODE_SLASH');
    await sleepAsync(3000);
    screen.log(`Input ${command}`);
    await scrcpy.injectText(command.replace(/^\//, ''));

    let reactInterval = 0;
    let reactFrameCount = 0;
    let droppedCount = 0;
    let tabWhenChanged = false;
    const pressTab = async () => {
        if (tabWhenChanged && !isScrcpyStopped(scrcpy)) {
            droppedCount++;
            await press(scrcpy, 'KEYCODE_TAB'); // async
        }
    };
    const imagePipeline = imageStream
        .pipe(
            new Transform({
                objectMode: true,
                transform(imageData, encoding, done) {
                    const pipe = sharp(imageData);
                    pipe.raw()
                        .toBuffer({ resolveWithObject: true })
                        .then((raw) => {
                            if (!this.lastImage || !raw.data.equals(this.lastImage.data)) {
                                const now = Date.now();
                                if (!aggressiveMode) {
                                    pressTab();
                                }
                                if (this.lastImageTime) {
                                    reactFrameCount = this.framesBeforeChange;
                                    reactInterval = now - this.lastImageTime;
                                }
                                this.lastImageTime = now;
                                this.framesBeforeChange = 1;
                                this.lastImage = raw;
                                done(null, imageData);
                            } else {
                                this.framesBeforeChange++;
                                done();
                            }
                        });
                    if (aggressiveMode && this.framesBeforeChange > Math.max(droppedCount ** 2, 4)) {
                        pressTab();
                    }
                }
            })
        )
        .pipe(
            new Transform({
                objectMode: true,
                transform(image, encoding, done) {
                    const promise = recognize(image, {
                        ...cx.tesseractOptions,
                        lang: 'eng',
                        psm: 7,
                        oem: 3
                    });
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
                            if (tabWhenChanged) droppedCount--;
                            done(null, (this.last = commandText));
                        } else {
                            done();
                        }
                    });
                }
            })
        );

    let autocompletedCommand = command.trim();
    let recogizedCommand = await retryUntilComplete(50, 0, async () => {
        const pickedCommand = await readStreamOnce(imagePipeline, 5000);
        console.log(`Detecting start: ${pickedCommand}`);
        assert.equal(pickedCommand, autocompletedCommand);
        return pickedCommand;
    });
    const timeStart = Date.now();
    let stepStart = timeStart;
    let stepCount = 0;
    screen.updateStatus({ autocompletedCommand, recogizedCommand, timeStart });
    tabWhenChanged = true;
    for (;;) {
        recogizedCommand = await retryUntilComplete(10, 0, async () => {
            try {
                return await readStreamOnce(imagePipeline, 1000);
            } catch (err) {
                // 跳过重复ID
                await pressTab();
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
                reactFrameCount,
                droppedCount
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

    // 退出聊天栏
    tabWhenChanged = false;
    await press(scrcpy, 'KEYCODE_ESCAPE');
    await press(scrcpy, 'KEYCODE_ESCAPE');
    await retryUntilComplete(50, 0, async () => {
        try {
            const recogizedResult = await readStreamOnce(imagePipeline, 2000);
            const nextResult = guessTruncatedString(recogizedResult, command);
            console.log(`Waiting for end: ${recogizedResult}`);
            return nextResult == null;
        } catch (err) {
            await press(scrcpy, 'KEYCODE_ESCAPE');
            return false;
        }
    });

    stopScrcpy(scrcpy);

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
                previousResult.length,
                retryCount < 2
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
    screen.attachDevice(device);
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
