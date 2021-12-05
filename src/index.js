const {
    generateOutputFiles,
    generateTranslatorHelperFiles,
    generateOutputIndex
} = require("./generate");

async function main() {
    const branches = generateOutputIndex();
    let i;
    for (i = 0; i < branches.length; i++) {
        console.log("Generating output files for " + branches[i] + "...");
        await generateOutputFiles(branches[i]);
    }
}

main().catch(err => {
    console.error(err);
    debugger;
});