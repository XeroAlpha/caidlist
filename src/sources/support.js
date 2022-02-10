const { testMinecraftVersionInRange } = require("../util/common");

module.exports = {
    lootCommand(packageVersion) {
        return (
            testMinecraftVersionInRange(packageVersion, "1.18.0.21", "1.18.0.21") ||
            testMinecraftVersionInRange(packageVersion, "1.18.10.21", "*") ||
            testMinecraftVersionInRange(packageVersion, "1.18.10.04", "1.18.10.04")
        );
    },
    lootTable(packageVersion) {
        return testMinecraftVersionInRange(packageVersion, "1.18.0.21", "*");
    },
    damageCommand(packageVersion) {
        return (
            testMinecraftVersionInRange(packageVersion, "1.18.10.26", "*") ||
            testMinecraftVersionInRange(packageVersion, "1.18.10.04", "1.18.10.04")
        );
    },
    hasItemSelectorParam(packageVersion) {
        return testMinecraftVersionInRange(packageVersion, "1.18.20.21", "*");
    },
    placefeatureCommand(packageVersion) {
        return testMinecraftVersionInRange(packageVersion, "1.18.20.25", "*");
    },
    mcpews(versionType) {
        return versionType != "netease" && versionType != "netease_dev";
    }
};
