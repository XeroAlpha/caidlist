# 命令助手ID表生成工具
## 简介
命令助手作者 [ProjectXero](https://gitee.com/projectxero) 使用此工具生成ID表。

[MCBEID表](https://ca.projectxero.top/idlist/) 是基于此工具的数据制作的可离线使用的ID表查询网站。

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
6. 按文件中的注释修改 `data/config.js`。

### 清空导出数据
1. 删除 `output` 目录下的所有文件。
2. 如果不想使用仓库内自带的翻译，请删除 `translation` 目录下的所有文件。
3. 如果需要强制刷新标准化译名表的缓存，请删除 `version/common/wiki` 目录下的所有文件。
4. 如果需要强制刷新Java版语言数据的缓存，请删除 `version/common/java` 目录下的所有文件。

### 运行
1. 运行 `npm run generate-release` 或 `npm run generate-beta`，取决于你要生成哪种版本的数据。

### 运行（仅OCR）
1. 运行 `npm run generate-release` 或 `npm run generate-beta`。
2. 打开 Minecraft，进入一个已开启作弊的单人世界，等待游戏进入HUD界面。在终端出现 `Press <Enter> if the device is ready` 提示且游戏已进入HUD界面时，按下回车。出现 `Please switch to branch: education` 提示时，进入一个已开启作弊的教育版世界。出现 `Please switch to branch: experiment` 提示时，进入一个已开启作弊与所有实验性功能的单人世界。
3. 此过程中如果终端没有提示要求操作，请不要控制手机，也不要让 Minecraft 切至后台，否则可能导致流程失败。如果遵守上述要求后仍然出现提示 `Auto-completed command test failed`，可能为 Tesseract 识别出错，您需要将错误的条目和对应正确的条目手动保存到 `data/config.js` 以便让本工具手动纠正。

### 校对
1. 检查输出的 `output/xxx/clib/xxx.json`（拓展包）与 `output/xxx/translation/xxx.xlsx`（ID-翻译对照表）。发现错译、漏译时请修改对应的 `translation/xxx.json`，随后从“运行”工作流继续。
2. `translation/xxx.json` 支持引用标准化译名表数据与Java版语言数据，并且支持从其他译名拼接出新的译名。请尽量使用标准化译名或者由标准化译名拼接而来的翻译。具体格式请参见 [翻译流程介绍](#翻译流程介绍) 一节。

## 翻译流程介绍

ID 表生成工具在生成时会尝试依次从以下途径加载翻译：用户自定义译名表、标准化译名表、基岩版语言文件。

用户自定义译名表即为 `translation/xxx.json`，为可带有注释的 JSON（即 JSONC）键值对。其中键通常为 ID，值为 ID 对应的翻译。当从用户自定义译名表中加载翻译时，生成工具会根据对应的 ID 在用户自定义译名表中搜索对应的翻译。

当从 [标准化译名表](https://minecraft.fandom.com/zh/wiki/Minecraft_Wiki:%E8%AF%91%E5%90%8D%E6%A0%87%E5%87%86%E5%8C%96) 中加载翻译时，生成工具会将 ID 转换为自然英语形式（全部小写，将下划线“_”替换为空格）后在标准化译名表中搜索。

> 您也可以从 [基岩版开发Wiki标准译名表](https://wiki.bedev.cn/Minecraft%E5%9F%BA%E5%B2%A9%E7%89%88%E5%BC%80%E5%8F%91Wiki:%E8%AF%91%E5%90%8D%E6%A0%87%E5%87%86%E5%8C%96) 中加载翻译，但由于此来源的获取方式并不稳定，因而并不推荐。

当从基岩版语言文件中加载翻译时，生成工具会先尝试搜索ID为 `<前缀>.<ID>.<后缀>` 形式的条目，随后尝试搜索所有满足 `<前缀>.<含有ID的字符串>.<后缀>` 条件的条目。

如果通过以上流程均无法找到翻译，则置空。

用户自定义译名表的值支持为以下格式：

- 字面量。例如 `僵尸`。
- 直接引用。格式为 `<引用来源ID>: <引用ID>`。目前支持以下引用来源：
    - 标准化译名表，引用 ID 为表中条目对应的英语。引用来源 ID 为 `ST`，例如 `ST: zombie` 可以表示 `僵尸`。
    - Java版语言文件，引用 ID 为条目 ID。引用来源 ID 为 `JE`，例如 `JE: entity.minecraft.zombie` 也可表示 `僵尸`。
    - 其他翻译。例如 `entity: zombie` 会引用实体翻译中僵尸的翻译。
        - 注意，翻译条目只能引用在此之前翻译完成的列表中的条目。
- 拼接模板。在字面量中穿插 `{{模板表达式}}`，生成工具会自动解释模板表达式并将模板表达式与字面量拼接起来。模板表达式支持以下格式：
    - 内部引用。格式为 `{{<ID>}}`，通过此方法可直接引用已有的翻译。例如 `{{zombie}}{{villager}}` 可以表示为 `僵尸村民`（并不推荐这么做）。
    - 外部引用。格式为 `{{<引用来源ID>!<引用ID>}}`。例如 `{{ST!zombie}}` 可以表示 `僵尸`。
    - 模板引用。格式为 `{{模板|参数1|参数2|...}}`。例如：
        - `{{JE!record.nowPlaying|JE!item.minecraft.music_disc_strad.desc}}` 表示 `正在播放：C418 - strad`。
        - `{{JE!record.nowPlaying|'My Music}}` 表示 `正在播放：My Music`。

翻译顺序为：

|顺序|枚举名|ID|枚举来源|
|---|---|---|---|
|1|方块|block|`/testforblock ~ ~ ~ <Tab>`|
|2|物品|item|`/clear @s <Tab>`|
|3|实体|entity|`/testfor @e[type=<Tab>`|
|4|状态效果|effect|`/effect @s <Tab>`|
|5|附魔类型|enchant|`/enchant @s <Tab>`|
|6|迷雾|fog|/assets/resource_packs/?/fogs/*.json|
|7|结构|location|`/locate <Tab>`|
|8|实体事件|entityEvent|/assets/behavior_packs/?/entities/*.json|
|9|实体族|entityFamily|/assets/behavior_packs/?/entities/*.json|
|10|动画|animation|/assets/resource_packs/?/animations/*.json|
|11|动画控制器|animationController|/assets/resource_packs/?/animation_controllers/*.json|
|12|粒子发射器|particleEmitter|/assets/resource_packs/?/particles/*.json|
|13|声音|sound|/assets/resource_packs/?/sounds/sound_definitions.json|
|14|游戏规则|gamerule|`/gamerule <Tab>`|
|15|槽位类型|entitySlot|`/replaceitem entity @s <Tab>`|
|16|战利品表|lootTable|/assets/behavior_packs/?/loot_tables/*.json|
|17|音乐|music|sound 中以 `record` 或 `music` 开头的条目|
|18|可生成的实体|summonableEntity|`/summon <Tab>`|
|19|战利品使用工具|lootTool|`/loot spawn ~ ~ ~ loot empty <Tab>`|
