import nodePath from 'path';
import { projectRoot } from '../src/util/common.js';

// 此部分仅 OCR 需要使用，无需 OCR 则请勿修改
const commonOCROptions = {
    tesseractOptions: {
        // Tesseract 安装路径
        binary: '"C:\\Program Files\\Tesseract-OCR\\tesseract.exe"',
        // 训练数据路径
        'tessdata-dir': nodePath.resolve(projectRoot, 'data/tesstrain/tessdata')
    },
    // 命令区域大小
    commandAreaRect: {
        1: [479, 950, 1650, 125], // <- phone
        3: [410, 950, 1650, 125] // phone ->
    },
    // OCR识别错误手动校正
    tesseractMistakes: {
        '\'n"\'sUmmOn Creeper': '/summon creeper',
        '\'n"\'sUmmOn raVager': '/summon ravager'
    }
};

// const smallerGUIOCROptions = { // GUI Scale = -1
//     ...commonOCROptions,
//     // 命令区域大小
//     commandAreaRect: {
//         1: [397, 976, 1784, 100], // <- phone
//         3: [328, 976, 1784, 100] // phone ->
//     },
//     tesseractMistakes: {
//         '\'/sUmmOn Creeper': '/summon creeper',
//         '\'/sUmmOn raVager': '/summon ravager'
//     }
// };

const smallestGUIOCROptions = { // GUI Scale = -2
    ...commonOCROptions,
    // 命令区域大小
    commandAreaRect: {
        1: [315, 1002, 1920, 75], // <- phone
        3: [246, 1002, 1920, 75] // phone ->
    },
    tesseractMistakes: {
        '\'/summon Creeper': '/summon creeper',
        '\'/summon ravager': '/summon ravager'
    }
};

const neteaseOCROptions = {
    ...commonOCROptions,
    // 命令区域大小
    commandAreaRect: {
        1: [424, 922, 1660, 100], // <- phone
        3: [424, 922, 1660, 100] // phone ->
    },
    // OCR识别错误手动校正
    tesseractMistakes: {
        '/sUmmOn Creeper': '/summon creeper',
        '/sUmmOn raVager': '/summon ravager'
    }
};

export const packageVersions = {
    // 正式版
    release: {
        // 安装包版本
        version: '1.19.31.01',
        // 安装包路径
        path: 'H:\\BedrockVersions\\Latest\\1.19.31.01.apk',
        // 可用分支
        branches: ['vanilla', 'education', 'experiment', 'documentation'],
        config: smallestGUIOCROptions
    },
    // 测试版
    beta: {
        // 安装包版本
        version: '1.19.40.24',
        // 安装包路径
        path: 'H:\\BedrockVersions\\Latest\\1.19.40.24.apk',
        // 可用分支
        branches: [
            'vanilla',
            'education',
            'experiment',
            'gametest',
            'translator',
            'documentation',
            'langParity'
        ],
        config: smallestGUIOCROptions
    },
    // 中国版测试版
    netease_dev: {
        // 安装包版本
        version: '2.1beta-159689', // 由于资源包BUG暂停更新
        coreVersion: '1.17.3.0.0',
        // 安装包路径
        path: 'H:\\BedrockVersions\\NeteaseDev\\dev_launcher_2.1.100.159689.apk',
        // 可用分支
        branches: ['vanilla', 'experiment'],
        config: neteaseOCROptions
    }
};

export const proxyConfig = {
    http: 'http://localhost:7890',
    https: 'http://localhost:7890'
};
