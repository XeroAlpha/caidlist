import { testMinecraftVersionInRange } from '../util/common.js';

export function textCommandWebSocketFormat({ coreVersion }) {
    return testMinecraftVersionInRange(coreVersion, '1.2', '*');
}

export function lootCommand({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.18.0.21', '1.18.0.21')
        || testMinecraftVersionInRange(coreVersion, '1.18.10.21', '*')
        || testMinecraftVersionInRange(coreVersion, '1.18.10.04', '1.18.10.04')
    );
}
lootCommand.associatedCommands = [
    ['/loot spawn <position: x y z> loot <loot_table: string> [<tool>|mainhand|offhand: string]']
];

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
damageCommand.associatedCommands = [
    ['/damage <target: target> <amount: int> [cause: DamageCause]']
];

export function hasItemSelectorParam({ coreVersion }) {
    return testMinecraftVersionInRange(coreVersion, '1.18.20.21', '*');
}
hasItemSelectorParam.associatedSelectors = [
    ['hasitem']
];

export function placefeatureCommand({ coreVersion }) {
    return testMinecraftVersionInRange(coreVersion, '1.18.20.25', '1.18.20.26');
}
placefeatureCommand.associatedCommands = [
    [
        '/placefeature <featureName: Features> [position: x y z]',
        '/placefeature <featureRule: featureRules> [position: x y z]'
    ]
];

export function newLocateCommand({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.19.10.23', '*')
        || testMinecraftVersionInRange(coreVersion, '1.19.10.03', '1.19.10.03')
    );
}
newLocateCommand.associatedCommands = [
    [
        '/locate biome <biome: Biome>',
        '/locate structure <structure: Structure> [useNewChunksOnly: Boolean]'
    ]
];

export function inputpermissionCommand({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.19.80.21', '*')
        || testMinecraftVersionInRange(coreVersion, '1.19.80.02', '1.19.80.02')
    );
}
inputpermissionCommand.associatedCommands = [
    ['/inputpermission query <targets: target> <permission: permission> [state: state]']
];

export function cameraCommand({ coreVersion, branch }) {
    if (branch.id === 'experiment') {
        return (
            testMinecraftVersionInRange(coreVersion, '1.20.0.22', '*')
            || testMinecraftVersionInRange(coreVersion, '1.20.0.01', '1.20.0.01')
        );
    }
    return testMinecraftVersionInRange(coreVersion, '1.20.20.22', '*');
}
cameraCommand.associatedCommands = [
    ['/camera <players: target> set <preset: string> [default: default]']
];

export function recipeNewCommand({ coreVersion, branch }) {
    if (branch.id === 'experiment') {
        return testMinecraftVersionInRange(coreVersion, '1.20.20.20', '*');
    }
    if (branch.id === 'education') {
        return (
            testMinecraftVersionInRange(coreVersion, '1.20.40.23', '1.20.40.23')
            || testMinecraftVersionInRange(coreVersion, '1.20.50.03', '*')
        );
    }
    return testMinecraftVersionInRange(coreVersion, '1.20.20.21', '*');
}
recipeNewCommand.associatedCommands = [
    ['/recipe take <player: target> <recipe: string>']
];

export function hudCommand({ coreVersion, branch }) {
    if (branch.id === 'experiment') {
        return (
            testMinecraftVersionInRange(coreVersion, '1.20.60.23', '*')
            || testMinecraftVersionInRange(coreVersion, '1.20.60.04', '1.20.60.04')
        );
    }
    return testMinecraftVersionInRange(coreVersion, '1.20.80.23', '*');
}
hudCommand.associatedCommands = [
    ['/hud <target: target> <visible: HudVisibility> [hud_element: HudElement]']
];

export function hasPropertySelectorParam({ coreVersion }) {
    return testMinecraftVersionInRange(coreVersion, '1.20.70.21', '*');
}
hasPropertySelectorParam.associatedSelectors = [
    ['has_property']
];

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
