import { testMinecraftVersionInRange } from '../util/common.js';

export function textCommandWebSocketFormat({ coreVersion }) {
    return testMinecraftVersionInRange(coreVersion, '1.2', '*');
}

export function eventCommand({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.16.100.57', '*') ||
        testMinecraftVersionInRange(coreVersion, '1.16.100.04', '1.16.100.04')
    );
}
eventCommand.associatedCommands = [['/event entity <target: target> <eventName: string>']];

export function lootCommand({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.18.0.21', '1.18.0.21') ||
        testMinecraftVersionInRange(coreVersion, '1.18.10.21', '*') ||
        testMinecraftVersionInRange(coreVersion, '1.18.10.04', '1.18.10.04')
    );
}
lootCommand.associatedCommands = [
    ['/loot spawn <position: x y z> loot <loot_table: string> [<tool>|mainhand|offhand: string]']
];

export function lootTable({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.18.0.21', '*') ||
        testMinecraftVersionInRange(coreVersion, '1.18.0.02', '1.18.0.02')
    );
}

export function damageCommand({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.18.10.26', '*') ||
        testMinecraftVersionInRange(coreVersion, '1.18.10.04', '1.18.10.04')
    );
}
damageCommand.associatedCommands = [['/damage <target: target> <amount: int> [cause: DamageCause]']];

export function hasItemSelectorParam({ coreVersion }) {
    return testMinecraftVersionInRange(coreVersion, '1.18.20.21', '*');
}
hasItemSelectorParam.associatedSelectors = [['hasitem']];

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
        testMinecraftVersionInRange(coreVersion, '1.19.10.23', '*') ||
        testMinecraftVersionInRange(coreVersion, '1.19.10.03', '1.19.10.03')
    );
}
newLocateCommand.associatedCommands = [
    ['/locate biome <biome: Biome>', '/locate structure <structure: Structure> [useNewChunksOnly: Boolean]'],
    ['/locate biome <biome: Biome>', '/locate structure <structure: string> [useNewChunksOnly: Boolean]']
];

export function newExecuteCommand({ coreVersion, branch }) {
    if (branch.id === 'experiment') {
        return (
            testMinecraftVersionInRange(coreVersion, '1.19.40.23', '*') ||
            testMinecraftVersionInRange(coreVersion, '1.19.40.02', '1.19.40.02')
        );
    }
    return (
        testMinecraftVersionInRange(coreVersion, '1.19.50.23', '*') ||
        testMinecraftVersionInRange(coreVersion, '1.19.50.02', '1.19.50.02')
    );
}
newExecuteCommand.associatedCommands = [
    ['/execute in <dimension: Dimension> <chainedCommand: ExecuteChainedOption_0>']
];

export function inputpermissionCommand({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.19.80.21', '*') ||
        testMinecraftVersionInRange(coreVersion, '1.19.80.02', '1.19.80.02')
    );
}
inputpermissionCommand.associatedCommands = [
    ['/inputpermission query <targets: target> <permission: permission> [state: state]']
];

export function cameraCommand({ coreVersion, branch }) {
    if (branch.id === 'experiment') {
        return (
            testMinecraftVersionInRange(coreVersion, '1.20.0.22', '*') ||
            testMinecraftVersionInRange(coreVersion, '1.20.0.01', '1.20.0.01')
        );
    }
    return testMinecraftVersionInRange(coreVersion, '1.20.20.22', '*');
}
cameraCommand.associatedCommands = [
    [
        '/camera <players: target> set <preset: string> [default: default]',
        '/camera <players: target> set <preset: string> ease <easeTime: float> <easeType: Easing> [default: default]'
    ]
];

export function recipeNewCommand({ coreVersion, branch }) {
    if (branch.id === 'experiment') {
        return testMinecraftVersionInRange(coreVersion, '1.20.20.20', '*');
    }
    if (branch.id === 'education') {
        return (
            testMinecraftVersionInRange(coreVersion, '1.20.40.23', '1.20.40.23') ||
            testMinecraftVersionInRange(coreVersion, '1.20.50.03', '*')
        );
    }
    return testMinecraftVersionInRange(coreVersion, '1.20.20.21', '*');
}
recipeNewCommand.associatedCommands = [['/recipe take <player: target> <recipe: string>']];

export function hudCommand({ coreVersion, branch }) {
    if (branch.id === 'experiment') {
        return (
            testMinecraftVersionInRange(coreVersion, '1.20.60.23', '*') ||
            testMinecraftVersionInRange(coreVersion, '1.20.60.04', '1.20.60.04')
        );
    }
    return (
        testMinecraftVersionInRange(coreVersion, '1.20.80.23', '*') ||
        testMinecraftVersionInRange(coreVersion, '1.20.80.05', '1.20.80.05')
    );
}
hudCommand.associatedCommands = [['/hud <target: target> <visible: HudVisibility> [hud_element: HudElement]']];

export function hasPropertySelectorParam({ coreVersion }) {
    return testMinecraftVersionInRange(coreVersion, '1.20.70.21', '*');
}
hasPropertySelectorParam.associatedSelectors = [['has_property']];

export function placeCommandStructureSubCommand({ coreVersion, branch }) {
    if (branch.id === 'experiment') {
        return (
            testMinecraftVersionInRange(coreVersion, '1.21.50.26', '*') ||
            testMinecraftVersionInRange(coreVersion, '1.21.50.07', '1.21.50.07')
        );
    }
    return (
        testMinecraftVersionInRange(coreVersion, '1.21.80.22', '*') ||
        testMinecraftVersionInRange(coreVersion, '1.21.80.3', '1.21.80.3')
    );
}
placeCommandStructureSubCommand.associatedCommands = [
    ['/place structure <structure: string> [pos: x y z] [ignoreStartHeight: Boolean] [keepJigsaws: Boolean]'],
    [
        '/place structure <structure: string> [pos: x y z] [ignoreStartHeight: Boolean] [keepJigsaws: Boolean] [includeEntities: Boolean]'
    ],
    [
        '/place structure <structure: string> [pos: x y z] [ignoreStartHeight: Boolean] [keepJigsaws: Boolean] [includeEntities: Boolean] [liquidSettings: LiquidSettings]'
    ]
];

export function placeCommandFeatureSubCommand({ coreVersion, branch }) {
    if (branch.id === 'experiment') {
        return (
            testMinecraftVersionInRange(coreVersion, '1.21.60.23', '*') ||
            testMinecraftVersionInRange(coreVersion, '1.21.60.10', '1.21.60.10')
        );
    }
    return (
        testMinecraftVersionInRange(coreVersion, '1.21.70.22', '*') ||
        testMinecraftVersionInRange(coreVersion, '1.21.70.03', '1.21.70.03')
    );
}
placeCommandFeatureSubCommand.associatedCommands = [
    [
        '/place feature <feature: features> [position: x y z]',
        '/place featurerule <featurerule: featureRules> [position: x y z]'
    ]
];

export function controlSchemeCommand({ coreVersion, branch }) {
    if (branch.id === 'experiment') {
        return (
            testMinecraftVersionInRange(coreVersion, '1.21.80.27', '*') ||
            testMinecraftVersionInRange(coreVersion, '1.21.80.3', '1.21.80.3')
        );
    }
    return (
        testMinecraftVersionInRange(coreVersion, '1.21.90.23', '*') ||
        testMinecraftVersionInRange(coreVersion, '1.21.90.3', '1.21.90.3')
    );
}
controlSchemeCommand.associatedCommands = [['/controlscheme <players: target> set <control scheme: controlscheme>']];

export function inputBoxRequiresManualFocus({ coreVersion }) {
    return (
        testMinecraftVersionInRange(coreVersion, '1.21.120.25', '1.21.130.22') &&
        !testMinecraftVersionInRange(coreVersion, '1.21.121.1', '1.21.121.1')
    );
}

export function mcpews({ version }) {
    return version !== 'netease' && version !== 'netease_dev';
}

// Education branch detector
export function eduCommands({ branch }) {
    return branch.id === 'education';
}
eduCommands.associatedCommands = [
    [
        '/ability <player: target> <ability: Ability> <value: Boolean>',
        '/ability <player: target> [ability: Ability]',
        '/immutableworld [value: Boolean]',
        '/wb',
        '/worldbuilder'
    ]
];

export function devCommands({ version }) {
    return version === 'dev' || version === 'release_dev';
}

export function devCommandsGameSpace({ branch }) {
    return branch.id === 'experiment';
}
