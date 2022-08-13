const { generateOutputFiles, generateOutputIndex } = require('./generate');
const { forEachArray } = require('./util/common');
const config = require('../data/config');

async function main(args) {
    const context = { ...config };
    if (args[0] === 'generate') {
        const versionIds = args.slice(1).reverse();
        await forEachArray(versionIds, async (versionId) => {
            context.version = versionId;
            const branches = generateOutputIndex(context);
            console.log(`Current version: ${versionId} (${context.packageVersions[versionId].version})`);
            await forEachArray(branches, async (branch) => {
                context.branch = branch;
                console.log(`Generating output files for ${versionId}/${branch.id}...`);
                await generateOutputFiles(context);
            });
        });
    } else {
        throw new Error(`Unknown task: ${args[0]}`);
    }
}

main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    debugger;
});
