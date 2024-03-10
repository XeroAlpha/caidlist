import { resolve } from 'path';
import { fileURLToPath } from 'url';

export default {
    path: resolve(fileURLToPath(import.meta.url), '..', 'scrcpy-server-v2.4'),
    version: '2.4'
};
