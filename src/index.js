import { generateOutputFiles, generateOutputIndex } from './generate.js';
import { forEachArray, log, warn } from './util/common.js';
import * as config from '../data/config.js';
import { measureAutocompletion } from './sources/autocompletion.js';

async function main(args) {
    const context = { ...config };
    if (process.env.MEASURE_AUTOCOMPLETION) {
        measureAutocompletion();
    }
    if (args[0] === 'generate') {
        const versionIds = args.slice(1).reverse();
        await forEachArray(versionIds, async (versionId) => {
            context.version = versionId;
            const branches = generateOutputIndex(context);
            log(`Current version: ${versionId} (${context.packageVersions[versionId].version})`);
            await forEachArray(branches, async (branch) => {
                context.branch = branch;
                log(`Generating output files for ${versionId}/${branch.id}...`);
                await generateOutputFiles(context);
            });
        });
    } else {
        throw new Error(`Unknown task: ${args[0]}`);
    }
}

main(process.argv.slice(2)).catch((err) => {
    warn('Fatal error', err);
    debugger;
    process.exit(1);
});
