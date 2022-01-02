const fs = require("fs");
const { WSApp } = require("mcpews");
const { projectPath } = require("./util/common");

const MAX_BLOCK_DATA_VALUE = 15;
const BASE = [ 0, -59, 0 ];

async function generate(session, blockIds) {
    let i, j;
    await session.command(`tp @s ${BASE[0]} ${BASE[1] + 2} ${BASE[2] + i * 2}`);
    await session.command(`fill ${BASE[0] - 1} ${BASE[1] - 1} ${BASE[2] + 1} ${BASE[0] + MAX_BLOCK_DATA_VALUE * 2 + 1} ${BASE[1] + 1} ${BASE[2] + 2} air`)
    for (i = 0; i < blockIds.length; i++) {
        const promises = [];
        await session.command(`fill ${BASE[0] - 1} ${BASE[1] - 1} ${BASE[2] + i * 2 - 1} ${BASE[0] + MAX_BLOCK_DATA_VALUE * 2 + 1} ${BASE[1] + 1} ${BASE[2] + i * 2 + 1} barrier`);
        promises.push(session.command(`fill ${BASE[0] - 1} ${BASE[1] - 1} ${BASE[2] + i * 2 + 2} ${BASE[0] + MAX_BLOCK_DATA_VALUE * 2 + 1} ${BASE[1] + 1} ${BASE[2] + i * 2 + 2} air`));
        for (j = 0; j <= MAX_BLOCK_DATA_VALUE; j++) {
            promises.push(session.command(`setblock ${BASE[0] + j * 2} ${BASE[1]} ${BASE[2] + i * 2} ${blockIds[i]} ${j}`));
        }
        await Promise.all(promises);
    }
}

async function main([ version, branch, build ]) {
    const data = JSON.parse(fs.readFileSync(projectPath(`output.web.${version}.${branch}`), "utf-8"));
    const blocks = data.enums["block"];
    const blockIds = Object.keys(blocks);
    const app = new WSApp(19134);
    console.log(`Type "/connect <ip address>:19134" in the game console to connect.`);
    const session = await app.waitForSession();
    console.log(`Connected!`);
    if (build == "build") {
        generate(session, blockIds);
    }
    while (true) {
        let playerPos = JSON.parse((await session.command("querytarget @s")).details)[0].position;
        await session.command(`title @a actionbar ${blockIds[Math.floor(playerPos.z / 2)]} ${Math.floor(playerPos.x / 2)}`);
    }
}

main(process.argv.slice(2)).catch(err => {
    console.error(err);
    debugger;
});