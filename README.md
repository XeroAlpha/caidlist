# 命令助手ID表生成工具
## 简介
命令助手作者 [ProjectXero](https://github.com/XeroAlpha) 使用此工具生成ID表。

[MCBEID表](https://idlist.projectxero.top/)（[仓库](https://github.com/XeroAlpha/caidlistweb)）是基于此工具的数据制作的可离线使用的ID表查询网站。

[MCBEID表 在线搜索API](./backend/API.md) 是基于此工具的数据制作的在线ID表搜索接口。

本仓库中包含了用于生成ID表的原始数据与部分导出数据，请参见[目录结构](#目录结构)。

如果您希望使用此工具生成特定版本的数据，请参见 [工作流](#工作流)。

如果您希望改善此工具的数据中的翻译部分，请参见 [翻译指南](./translation/README.md)。

如果您希望数据中包含更多的内容或版本，欢迎提出 Issue。

## 目录结构

### 原始数据

原始数据均存储在 `version` 目录中。

`version/common` 目录下存储了与工作流无关的数据。

|路径|内容|
| - | - |
|`version/common/wiki/standardized_translation.json`|[Minecraft Wiki](https://zh.minecraft.wiki/w/Minecraft_Wiki:%E8%AF%91%E5%90%8D%E6%A0%87%E5%87%86%E5%8C%96) 与 [基岩版开发Wiki](https://wiki.mcbe-dev.net/p/Minecraft%E5%9F%BA%E5%B2%A9%E7%89%88%E5%BC%80%E5%8F%91Wiki:%E8%AF%91%E5%90%8D%E6%A0%87%E5%87%86%E5%8C%96) 中的标准译名表。|
|`version/java/lang.json`|最新Java版（含快照）的简体中文与英文语言文件。|
|`version/documentation/`|基岩版官方内容包文档，提取自[官方示例内容包仓库](https://github.com/Mojang/bedrock-samples)。|
|`version/documentation/<edition>.json`|从对应版本的文档中提取的数据。|
|`version/documentation/<edition>/<name>.json`|文档解析成的 JSON。|

`version/<edition>` 目录下存储了可通过 `data/config.js` 配置版本的相关数据。

|路径|内容|
| - | - |
|`version/<edition>/autocompletion/`|通过扫描自动补全列表获取的数据。|
|`version/<edition>/autocompletion/<branch>.json`|在对应分支下扫描自动补全列表的结果。|
|`version/<edition>/autocompletion/<branch>/<id>.json`|对上一条的细分。|
|`version/<edition>/autocompletion/<branch>/mcpews.json`|通过 [mcpews](https://github.com/mcpews/mcpews) 获取的数据。|
|`version/<edition>/gametest/`|通过 [quickjs-debugger](https://github.com/XeroAlpha/quickjs-debugger) 从 Script API 获取的数据。|
|`version/<edition>/package/`|对安装包进行静态分析所获得的数据。|
|`version/<edition>/package/info.json`| 安装包的基础信息。|
|`version/<edition>/package/lang.json`| 安装包的简体中文与英文语言文件。|
|`version/<edition>/package/data.json`| 对安装包的内置内容包进行分析所获得的数据。|

### 导出数据

导出数据均存储在 `output` 目录中。

|路径|内容|
| - | - |
|`output/clib/<edition>/<branch>.json`|对应分支的命令库。|
|`output/clib/<edition>/patch/<branch>.json`|对应分支在原版分支基础上的增量命令库。|
|`output/langParity/<edition>/difference.json`|列出同一个英文在Java版与基岩版对应的不同英文。|
|`output/langParity/<edition>/output.lang`|基于上述分析制作的译名修正语言文件。|
|`output/langParity/<edition>/output.mcpack`|基于上述分析制作的译名修正语言包。|
|`output/translation/<edition>/<branch>.json`|列出对应分支下的翻译状态。|
|`output/translation/<edition>/<branch>.xlsx`|列出对应分支下的翻译状态。|
|`output/web/`| 由MCBEID表与在线搜索API使用的数据。|

### 翻译

请参见 [翻译指南](./translation/README.md)。

### 版本

|`<edition>`|名称|备注|
| - | - | - |
|beta|测试版/预览版|更新速度快，包含较多不稳定的新特性的版本。|
|release|正式版|更新速度慢，向所有人开放的稳定版本。|
|netease|中国版|由网易推出的中国本地化版本，通常落后于正式版。|
|netease_dev|中国版测试版|面向中国版开发者开放的测试版本。|
|education|教育版|为教室使用而设计的教学版本。|
|preview_win|预览版（Windows）|Windows 10/11 上的预览版。|
|bds_preview|专用服务器预览版|预览版的专用服务器版本。|
|bds|专用服务器正式版|正式版的专用服务器版本。|
|dev|预览版开发版|同预览版，但包含部分开发者独有功能与开发中的新功能。|
|release_dev|正式版开发版|同正式版，但包含部分开发者独有功能与开发中的新功能。|
|education_dev|教育版开发版|同教育版，但包含部分开发者独有功能与开发中的新功能。|
|bds_dev|专用服务器预览版开发版|同专用服务器预览版，但包含部分开发者独有功能与开发中的新功能。|
|bds_release_dev|专用服务器正式版开发版|同专用服务器预览版，但包含部分开发者独有功能与开发中的新功能。|

### 分支

|`<branch>`|名称|类型|备注|
| - | - | - | - |
|vanilla|原版|自动补全|使用默认设置创建的世界|
|education|教育版|自动补全|启用了教育版选项后创建的世界|
|experiment|实验性玩法|自动补全|启用了所有实验性玩法选项后创建的世界|
|gametest|Script API|Script API|启用了教育版选项与所有实验性玩法选项后创建的世界<br>（开发版中需要打开“显示所有命令”，Windows 10 版上仅开启“测试版 API”实验性玩法）|
|translator|翻译专用|翻译专用|标准译名表与两个版本的双语语言文件|
|documentation|文档|文档|开发者文档中出现的ID及其描述|
|langParity|译名比较|语言包修正|比较基岩版翻译与标准化译名，生成语言修正包|

### 自动补全

|`<id>`|名称|备注|
| - | - | - |
|blocks|方块|用于 setblock、fill 等命令的方块 ID。|
|items|物品|用于 give、clear 等命令的物品 ID。|
|entities|实体|用于 type 选择器的实体 ID。|
|summonable_entities|可召唤实体|用于 summon 命令的实体 ID。|
|effects|状态效果|用于 effect 命令的状态效果 ID。|
|enchantments|魔咒|用于 enchant 命令的魔咒 ID。|
|gamerules|游戏规则|用于 gamerule 命令的游戏规则 ID。|
|locations|结构|用于 locate 命令的结构 ID。|
|biomes|生物群系|用于 locate 命令的生物群系 ID。|
|mobevents|生物事件|用于 mobevent 命令的生物事件 ID。|
|entity_slots|槽位|用于 replaceitem 命令等的槽位 ID。|
|selectors|目标选择器参数|用于选择实体时指定条件。|
|loot_tools|战利品工具表|用于 loot 命令的工具选项。|
|damage_causes|伤害类型|用于 damage 命令的伤害类型 ID。|
|item_with_aliases|物品|包含别名，可用于 give、clear 等命令。|
|features_and_rules|地物与地物规则|用于 placefeature 命令的地物 ID 和地物规则 ID。|
|input_permissions|操作输入权限|用于 inputpermission 命令的输入权限 ID。|
|camera_presets|摄像机预设|用于 camera 命令的摄像机预设 ID。|
|recipes|配方|用于 recipe 命令的配方 ID。|
|hud_elements|HUD界面元素|用于 hud 命令的界面元素 ID。|
|entity_properties|实体属性|用于 has_property 选择器的实体属性 ID。|
|abilities|能力|用于教育版 ability 命令的能力 ID。|
|options|选项|仅开发版|
|particle_types|粒子类型|仅开发版|
|features|地物|仅开发版|
|feature_rules|地物规则|仅开发版|
|server_tests|服务器测试|仅开发版|
|unit_tests|单元测试|仅开发版|
|functional_tests|功能测试|仅开发版|

## 工作流
请视情况选择工作流。

- 仅导出自带版本：准备、运行、校对
- 导出任意版本：准备、准备 OCR、运行（仅OCR）、运行、校对

### 准备
1. 确认已安装 Node.js 最新版。
2. 运行命令 `npm install` 开始安装。

### 准备 OCR
1. 确认已安装 ffmpeg、Tesseract 与 adb，并已将 ffmpeg 可执行文件所在目录设为路径环境变量。
2. 将支持 USB 调试的手机连接至电脑。
3. 从 [Genymobile/scrcpy](https://github.com/Genymobile/scrcpy/releases/latest) Release 页面下载对应的 server，放入 `data/scrcpy-server` 文件夹，并修改 `data/scrcpy-server/index.js`。
4. 准备一个 Minecraft 安装包（支持 apks 格式和 apk 格式）。
5. 将上述 Minecraft 安装包安装到手机上。
6. 从安装包中找到 Mojangles 字体，使用 Tesseract 训练出模型（如已训练过可直接使用训练过的模型）。
    - 如果您的 Minecraft 使用的字体不是默认的像素字体（即 Mojangles / Minecraft Seven），请使用 Minecraft 正在使用的字体进行训练。
7. 按文件中的注释修改 `data/config.js`。

### 运行
1. 运行 `npm run generate-release` 或 `npm run generate-beta`，取决于你要生成哪种版本的数据。

### 运行（仅OCR）
1. 运行 `npm run generate-release` 或 `npm run generate-beta`。
2. 打开 Minecraft，进入一个已开启作弊的单人世界，等待游戏进入HUD界面。在终端出现 `Press <Enter> if the device is ready` 提示且游戏已进入HUD界面时，按下回车。出现 `Please switch to branch: education` 提示时，进入一个已开启作弊的教育版世界。出现 `Please switch to branch: experiment` 提示时，进入一个已开启作弊与所有实验性功能的单人世界。
3. 此过程中如果终端没有提示要求操作，请不要控制手机，也不要让 Minecraft 切至后台，否则可能导致流程失败。如果遵守上述要求后仍然出现提示 `Auto-completed command test failed`，可能为 Tesseract 识别出错，您需要将错误的条目和对应正确的条目手动保存到 `data/config.js` 以便让本工具手动纠正。

### 校对
1. 检查输出的 `output/xxx/clib/xxx.json`（拓展包）与 `output/xxx/translation/xxx.xlsx`（ID-翻译对照表）。发现错译、漏译时请修改对应的 `translation/xxx.json`，随后从“运行”工作流继续。
2. `translation/xxx.json` 支持引用标准化译名表数据与Java版语言数据，并且支持从其他译名拼接出新的译名。请尽量使用标准化译名或者由标准化译名拼接而来的翻译。具体格式请参见 [翻译流程](./translation/README.md#流程)。
