const { testMinecraftVersionInRange } = require("../util/common");

module.exports = {
    lootCommand(coreVersion) {
        return (
            testMinecraftVersionInRange(coreVersion, "1.18.0.21", "1.18.0.21") ||
            testMinecraftVersionInRange(coreVersion, "1.18.10.21", "*") ||
            testMinecraftVersionInRange(coreVersion, "1.18.10.04", "1.18.10.04")
        );
    },
    lootTable(coreVersion) {
        return testMinecraftVersionInRange(coreVersion, "1.18.0.21", "*");
    },
    damageCommand(coreVersion) {
        return (
            testMinecraftVersionInRange(coreVersion, "1.18.10.26", "*") ||
            testMinecraftVersionInRange(coreVersion, "1.18.10.04", "1.18.10.04")
        );
    },
    hasItemSelectorParam(coreVersion) {
        return testMinecraftVersionInRange(coreVersion, "1.18.20.21", "*");
    },
    placefeatureCommand(coreVersion) {
        return testMinecraftVersionInRange(coreVersion, "1.18.20.25", "1.18.20.26");
    },
    mcpews(versionType) {
        return versionType != "netease" && versionType != "netease_dev";
    }
};
