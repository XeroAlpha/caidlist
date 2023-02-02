import { forEachObject } from '../util/common.js';

export function buildBSTransKeys(blockProperties) {
    const transKeys = [];
    forEachObject(blockProperties, (properties, name) => {
        transKeys.push(name);
        properties.forEach((property) => {
            property.validValues.forEach((value) => {
                transKeys.push(`${name}=${value}`);
            });
        });
    });
    return transKeys;
}

export function buildBSDocFromTransMap(blockProperties, transMap, blockTransMap) {
    const result = {};
    forEachObject(blockProperties, (properties, name) => {
        const lines = [];
        lines.push(result[name] || name);
        properties.forEach((property) => {
            lines.push(
                '',
                '| 可选值 | 描述 |',
                '| ----- | --- |'
            );
            property.validValues.forEach((value) => {
                const k = `${name}=${value}`;
                lines.push(`| ${value} | ${result[k] || ''} |`);
            });
            lines.push(
                '',
                '由以下方块使用：',
                '| 方块 | 默认值 |',
                '| --- | ----- |'
            );
            forEachObject(property.defaultValue, (defaultValue, blockId) => {
                lines.push(`| ${blockId} <br/> ${blockTransMap[blockId]} | ${defaultValue} |`);
            });
        });
        result[name] = lines.join('\n');
    });
    return result;
}
