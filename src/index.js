const {
    generateOutputFiles,
    generateOutputIndex
} = require("./generate");
const config = require("../data/config");

async function main(args) {
    const context = { ...config };
    if (args[0] == "generate") {
        context.version = args[1];
        const branches = generateOutputIndex(context);
        let i;
        for (i = 0; i < branches.length; i++) {
            context.branch = branches[i];
            console.log("Generating output files for " + context.branch.id + "...");
            await generateOutputFiles(context);
        }
    } else {
        throw new Error("Unknown task: " + args[0]);
    }
}

main(process.argv.slice(2)).catch(err => {
    console.error(err);
    debugger;
});