import { warn } from './common.js';

const MAGIC = Buffer.from([0x7d, 0x27, 0x25, 0xb1, 0xa0, 0x52, 0x70, 0x26]);
const ENTRYS_OFFSET = 16;
const ENTRY_SIZE = 256;

/**
 * @param {Buffer} buffer
 */
export function parseBrarchive(buffer) {
    const magic = buffer.subarray(0, MAGIC.length);
    if (!MAGIC.equals(magic)) {
        throw new Error('Invalid brarchive magic number');
    }

    const entryCount = buffer.readUInt32LE(8);
    const version = buffer.readUInt32LE(12);
    if (version !== 1) {
        warn(`Unexpected brarchive version: ${version}`);
    }
    const entries = [];

    for (let i = 0; i < entryCount; i++) {
        const entryStart = ENTRYS_OFFSET + i * ENTRY_SIZE;
        const nameLength = buffer.readUInt8(entryStart);
        const name = buffer.subarray(entryStart + 1, entryStart + 1 + nameLength);
        const offset = buffer.readUInt32LE(entryStart + 248);
        const length = buffer.readUInt32LE(entryStart + 252);
        entries.push({ name: name.toString('utf-8'), offset, length });
    }

    const dataBlockOffset = ENTRYS_OFFSET + ENTRY_SIZE * entryCount;
    for (const entry of entries) {
        const dataStart = dataBlockOffset + entry.offset;
        const dataEnd = dataStart + entry.length;
        entry.content = buffer.subarray(dataStart, dataEnd);
    }

    return entries;
}
