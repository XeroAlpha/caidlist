import * as Minecraft from "@minecraft/server";
import * as GameTest from "@minecraft/server-gametest";

globalThis.totalTicks = 0;
Minecraft.world.events.tick.subscribe(() => {
    globalThis.totalTicks += 1;
});

GameTest.register("gametest", "remote", (test) => {
    test.succeed();
});
