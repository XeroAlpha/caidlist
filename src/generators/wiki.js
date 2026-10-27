import { writeFileSync } from 'fs';
import { naturalOrderSort, warn } from '../util/common.js';

const hiddenIds = [];
const specialIds = [
    // deprecated
    'deprecated_anvil',
    'deprecated_purpur_block_1',
    'deprecated_purpur_block_2',

    // not translated yet
    'cave_vines_body_with_berries',
    'cave_vines_head_with_berries'
];

export function writeWikiBlockStateValuesBE(cx, outputFile, blockData) {
    const indent = '\t';
    // eslint-disable-next-line prettier/prettier
    const lines = [
        '-- https://zh.minecraft.wiki/w/Module:Block_state_values_BE',
        'return {',
        `${indent}-- 自动生成`
    ];
    const blockIds = naturalOrderSort(Object.keys(blockData));
    for (const blockId of blockIds) {
        const blockInfo = blockData[blockId];
        const blockIdWithoutNamespace = blockId.replace(/^minecraft:/, '');
        if (hiddenIds.includes(blockIdWithoutNamespace)) continue;
        if (blockInfo.properties.length > 0) {
            lines.push(`${indent}['${blockIdWithoutNamespace}'] = {`);
            for (const property of blockInfo.properties) {
                const validOverride = blockInfo.validStateOverrides?.[property.name];
                // 安卓端 BE 的 SAPI 会跑出莫名其妙的结果，这里手动进行过滤
                const shouldPatch =
                    (blockIdWithoutNamespace === 'creaking_heart' && property.name === 'creaking_heart_state') ||
                    (blockIdWithoutNamespace === 'sculk_sensor' && property.name === 'sculk_sensor_phase');
                if (validOverride && !shouldPatch) {
                    lines.push(
                        `${indent}${indent}{'${property.name}', '${property.defaultValue}', valid = {${validOverride.map((e) => `'${e}'`).join(', ')}}},`
                    );
                } else {
                    lines.push(`${indent}${indent}{'${property.name}', '${property.defaultValue}'},`);
                }
            }
            lines.push(`${indent}},`);
        } else {
            lines.push(`${indent}['${blockIdWithoutNamespace}'] = {},`);
        }
    }
    lines.push('}');
    lines.push('');
    writeFileSync(outputFile, lines.join('\n'));
}

export function writeWikiBlockPropertyValuesBE(cx, outputFile, blockProperties) {
    const indent = '\t';
    const lines = [
        '-- https://zh.minecraft.wiki/w/Module:Block_property_values_BE',
        'return {',
        `${indent}-- 自动生成`
    ];
    const properties = naturalOrderSort(Object.keys(blockProperties));
    for (const property of properties) {
        const propertyKinds = blockProperties[property];
        for (let i = 0; i < propertyKinds.length; i++) {
            const { validValues } = propertyKinds[i];
            const propertyName = i === 0 ? property : `${property}_${i}`;
            lines.push(
                `${indent}['${propertyName}'] = {'${property}', {${validValues.map((e) => `'${e}'`).join(', ')}}},`
            );
        }
    }
    lines.push('}');
    lines.push('');
    writeFileSync(outputFile, lines.join('\n'));
}

export function writeWikiBlockIdValuesBE(cx, outputFile, blockTranslations) {
    const indent = '\t';
    // eslint-disable-next-line prettier/prettier
    const lines = [
        '-- https://zh.minecraft.wiki/w/Module:Block_id_values_BE',
        'return {',
        `${indent}-- 自动生成`
    ];
    const mappedNames = new Set();
    const ids = naturalOrderSort(Object.keys(blockTranslations));
    for (const id of ids) {
        const names = blockTranslations[id];
        const idWithoutNamespace = id.replace(/^minecraft:/, '');
        for (const name of names.split('/')) {
            if (hiddenIds.includes(idWithoutNamespace) || specialIds.includes(idWithoutNamespace)) continue;
            if (mappedNames.has(name)) {
                warn(`Conflicted name mapping: ${name} -> ${idWithoutNamespace}`);
            }
            mappedNames.add(name);
            lines.push(`${indent}['${name}'] = '${idWithoutNamespace}',`);
        }
    }
    lines.push('}');
    lines.push('');
    writeFileSync(outputFile, lines.join('\n'));
}

export function writeWikiGameTagsBE(cx, outputFile, { biomeTags, blockTags, itemTags }) {
    const indent = '\t';
    // eslint-disable-next-line prettier/prettier
    const lines = [
        '-- https://zh.minecraft.wiki/w/Module:GameTag/SnapOriBE',
        'return {',
        `${indent}-- 自动生成`
    ];

    const biomeTagNames = naturalOrderSort(Object.keys(biomeTags));
    lines.push(`${indent}['biomes'] = {`);
    for (const biomeTag of biomeTagNames) {
        const biomes = naturalOrderSort(biomeTags[biomeTag]);
        lines.push(`${indent.repeat(2)}['${biomeTag}'] = {`);
        for (const biomeId of biomes) {
            lines.push(`${indent.repeat(3)}'${biomeId}',`);
        }
        lines.push(`${indent.repeat(2)}},`);
    }
    lines.push(`${indent}},`);

    const blockTagNames = naturalOrderSort(Object.keys(blockTags));
    lines.push(`${indent}['blocks'] = {`);
    for (const blockTag of blockTagNames) {
        const blocks = naturalOrderSort(Object.keys(blockTags[blockTag]));
        lines.push(`${indent.repeat(2)}['${blockTag}'] = {`);
        for (const blockId of blocks) {
            const idWithoutNamespace = blockId.replace(/^minecraft:/, '');
            lines.push(`${indent.repeat(3)}'${idWithoutNamespace}',`);
        }
        lines.push(`${indent.repeat(2)}},`);
    }
    lines.push(`${indent}},`);

    const itemTagNames = naturalOrderSort(Object.keys(itemTags));
    lines.push(`${indent}['items'] = {`);
    for (const itemTag of itemTagNames) {
        const items = naturalOrderSort(itemTags[itemTag]);
        lines.push(`${indent.repeat(2)}['${itemTag}'] = {`);
        for (const itemId of items) {
            const idWithoutNamespace = itemId.replace(/^minecraft:/, '');
            lines.push(`${indent.repeat(3)}'${idWithoutNamespace}',`);
        }
        lines.push(`${indent.repeat(2)}},`);
    }
    lines.push(`${indent}},`);

    lines.push('}');
    lines.push('');
    writeFileSync(outputFile, lines.join('\n'));
}
