const { testMinecraftVersionInRange } = require("../util/common");

module.exports = {
    lootCommand(packageVersion) {
        return (
            testMinecraftVersionInRange(packageVersion, "1.18.0.21", "1.18.0.21") ||
            testMinecraftVersionInRange(packageVersion, "1.18.10.21", "*")
        );
    },
    lootTable(packageVersion) {
        return testMinecraftVersionInRange(packageVersion, "1.18.0.21", "*");
    },
    damageCommand(packageVersion) {
        return testMinecraftVersionInRange(packageVersion, "1.18.10.26", "*");
    }
};
