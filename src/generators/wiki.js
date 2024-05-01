import { writeFileSync } from 'fs';

function getInvalidStateValues(invalidStates, stateName) {
    const invalidValues = [];
    invalidStates.forEach((permutation) => {
        const keys = Object.keys(permutation);
        if (keys.length === 1 && keys[0] === stateName) {
            invalidValues.push(permutation[stateName]);
        }
    });
    return invalidValues;
}

export function writeWikiBlockStateValuesBE(cx, outputFile, blockData) {
    const indent = '\t';
    const lines = [
        'return {',
        `${indent}-- 自动生成`
    ];
    for (const [blockId, blockInfo] of Object.entries(blockData)) {
        const blockIdWithoutNamespace = blockId.replace(/^minecraft:/, '');
        if (blockInfo.properties.length > 0) {
            lines.push(`${indent}['${blockIdWithoutNamespace}'] = {`);
            for (const property of blockInfo.properties) {
                const invalidValues = getInvalidStateValues(blockInfo.invalidStates, property.name);
                const validValues = property.validValues.filter((e) => !invalidValues.includes(e));
                if (invalidValues.length > 0) {
                    lines.push(`${indent}${indent}{'${property.name}', '${property.defaultValue}', valid = {${validValues.map((e) => `'${e}'`).join(', ')}}},`);
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
        'return {',
        `${indent}-- 自动生成`
    ];
    for (const [property, propertyKinds] of Object.entries(blockProperties)) {
        for (let i = 0; i < propertyKinds.length; i++) {
            const { validValues } = propertyKinds[i];
            const propertyName = i === 0 ? property : `${property}_${i}`;
            lines.push(`${indent}['${propertyName}'] = {'${property}', {${validValues.map((e) => `'${e}'`).join(', ')}}},`);
        }
    }
    lines.push('}');
    lines.push('');
    writeFileSync(outputFile, lines.join('\n'));
}

export function writeWikiBlockIdValuesBE(cx, outputFile, blockTranslations) {
    const indent = '\t';
    const lines = [
        'return {',
        `${indent}-- 自动生成`
    ];
    for (const [id, names] of Object.entries(blockTranslations)) {
        const idWithoutNamespace = id.replace(/^minecraft:/, '');
        for (const name of names.split('/')) {
            lines.push(`${indent}['${name}'] = '${idWithoutNamespace}',`);
        }
    }
    lines.push('}');
    lines.push('');
    writeFileSync(outputFile, lines.join('\n'));
}
