import * as Minecraft from "mojang-minecraft";
import * as GameTest from "mojang-gametest";

let totalTicks = 0;
const onTick = () => {
    totalTicks += 1; // trigger debugger to response since quickjs does not provide a message loop
    (() => {})(Minecraft, totalTicks);
};
if (Minecraft.world.events.tick) {
    Minecraft.world.events.tick.subscribe(onTick);
} else {
    const queued = () => {
        onTick();
        Minecraft.system.run(queued);
    };
    Minecraft.system.run(queued);
}

GameTest.register("gametest", "remote", (test) => {
    test.succeed();
    /* BREAKPOINT HERE */ (() => {})(test, Minecraft, totalTicks);
});
