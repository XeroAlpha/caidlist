import { testMinecraftVersionInRange } from '../util/common.js';

export function lootCommand({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.18.0.21', '1.18.0.21')
        || testMinecraftVersionInRange(coreVersion, '1.18.10.21', '*')
        || testMinecraftVersionInRange(coreVersion, '1.18.10.04', '1.18.10.04')
    );
}

export function lootTable({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.18.0.21', '*')
        || testMinecraftVersionInRange(coreVersion, '1.18.0.02', '1.18.0.02')
    );
}

export function damageCommand({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.18.10.26', '*')
        || testMinecraftVersionInRange(coreVersion, '1.18.10.04', '1.18.10.04')
    );
}

export function hasItemSelectorParam({ coreVersion }) {
    return testMinecraftVersionInRange(coreVersion, '1.18.20.21', '*');
}

export function placefeatureCommand({ coreVersion }) {
    return testMinecraftVersionInRange(coreVersion, '1.18.20.25', '1.18.20.26');
}

export function newLocateCommand({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.19.10.23', '*')
        || testMinecraftVersionInRange(coreVersion, '1.19.10.03', '1.19.10.03')
    );
}

export function inputpermissionCommand({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.19.80.21', '*')
        || testMinecraftVersionInRange(coreVersion, '1.19.80.02', '1.19.80.02')
    );
}

export function cameraCommand({ coreVersion, branch }) {
    if (branch.id === 'experiment') {
        return (
            testMinecraftVersionInRange(coreVersion, '1.20.0.22', '*')
            || testMinecraftVersionInRange(coreVersion, '1.20.0.01', '1.20.0.01')
        );
    }
    return testMinecraftVersionInRange(coreVersion, '1.20.20.22', '*');
}

export function recipeNewCommand({ coreVersion, branch }) {
    if (branch.id === 'experiment') {
        return testMinecraftVersionInRange(coreVersion, '1.20.20.20', '*');
    }
    if (branch.id === 'education') {
        return testMinecraftVersionInRange(coreVersion, '1.20.40.23', '1.20.40.23');
    }
    return testMinecraftVersionInRange(coreVersion, '1.20.20.21', '*');
}

export function hudCommand({ coreVersion, branch }) {
    if (branch.id === 'experiment') {
        return testMinecraftVersionInRange(coreVersion, '1.20.60.23', '*');
    }
    return false;
}

export function mcpews({ version }) {
    return version !== 'netease' && version !== 'netease_dev';
}

export function eduCommands({ branch }) {
    return branch.id === 'education';
}

export function devCommands({ version }) {
    return version === 'dev' || version === 'release_dev';
}

export function devCommandsGameSpace({ branch }) {
    return branch.id === 'experiment';
}
