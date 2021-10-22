// 安装包版本
exports.installPackageVersion = "1.17.40.21";
// 安装包路径
exports.installPackagePath = "H:\\BedrockVersions\\New\\Minecraft_1.17.40b2 (1.17.40.21)_armv8.apks";
// 安装包类型（release 表示正式版，beta 表示开发版，netease 表示网易版）
exports.installPackageType = "beta";

//#region 此部分仅 OCR 需要使用，无需 OCR 则请勿修改
exports.tesseract = {
    // Tesseract 安装路径
    "binary": "\"C:\\Program Files\\Tesseract-OCR\\tesseract.exe\"",
    // 训练数据路径
    "tessdata-dir": __dirname + "/tesstrain/tessdata"
}

// 命令区域大小
exports.commandAreaRect = {
    "1": [479, 950, 1650, 125], // <- phone
    "3": [410, 950, 1650, 125]  // phone ->
};
//#endregion