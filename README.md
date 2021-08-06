# 命令助手ID表生成工具
## 简介
命令助手作者使用此工具生成ID表。

## 工作流
请视情况选择工作流。

- 仅导出自带版本：准备、运行、校对
- 导出任意版本：准备、准备 OCR、清空导出数据、运行（仅OCR）、运行、校对

### 准备
1. 确认已安装 Node.js 最新版、 adb。
2. 运行命令 `npm install` 开始安装。
3. 准备一个 Minecraft 安装包（支持 apks 格式和 apk 格式）。
4. 按文件中的注释修改 `config.js`。

### 准备 OCR
1. 确认已安装 Tesseract。
2. 将支持 USB 调试的手机连接至电脑。
3. 将上文中提到的 Minecraft 安装包安装到手机上。
4. 从安装包中找到 Mojangles 字体，使用 Tesseract 训练出模型（如已训练过可直接使用训练过的模型）。
    - 如果您的 Minecraft 使用的字体不是默认的像素字体（即 Mojangles / Minecraft Seven），请使用 Minecraft 正在使用的字体进行训练。

### 清空导出数据
1. 删除 `output` 目录下所有 JSON 文件与 XLSX 文件。

### 运行
1. 运行 `node index.js`。

### 运行（仅OCR）
1. 运行 `node index.js`。
2. 在终端出现 `Please reset the command box` 提示时，打开 Minecraft，进入一个已开启作弊的单人世界，并打开聊天界面，选中并清空聊天框，在保证聊天框拥有焦点的情况下在电脑终端处按下回车。再次出现 `Please reset the command box` 提示时，将聊天框恢复成上述按回车时的状态再按下回车。
3. 此过程中请不要控制手机，也不要让 Minecraft 切至后台，否则可能导致流程失败。如果遵守上述要求后仍然出现提示 `Auto-completed command test failed`，可能为 Tesseract 识别出错，您需要将错误的条目和正确的条目手动保存到 `tesseract_mistakes.json` 以便让本工具手动纠正。

### 校对
1. 检查输出的 `output.ids.json`（拓展包）与 `ids.xlsx`（ID-翻译对照表）。发现错译、漏译时请修改对应的 `translate.xxxxx.json`，随后从“运行”工作流继续。
2. `translate.xxxxx.json` 支持引用标准化译名表数据，并且支持从其他译名拼接出新的译名。请尽量使用标准化译名或者由标准化译名拼接而来的翻译。