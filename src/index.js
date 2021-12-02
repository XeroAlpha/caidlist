const {
    generateOutputFiles,
    generateTranslatorHelperFiles
} = require("./generate");

async function main() {
    console.log("Generating output files for vanilla...");
    await generateOutputFiles("vanilla");
    console.log("Generating output files for education...");
    await generateOutputFiles("education");
    console.log("Generating output files for experiment...");
    await generateOutputFiles("experiment");
    console.log("Generating output files for translator...");
    await generateTranslatorHelperFiles();
}

main().catch(err => {
    console.error(err);
    debugger;
});