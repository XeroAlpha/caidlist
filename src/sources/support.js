import { testMinecraftVersionInRange } from '../util/common.js';

export function lootCommand(coreVersion) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.18.0.21', '1.18.0.21')
        || testMinecraftVersionInRange(coreVersion, '1.18.10.21', '*')
        || testMinecraftVersionInRange(coreVersion, '1.18.10.04', '1.18.10.04')
    );
}

export function lootTable(coreVersion) {
    return testMinecraftVersionInRange(coreVersion, '1.18.0.21', '*');
}

export function damageCommand(coreVersion) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.18.10.26', '*')
        || testMinecraftVersionInRange(coreVersion, '1.18.10.04', '1.18.10.04')
    );
}

export function hasItemSelectorParam(coreVersion) {
    return testMinecraftVersionInRange(coreVersion, '1.18.20.21', '*');
}

export function placefeatureCommand(coreVersion) {
    return testMinecraftVersionInRange(coreVersion, '1.18.20.25', '1.18.20.26');
}

export function newLocateCommand(coreVersion) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.19.10.23', '*')
        || testMinecraftVersionInRange(coreVersion, '1.19.10.03', '1.19.10.03')
    );
}

export function inputpermissionCommand(coreVersion) {
    return testMinecraftVersionInRange(coreVersion, '1.19.80.21', '*');
}

export function mcpews(versionType) {
    return versionType !== 'netease' && versionType !== 'netease_dev';
}

export function eduCommands(branchType) {
    return branchType === 'education';
}

export function devCommands(versionType) {
    return versionType === 'dev' || versionType === 'release_dev';
}

export function devCommandsGameSpace(branchType) {
    return branchType === 'experiment';
}
