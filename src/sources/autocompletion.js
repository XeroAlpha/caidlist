import { Transform } from 'stream';
import { strict as assert } from 'assert';
import { PerformanceObserver, performance } from 'perf_hooks';
import { createWriteStream } from 'fs';
import { cpus } from 'os';
import { createScheduler, createWorker } from 'tesseract.js';
import { getDeviceOrWait } from '../util/adb.js';
import {
    cachedOutput,
    pause,
    retryUntilComplete,
    formatTimeLeft,
    readStreamOnce,
    sleepAsync,
    setStatus,
    log
} from '../util/common.js';
import * as support from './support.js';
import AutocompletionScreen from '../live/autocompletionScreen.js';
import { doWSRelatedJobsCached } from './wsconnect.js';
import { ScrcpyPNGStream, openScrcpy, press, stopScrcpy, isScrcpyStopped, injectText } from '../util/scrcpy.js';

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

async function analyzeCommandAutocompletionFast(
    cx,
    device,
    screen,
    tesseractScheduler,
    command,
    progressName,
    approxLength,
    aggressiveMode
) {
    // 初始状态：游戏HUD
    const autocompletions = [];
    const { commandAreaRect: rect } = cx;
    const scrcpy = await openScrcpy(device);
    const imageStream = new ScrcpyPNGStream(scrcpy, [
        '-filter:v', [
            `crop=x=${rect[0]}:y=${rect[1]}:w=${rect[2]}:h=${rect[3]}`,
            'format=pix_fmts=gray',
            'negate',
            'maskfun=low=60:high=60:fill=0:sum=256'
        ].join(',')
    ]);
    screen.updateStatus({ approxLength });

    log(`Starting ${progressName}: ${command}`);
    await imageStream.ready;

    // 打开聊天栏
    await press(scrcpy, 'KEYCODE_T');
    await sleepAsync(3000);
    await press(scrcpy, 'KEYCODE_SLASH');
    await sleepAsync(1000);
    await press(scrcpy, 'KEYCODE_MOVE_END');
    screen.log(`Input ${command}`);
    await injectText(scrcpy, command.replace(/^\//, ''));

    let typeahead = aggressiveMode;
    let reactInterval = 0;
    let reactFrameCount = 0;
    let droppedCount = 0;
    let tabWhenChanged = false;
    const pressTab = async () => {
        if (!isScrcpyStopped(scrcpy)) {
            droppedCount++;
            performance.mark('press-tab', { detail: droppedCount });
            await press(scrcpy, 'KEYCODE_TAB'); // async
        }
    };
    let imageDiffCounter = 0;
    let ocrProcessCounter = 0;
    const ocrPendingPromises = new Set();
    const imagePipeline = imageStream
        .pipe(
            new Transform({
                objectMode: true,
                transform(imageData, encoding, done) {
                    const start = performance.now();
                    if (!this.lastImage || !imageData.equals(this.lastImage)) {
                        const now = performance.now();
                        if (tabWhenChanged) {
                            if (!typeahead) {
                                pressTab();
                            } else {
                                typeahead = false;
                            }
                        }
                        if (this.lastImageTime) {
                            reactFrameCount = this.framesBeforeChange;
                            reactInterval = now - this.lastImageTime;
                        }
                        this.lastImageTime = now;
                        this.framesBeforeChange = 1;
                        this.lastImage = imageData;
                        imageDiffCounter++;
                        performance.measure(`image-diff-${imageDiffCounter}`, {
                            start,
                            detail: imageData.toString('base64')
                        });
                        done(null, imageData);
                    } else {
                        this.framesBeforeChange++;
                        done();
                    }
                    if (typeahead && tabWhenChanged && this.framesBeforeChange % 2 === 0) {
                        pressTab();
                    }
                }
            })
        )
        .pipe(
            new Transform({
                objectMode: true,
                transform(image, encoding, done) {
                    const start = performance.now();
                    let promise = tesseractScheduler.addJob('recognize', image);
                    const beforePromises = [...ocrPendingPromises];
                    promise = promise.then(async (result) => {
                        ocrPendingPromises.delete(promise);
                        await Promise.all(beforePromises);
                        return result.data.text;
                    });
                    ocrPendingPromises.add(promise);
                    promise.then((text) => {
                        let commandText = text.trim().replace(/\n/g, '');
                        ocrProcessCounter++;
                        performance.measure(`ocr-${ocrProcessCounter}`, { start, detail: commandText });
                        cx.tesseractMistakes.forEach(([pattern, replacement]) => {
                            commandText = commandText.replace(pattern, replacement);
                        });
                        if (commandText.length && (!this.last || this.last !== commandText)) {
                            if (tabWhenChanged) droppedCount--;
                            this.push(this.last = commandText);
                        }
                    });
                    done();
                }
            })
        );

    let autocompletedCommand = command.trim();
    let recogizedCommand = await retryUntilComplete(50, 0, async () => {
        const pickedCommand = await readStreamOnce(imagePipeline, 5000);
        setStatus(`Detecting start: ${pickedCommand}`);
        assert.equal(pickedCommand, autocompletedCommand);
        return pickedCommand;
    });
    const timeStart = performance.now();
    const performanceTimeOffset = Date.now() - timeStart;
    let stepStart = timeStart;
    let stepCount = 0;
    let duplicatedCount = 0;
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
        if (droppedCount > 50) {
            throw new Error(`Too many dropped events: ${droppedCount} dropped.`);
        }

        const autocompletion = autocompletedCommand.slice(command.length);
        if (autocompletions.includes(autocompletion)) {
            duplicatedCount++;
            setStatus(`Exit condition(${duplicatedCount}/5): ${autocompletion}`);
            screen.log(`Exit condition(${duplicatedCount}/5): ${autocompletion}`);
            if (duplicatedCount >= 5) {
                break;
            }
        } else {
            const now = performance.now();
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
                const estTime = performanceTimeOffset + now + timeLeft;
                const timeLeftStr = formatTimeLeft(timeLeft / 1000);
                const estTimeStr = new Date(estTime).toLocaleTimeString();
                screen.updateStatus({ percentage, now, stepSpentAvg, timeLeft, estTime });
                setStatus(`[${autocompletions.length}/${approxLength} ${percentage}% ${estTimeStr} ~${timeLeftStr}]${progressName} ${recogizedCommand}`);
            } else {
                setStatus(`[${autocompletions.length}/?]${progressName} ${recogizedCommand}`);
            }
        }
    }

    // 退出聊天栏
    tabWhenChanged = false;
    await press(scrcpy, 'KEYCODE_ESCAPE');
    await press(scrcpy, 'KEYCODE_ESCAPE');
    await retryUntilComplete(50 + droppedCount, 0, async () => {
        try {
            const recogizedResult = await readStreamOnce(imagePipeline, 2000);
            const nextResult = guessTruncatedString(recogizedResult, command);
            setStatus(`Waiting for end: ${recogizedResult}`);
            return nextResult == null;
        } catch (err) {
            await press(scrcpy, 'KEYCODE_ESCAPE');
            return false;
        }
    });
    setStatus('');

    stopScrcpy(scrcpy);
    await Promise.allSettled([...ocrPendingPromises]);

    return autocompletions;
}

function isMinecraftWindowTitle(foregroundTitle) {
    return foregroundTitle === 'Minecraft' || foregroundTitle === 'Minecraft Preview';
}

async function analyzeCommandAutocompletionFastWin10(
    cx,
    screen,
    command,
    progressName,
    approxLength
) {
    // 初始状态：游戏HUD
    const autocompletions = [];
    const {
        Keys,
        sendKeys,
        sendText,
        getClipboardText,
        emptyClipboard,
        getForegroundWindowTitle
    } = await import('../util/win32api.js');

    if (!isMinecraftWindowTitle(getForegroundWindowTitle())) {
        for (;;) {
            const foregroundTitle = getForegroundWindowTitle();
            if (isMinecraftWindowTitle(foregroundTitle)) break;
            setStatus(`Waiting for Minecraft to be foreground: ${foregroundTitle}`);
            await sleepAsync(1000);
        }
        setStatus('Waiting for 5 seconds...');
        await sleepAsync(5000);
    }

    screen.updateStatus({ approxLength });

    log(`Starting ${progressName}: ${command}`);

    // 打开聊天栏
    sendKeys('T');
    await sleepAsync(3000);
    sendText('/');
    screen.log(`Input ${command}`);
    sendText(command.replace(/^\//, ''));
    emptyClipboard();
    await sleepAsync(1000);

    const pressTab = async () => {
        sendKeys(Keys.Tab);
    };
    const pressCopy = async () => {
        sendKeys(Keys.Ctrl, 'A');
        sendKeys(Keys.Ctrl, 'C');
        await sleepAsync(50);
        sendKeys(Keys.End);
        await sleepAsync(50);
    };

    let clipboardText = `/${command.replace(/^\//, '')}`;
    const timeStart = performance.now();
    const performanceTimeOffset = Date.now() - timeStart;
    let stepStart = timeStart;
    let stepCount = 0;
    let duplicatedCount = 0;
    for (;;) {
        const oldClipboardText = clipboardText;
        await pressTab();
        clipboardText = await retryUntilComplete(20, 0, async () => {
            try {
                return await retryUntilComplete(20, 0, async () => {
                    await pressCopy();
                    const newClipboardText = getClipboardText() ?? oldClipboardText;
                    if (newClipboardText === oldClipboardText) {
                        throw new Error(`Clipboard text is not changed: ${newClipboardText}`);
                    }
                    return newClipboardText;
                });
            } catch (err) {
                await pressTab();
                throw err;
            }
        });

        const autocompletion = clipboardText.slice(command.length).trim();
        if (autocompletions.includes(autocompletion)) {
            duplicatedCount++;
            setStatus(`Exit condition(${duplicatedCount}/5): ${autocompletion}`);
            screen.log(`Exit condition(${duplicatedCount}/5): ${autocompletion}`);
            if (duplicatedCount >= 5) {
                break;
            }
        } else if (autocompletion !== '') {
            const now = performance.now();
            const stepSpent = now - stepStart;
            stepStart = now;
            stepCount++;
            screen.updateStatus({
                autocompletedCommand: clipboardText,
                recogizedCommand: clipboardText,
                autocompletion,
                stepSpent,
                resultLength: autocompletions.length
            });
            screen.log(`Got: ${clipboardText}`);
            autocompletions.push(autocompletion);
            if (approxLength > 0) {
                const stepSpentAvg = (now - timeStart) / stepCount;
                const percentage = ((autocompletions.length / approxLength) * 100).toFixed(1);
                const timeLeft = (approxLength - autocompletions.length) * stepSpentAvg;
                const estTime = performanceTimeOffset + now + timeLeft;
                const timeLeftStr = formatTimeLeft(timeLeft / 1000);
                const estTimeStr = new Date(estTime).toLocaleTimeString();
                screen.updateStatus({ percentage, now, stepSpentAvg, timeLeft, estTime });
                setStatus(`[${autocompletions.length}/${approxLength} ${percentage}% ${estTimeStr} ~${timeLeftStr}]${progressName} ${clipboardText}`);
            } else {
                setStatus(`[${autocompletions.length}/?]${progressName} ${clipboardText}`);
            }
        }
    }

    // 退出聊天栏
    await sleepAsync(1000);
    sendKeys(Keys.Esc);
    await sleepAsync(1000);
    sendKeys(Keys.Esc);
    await sleepAsync(1000);
    setStatus('');

    return autocompletions;
}

async function analyzeAutocompletionEnumCached(cx, options, name, commandPrefix, exclusion) {
    const { version, branch, packageVersion, useWin10Edition } = cx;
    const { device, target, screen, tesseractScheduler } = options;
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
            let resultSample;
            if (useWin10Edition) {
                resultSample = await analyzeCommandAutocompletionFastWin10(
                    cx,
                    screen,
                    commandPrefix,
                    progressName,
                    previousResult.length
                );
            } else {
                resultSample = await analyzeCommandAutocompletionFast(
                    cx,
                    device,
                    screen,
                    tesseractScheduler,
                    commandPrefix,
                    progressName,
                    previousResult.length,
                    retryCount < 8
                );
            }
            if (exclusion) resultSample = resultSample.filter((e) => !exclusion.includes(e));
            const mergedResult = mergeOrderedList(cachedResult, result || resultSample, resultSample);
            result = mergedResult.merged;
            if (!mergedResult.hasConflicts) {
                const additions = mergedResult.merged.filter((e) => !previousResult.includes(e));
                const deletions = previousResult.filter((e) => !mergedResult.merged.includes(e));
                if (additions.length === 0 && deletions.length === 0) break;
                log(`${additions.length} addition(s) and ${deletions.length} deletion(s) detected`);
                screen.log(`Result check failed: changed (${additions.length}++/${deletions.length}--)`);
            } else {
                log(`${mergedResult.conflicts.length} conflict(s) detected`);
                screen.log(`Result check failed: conflicted (${mergedResult.conflicts.length} conflicts)`);
            }
            retryCount++;
        }
        screen.log('Result check passed');
        cachedOutput(cacheId, { packageVersion, result, length: result.length });
    }
    return (target[id] = result);
}

function verifySupportForSelectors(cx, selectors) {
    for (const key in support) {
        if (typeof support[key] === 'function' && support[key].associatedSelectors) {
            const f = support[key];
            const result = f(cx);
            const commandMatches = f.associatedSelectors.some((andGroup) => andGroup.every((e) => selectors.includes(e)));
            if (result !== commandMatches) {
                throw new Error(`support.${key} should be updated, excepted ${commandMatches}, actually got ${result}`);
            }
        }
    }
}

export default async function analyzeAutocompletionEnumsCached(cx) {
    const { version, branch, packageVersion, ime } = cx;
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

    const tesseractScheduler = createScheduler();
    const workerCount = Math.max(1, Math.floor(cpus().length / 2));
    for (let i = 0; i < workerCount; i++) {
        const worker = await createWorker('eng', 3, {
            ...cx.tesseractOptions,
            cacheMethod: 'none'
        });
        tesseractScheduler.addWorker(worker);
    }

    if (ime) {
        await device.execOut(`ime set ${ime}`);
    }
    await pause(`Please switch to branch: ${branch.id}\nInteract if the device is ready`);
    const target = { packageVersion };
    const options = {
        device,
        target,
        screen,
        tesseractScheduler
    };

    if (support.mcpews(cx)) {
        await doWSRelatedJobsCached(cx, device, target);
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
    if (support.hudCommand(cx)) {
        postJob('hud elements', '/hud @s hide ');
    }
    if (support.placeCommandFeatureSubCommand(cx)) {
        postJob('features', '/place feature ');
        postJob('feature rules', '/place featurerule ');
    }
    if (support.hasPropertySelectorParam(cx)) {
        postJob('entity properties', '/testfor @e[has_property={', ['property', '!']);
    }

    if (support.eduCommands(cx)) {
        postJob('abilities', '/ability @s ', ['[']);
    }

    if (support.devCommands(cx)) {
        postJob('particle types', '/particlelegacy ');
        if (!support.placeCommandFeatureSubCommand(cx)) {
            postJob('features', '/placefeature feature ');
            postJob('feature rules', '/placefeature rule ');
        }
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
    await tesseractScheduler.terminate();

    verifySupportForSelectors(cx, target.selectors);
    return cachedOutput(cacheId, target);
}

export function measureAutocompletion() {
    const logStream = createWriteStream('./perf.csv');
    logStream.write('seqType,seqIndex,entryType,startTime,endTime,duration,extra\n');
    const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            const dashPos = entry.name.lastIndexOf('-');
            const cells = [
                dashPos >= 0 ? entry.name.slice(0, dashPos) : entry.name,
                dashPos >= 0 ? entry.name.slice(dashPos + 1) : entry.name,
                entry.entryType,
                entry.startTime,
                entry.startTime + entry.duration,
                entry.duration,
                JSON.stringify(entry.detail)
            ];
            logStream.write(`${cells.join(',')}\n`);
        }
    });
    obs.observe({ entryTypes: ['mark', 'measure'] });
    process.on('exit', () => {
        obs.disconnect();
        logStream.end();
    });
}
