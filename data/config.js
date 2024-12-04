import nodePath from 'path';
import { projectRoot } from '../src/util/common.js';
import secret from './secret.js';
import smallestGUITessMistakes from './tess-mistakes.smallest.js';

// 此部分仅 OCR 需要使用，无需 OCR 则请勿修改
const commonOptions = {
    tesseractOptions: {
        // 训练数据路径/网址
        langPath: nodePath.resolve(projectRoot, 'data/tesstrain/tessdata'),
        // 训练数据是否通过gzip压缩
        gzip: false
    },
    // 屏幕大小
    screenSize: [2400, 1080],
    // 命令区域大小
    commandAreaRect: [410, 950, 1650, 125], // <- phone
    // 使用输入法
    ime: 'com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME',
    // OCR识别错误手动校正
    tesseractMistakes: [
        ['\'n"\'sUmmOn Creeper', '/summon creeper'],
        ['\'n"\'sUmmOn raVager', '/summon ravager']
    ],
    // 可调试行为包路径
    devBehaviorPackPath: '/sdcard/Android/data/com.mojang.minecraftpe/files/games/com.mojang/development_behavior_packs'
};

// eslint-disable-next-line no-unused-vars
const smallerGUIOptions = { // GUI Scale = -1
    ...commonOptions,
    // 命令区域大小
    commandAreaRect: [328, 976, 1784, 100],
    tesseractMistakes: [
        ['\'/sUmmOn Creeper', '/summon creeper'],
        ['\'/sUmmOn raVager', '/summon ravager']
    ]
};

const smallestGUIOptions = { // GUI Scale = -2
    ...commonOptions,
    // 命令区域大小
    commandAreaRect: [246, 1002, 1989, 75],
    tesseractMistakes: smallestGUITessMistakes
};

const neteaseOptions = {
    ...commonOptions,
    // 命令区域大小
    commandAreaRect: [424, 922, 1660, 100],
    // OCR识别错误手动校正
    tesseractMistakes: [
        ['/sUmmOn Creeper', '/summon creeper'],
        ['/sUmmOn raVager', '/summon ravager']
    ]
};

export const packageVersions = {
    // 正式版
    release: {
        // 安装包版本
        version: '1.21.50.07',
        // 安装包路径
        path: 'H:\\BedrockVersions\\Latest\\1.21.50.07.apks',
        config: {
            ...smallestGUIOptions,
            // 仅在 Android 端暂时无法使用时使用 Windows 10 版替代
            useWin10Edition: true
        }
    },
    // 测试版/预览版
    beta: {
        // 安装包版本
        version: '1.21.60.21',
        // 安装包路径
        path: 'H:\\BedrockVersions\\Latest\\1.21.60.21.apks',
        config: {
            ...smallestGUIOptions,
            // 仅在 Android 端暂时无法使用时使用 Windows 10 版替代
            useWin10Edition: true
        }
    },
    // 中国版测试版
    netease_dev: {
        // 安装包版本
        version: '2.6beta-224553',
        coreVersion: '1.18.31.0.0',
        // 安装包路径
        path: 'H:\\BedrockVersions\\NeteaseDev\\dev_launcher_2.6.100.224553.apk',
        config: neteaseOptions
    },
    // 预览版（Windows 端）
    preview_win: {
        // 应用版本
        version: '1.21.60.21',
        config: {
            devBehaviorPackPath: `${process.env.LOCALAPPDATA}\\Packages\\Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe\\LocalState\\games\\com.mojang\\development_behavior_packs`
        }
    },
    dev: {
        version: '1.21.60.21',
        path: 'H:\\BedrockVersions\\Dev\\1.21.60.21.apk',
        config: smallestGUIOptions
    }
};

// 留 null 表示不使用 token（每小时只允许60次请求）
export const githubToken = secret.githubAccessToken;
