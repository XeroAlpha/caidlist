import { readFileSync, writeFileSync } from 'fs';
import { replaceObjectKey, excludeObjectEntry, forEachObject, kvArrayToObject } from '../util/common.js';

function iterateOverEnum(kvMapOrArray, f) {
    if (Array.isArray(kvMapOrArray)) {
        kvMapOrArray.forEach((k) => f(k, ''));
    } else {
        forEachObject(kvMapOrArray, (v, k) => f(k, v));
    }
}

function getEnumValue(kvMapOrArray, k) {
    if (Array.isArray(kvMapOrArray)) {
        return kvMapOrArray.includes(k) ? '' : undefined;
    }
    return kvMapOrArray[k];
}

function diffEnums(source, target) {
    const merged = {};
    const removed = {};
    forEachObject(target, (targetEnum, enumId) => {
        const sourceEnum = source[enumId];
        if (sourceEnum) {
            const mergedKVArray = [];
            const removedKeys = [];
            iterateOverEnum(targetEnum, (k, targetValue) => {
                const sourceValue = getEnumValue(sourceEnum, k);
                if (sourceValue !== targetValue) {
                    mergedKVArray.push([k, targetValue]);
                }
            });
            iterateOverEnum(sourceEnum, (k) => {
                const targetValue = getEnumValue(targetEnum, k);
                if (targetValue === undefined) {
                    removedKeys.push(k);
                }
            });
            if (mergedKVArray.length) {
                merged[enumId] = kvArrayToObject(mergedKVArray);
            }
            if (removedKeys.length) {
                removed[enumId] = removedKeys;
            }
        } else {
            merged[enumId] = targetEnum;
        }
    });
    return { merged, removed };
}

function asUpdateText(from, to) {
    return from === to ? to : `${from} → ${to}`;
}

export default function writeTransMapClib(cx, options) {
    const { packageVersion, coreVersion, version, versionInfo, branch } = cx;
    const { outputFile, translationResultMaps, patchOptions } = options;
    if (versionInfo.hidden || branch.hidden) {
        return;
    }
    const filteredTranslationResultMaps = excludeObjectEntry(translationResultMaps, [
        'gamerule',
        'command',
        'blockState'
    ]);
    const renamedTranslationResultMaps = replaceObjectKey(filteredTranslationResultMaps, [
        [/[A-Z]/g, (match, offset) => (offset > 0 ? '_' : '') + match.toLowerCase()], // camelCase -> snake_case
        ['enchant', 'enchant_type'],
        ['location', 'structure']
    ]);
    const metadata = {
        version,
        versionName: versionInfo.name,
        branch: branch.id,
        branchName: branch.name,
        coreVersion,
        packageVersion
    };
    const versionArray = coreVersion.split('.').map((e) => Number(e));
    writeFileSync(
        outputFile,
        JSON.stringify(
            {
                $schema: 'https://ca.projectxero.top/clib/schema_v1.json',
                name: `ID表补丁包（${versionInfo.name}|${branch.name}）`,
                author: 'CA制作组',
                description: [
                    `版本：${versionInfo.name}（${packageVersion}）`,
                    `分支：${branch.name}`,
                    '\n该命令库将旧ID表替换为对应的版本。'
                ].join('\n'),
                uuid: '4b2612c7-3d53-46b5-9b0c-dd1f447d3ee7',
                version: versionArray,
                require: [],
                minCAVersion: '2023-11-15',
                minSupportVer: '0.7.4',
                mode: 'overwrite',
                enums: renamedTranslationResultMaps,
                metadata
            },
            null,
            '\t'
        )
    );
    if (patchOptions) {
        const { sourceFile, patchFile, uuid } = patchOptions;
        const source = JSON.parse(readFileSync(sourceFile, 'utf-8'));
        const sourceMeta = source.metadata;
        const { merged, removed } = diffEnums(source.enums, renamedTranslationResultMaps);
        const versionUpdateText = asUpdateText(sourceMeta.versionName, metadata.versionName);
        const branchUpdateText = asUpdateText(sourceMeta.branchName, metadata.branchName);
        const packageVersionUpdateText = asUpdateText(sourceMeta.packageVersion, metadata.packageVersion);
        writeFileSync(
            patchFile,
            JSON.stringify(
                {
                    $schema: 'https://ca.projectxero.top/clib/schema_v1.json',
                    name: `ID表补丁包增量包（${versionUpdateText}|${branchUpdateText}）`,
                    author: 'CA制作组',
                    description: [
                        `版本：${versionUpdateText}（${packageVersionUpdateText}）`,
                        `分支：${branchUpdateText}`,
                        '\n该命令库将旧ID表更新到对应的版本。'
                    ].join('\n'),
                    uuid,
                    version: versionArray,
                    require: [{ uuid: source.uuid, min: versionArray }],
                    minCAVersion: '2023-11-15',
                    minSupportVer: coreVersion,
                    enums: merged,
                    versionPack: Object.keys(removed).length ? {
                        remove: {
                            enums: removed,
                            mode: 'remove'
                        }
                    } : undefined,
                    metadata: {
                        from: sourceMeta,
                        to: metadata
                    }
                },
                null,
                '\t'
            )
        );
    }
}
