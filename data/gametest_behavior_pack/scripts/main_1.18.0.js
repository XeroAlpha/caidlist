import * as Minecraft from "mojang-minecraft";
import * as GameTest from "mojang-gametest";

globalThis.totalTicks = 0;
Minecraft.world.events.tick.subscribe(() => {
    globalThis.totalTicks += 1;
});

GameTest.register("gametest", "remote", (test) => {
    test.succeed();
});
