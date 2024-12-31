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
        const versionAndBranchIds = args.slice(1).reverse();
        await forEachArray(versionAndBranchIds, async (versionAndBranchId) => {
            const [versionId, branchId] = versionAndBranchId.split('/');
            context.version = versionId;
            const branches = generateOutputIndex(context);
            log(`Current version: ${versionId} (${context.packageVersions[versionId].version})`);
            await forEachArray(branches, async (branch) => {
                if (branchId && branchId !== branch.id) return;
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
    // eslint-disable-next-line no-debugger
    debugger;
    process.exit(1);
});
