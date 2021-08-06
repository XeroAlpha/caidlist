// 安装包版本
exports.installPackageVersion = "1.17.20.23";
// 安装包路径
exports.installPackagePath = "H:\\BedrockPackagesJws\\正式版\\1.17\\beta\\1.17.20\\1.17.20.23_b4.apks";

//#region 此部分仅 OCR 需要使用，无需 OCR 则请勿修改
exports.tesseract = {
    // Tesseract 安装路径
    "binary": "\"C:\\Program Files\\Tesseract-OCR\\tesseract.exe\"",
    // 训练数据路径
    "tessdata-dir": __dirname + "/tesstrain/tessdata"
}

// ← 屏幕朝向
exports.surfaceOrientation = 1;
// 命令区域大小
exports.commandAreaRect = [479, 950, 1650, 125];
//#endregion