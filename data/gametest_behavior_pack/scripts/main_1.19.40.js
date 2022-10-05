import * as Minecraft from "@minecraft/server";
import * as GameTest from "@minecraft/server-gametest";

Minecraft.world.events.tick.subscribe(() => {});

GameTest.register("gametest", "remote", (test) => {
    test.succeed();
});
