import * as xlsx from '@e965/xlsx';
import { writeFileSync } from 'fs';

export default function writeTransMapsExcel(outputFile, transMaps) {
    const wb = xlsx.utils.book_new();
    for (const [mapName, transMap] of Object.entries(transMaps)) {
        const aoa = Object.keys(transMap).map((key) => [key, transMap[key]]);
        const ws = xlsx.utils.aoa_to_sheet([['名称', '翻译'], ...aoa]);
        xlsx.utils.book_append_sheet(wb, ws, mapName);
    }
    const xlsxData = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    writeFileSync(outputFile, xlsxData);
}
