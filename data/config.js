
exports.packageVersions = {
    release: { // 正式版
        // 安装包版本
        version: "1.18.1.02",
        // 安装包路径
        path: "H:\\BedrockVersions\\New\\Minecraft_1.18.1 (1.18.1.02)_armv8.apks",
        // 可用分支
        branches: [ "vanilla", "education", "experiment" ]
    },
    beta: { // 测试版
        // 安装包版本
        version: "1.18.10.21",
        // 安装包路径
        path: "H:\\BedrockVersions\\New\\Minecraft_1.18.10b2 (1.18.10.21)_armv8.apks",
        // 可用分支
        branches: [ "translator", "vanilla" ]
    }
};

//#region 此部分仅 OCR 需要使用，无需 OCR 则请勿修改
exports.tesseractOptions = {
    // Tesseract 安装路径
    "binary": "\"C:\\Program Files\\Tesseract-OCR\\tesseract.exe\"",
    // 训练数据路径
    "tessdata-dir": __dirname + "/tesstrain/tessdata"
};

// 命令区域大小
exports.commandAreaRect = {
    "1": [479, 950, 1650, 125], // <- phone
    "3": [410, 950, 1650, 125]  // phone ->
};

// OCR识别错误手动校正
exports.tesseractMistakes = {
    "'n\"'sUmmOn Creeper": "/summon creeper",
    "'n\"'sUmmOn raVager": "/summon ravager"
};
//#endregion