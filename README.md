# 命令助手ID表生成工具
## 简介
命令助手作者使用此工具生成ID表。

## 工作流
请视情况选择工作流。

- 仅导出自带版本：准备、运行、校对
- 导出任意版本：准备、准备 OCR、清空导出数据、运行（仅OCR）、运行、校对

### 准备
1. 确认已安装 Node.js 最新版。
2. 运行命令 `npm install` 开始安装。

### 准备 OCR
1. 确认已安装 Tesseract 与 adb。
2. 将支持 USB 调试的手机连接至电脑。
3. 准备一个 Minecraft 安装包（支持 apks 格式和 apk 格式）。
4. 将上述 Minecraft 安装包安装到手机上。
5. 从安装包中找到 Mojangles 字体，使用 Tesseract 训练出模型（如已训练过可直接使用训练过的模型）。
    - 如果您的 Minecraft 使用的字体不是默认的像素字体（即 Mojangles / Minecraft Seven），请使用 Minecraft 正在使用的字体进行训练。
6. 按文件中的注释修改 `config.js`。

### 清空导出数据
1. 删除 `output` 目录下所有以 `output` 开头的文件。
2. 如果提供了 Minecraft 安装包，请删除 `output` 目录下所有以 `package` 开头的文件。
3. 如果需要重新进行 OCR，请删除 `output` 目录下所有以 `autocompleted` 开头的文件。
4. 如果不想使用仓库内自带的翻译，请删除 `output` 目录下所有以 `translation` 开头的文件。
5. 如果需要强制刷新标准化译名表的缓存，请删除 `output` 目录下所有以 `wiki` 开头的文件。

### 运行
1. 运行 `node index.js`。

### 运行（仅OCR）
1. 运行 `node index.js`。
2. 打开 Minecraft，进入一个已开启作弊的单人世界，等待游戏进入HUD界面。在终端出现 `Press <Enter> if the device is ready` 提示且游戏已进入HUD界面时，按下回车。出现 `Please switch to a education world` 提示时，进入一个已开启作弊的教育版世界。出现 `Please switch to a experiment world` 提示时，进入一个已开启作弊与所有实验性功能的单人世界。
3. 此过程中如果终端没有提示要求操作，请不要控制手机，也不要让 Minecraft 切至后台，否则可能导致流程失败。如果遵守上述要求后仍然出现提示 `Auto-completed command test failed`，可能为 Tesseract 识别出错，您需要将错误的条目和正确的条目手动保存到 `tesseract_mistakes.json` 以便让本工具手动纠正。

### 校对
1. 检查输出的 `output.ids.json`（拓展包）与 `output.ids.xlsx`（ID-翻译对照表）。发现错译、漏译时请修改对应的 `translate.xxxxx.json`，随后从“运行”工作流继续。
2. `translate.xxxxx.json` 支持引用标准化译名表数据，并且支持从其他译名拼接出新的译名。请尽量使用标准化译名或者由标准化译名拼接而来的翻译。