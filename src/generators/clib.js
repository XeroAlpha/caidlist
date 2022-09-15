import { writeFileSync } from 'fs';
import { replaceObjectKey, excludeObjectEntry } from '../util/common.js';

export default function writeTransMapClib(cx, options) {
    const branchName = cx.branch.name;
    const { packageVersion, coreVersion, versionInfo } = cx;
    const { outputFile, translationResultMaps } = options;
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
    writeFileSync(
        outputFile,
        JSON.stringify(
            {
                name: `ID表补丁包（${versionInfo.name}|${branchName}）`,
                author: 'CA制作组',
                description: [
                    `版本：${versionInfo.name}（${packageVersion}）`,
                    `分支：${branchName}`,
                    '\n该命令库将旧ID表替换为更新的版本。'
                ].join('\n'),
                uuid: '4b2612c7-3d53-46b5-9b0c-dd1f447d3ee7',
                version: [0, 0, 1],
                require: [],
                minSupportVer: '0.7.4',
                targetSupportVer: coreVersion,
                mode: 'overwrite',
                enums: renamedTranslationResultMaps
            },
            null,
            '\t'
        )
    );
}
