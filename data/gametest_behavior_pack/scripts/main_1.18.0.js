import * as Minecraft from "mojang-minecraft";
import * as GameTest from "mojang-gametest";

Minecraft.world.events.tick.subscribe(() => {});

GameTest.register("gametest", "remote", (test) => {
    test.succeed();
});
