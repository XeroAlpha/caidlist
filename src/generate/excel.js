const XLSX = require('xlsx');

function writeTransMapsExcel(outputFile, transMaps) {
    const wb = XLSX.utils.book_new();
    for (const [mapName, transMap] of Object.entries(transMaps)) {
        const aoa = Object.keys(transMap).map((key) => [key, transMap[key]]);
        const ws = XLSX.utils.aoa_to_sheet([['名称', '翻译'], ...aoa]);
        XLSX.utils.book_append_sheet(wb, ws, mapName);
    }
    XLSX.writeFile(wb, outputFile);
}

module.exports = {
    writeTransMapsExcel
};
