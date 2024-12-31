import * as Minecraft from '@minecraft/server';
import * as GameTest from '@minecraft/server-gametest';

globalThis.totalTicks = 0;
Minecraft.system.run(function handler() {
    globalThis.totalTicks += 1;
    Minecraft.system.run(handler);
});

GameTest.register('gametest', 'remote', (test) => {
    test.succeed();
});
