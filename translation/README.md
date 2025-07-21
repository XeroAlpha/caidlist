# 翻译指南

您可以修改本目录下的 JSON 文件来修改或添加翻译。目前仅接受修正已有的翻译以及新增客观类或部分客观类翻译。如果您希望增加主观类翻译，或者只想反馈问题，请[加群](https://projectxero.top/qqgroup/cabeta/)。

> 客观类翻译是指方块、物品等通过某种规则能够被唯一确定的翻译。主观类翻译是指需要根据数据或现象进行概括的翻译，例如粒子发射器、动画。由于目前暂未确定大部分主观类翻译的规则，因此暂不接受新增主观类翻译，附带说明了翻译规则的除外。

欢迎通过 [MCBEID 表](#user-content-通过-mcbeid表-参与翻译) 或者 [Fork & Pull Request](https://docs.github.com/zh/pull-requests/collaborating-with-pull-requests/getting-started/about-collaborative-development-models) 参与此项目！

> [!TIP]
> 在 Fork 仓库中，GitHub Actions 会默认开启，用于在每次 Push 时构建对应的网页版本。如果您不需要，请 [禁用工作流](https://docs.github.com/zh/actions/using-workflows/disabling-and-enabling-a-workflow)。

**请尽量引用 [标准译名表](https://zh.minecraft.wiki/w/Minecraft_Wiki:%E8%AF%91%E5%90%8D%E6%A0%87%E5%87%86%E5%8C%96) 与 [基岩版开发Wiki标准译名表](https://wiki.mcbe-dev.net/p/Minecraft%E5%9F%BA%E5%B2%A9%E7%89%88%E5%BC%80%E5%8F%91Wiki:%E8%AF%91%E5%90%8D%E6%A0%87%E5%87%86%E5%8C%96) 中的对应译名。**

|`translation/*.json`|内容|
| - | - |
|glossary|术语表|
|command|命令|
|block|方块|
|block_state|方块状态|
|block_tag|方块标签|
|item|物品|
|item_tag|物品标签|
|sound|声音|
|entity|实体|
|entity_event|实体事件|
|entity_family|实体族|
|particle_emitter|粒子发射器|
|animation|动画|
|animation_controller|动画控制器|
|effect|状态效果|
|enchant|魔咒|
|fog|迷雾|
|location|结构|
|biome|生物群系|
|damage_cause|伤害类型|
|gamerule|游戏规则|
|entity_slot|实体槽位类型|
|ability|能力|
|feature|地物|
|input_permission|操作输入权限|
|camera_preset|摄像机预设|
|recipe|配方|
|hud_element|HUD界面元素|
|loot_table|战利品工具表|
|cooldown_category|物品冷却类别|
|lang_parity|译名修正表|
|documentation|文档翻译|

## 通过 MCBEID表 参与翻译

1. 打开 [MCBEID表](https://idlist.projectxero.top/)。
2. 在主菜单中启用“编辑模式”。
3. 查找希望修改的条目，点击进入详情页面后进行编辑。编辑完成后点击保存。
4. 在主菜单中点击“导出编辑数据”。
5. [创建 Issue](https://github.com/XeroAlpha/caidlist/issues/new)，说明对翻译修改的部分，并附上导出的“编辑数据.json”。
6. 如果不会第 5 步，请[加群](https://projectxero.top/qqgroup/cabeta/)并将编辑数据私聊发送给群主。

## 流程

ID 表生成工具在生成时会尝试依次从以下途径加载翻译：用户自定义译名表、标准译名表、基岩版语言文件。

用户自定义译名表即为 `translation/xxx.json`，为可带有注释的 JSON（即 JSONC）键值对。其中键通常为 ID，值为 ID 对应的翻译。当从用户自定义译名表中加载翻译时，生成工具会根据对应的 ID 在用户自定义译名表中搜索对应的翻译。

当从 [标准译名表](https://zh.minecraft.wiki/w/Minecraft_Wiki:%E8%AF%91%E5%90%8D%E6%A0%87%E5%87%86%E5%8C%96) 中加载翻译时，生成工具会将 ID 转换为自然英语形式（全部小写，将下划线“_”替换为空格）后在标准化译名表中搜索。

> 您也可以从 [基岩版开发Wiki标准译名表](https://wiki.mcbe-dev.net/p/Minecraft%E5%9F%BA%E5%B2%A9%E7%89%88%E5%BC%80%E5%8F%91Wiki:%E8%AF%91%E5%90%8D%E6%A0%87%E5%87%86%E5%8C%96) 中加载翻译。

当从基岩版语言文件中加载翻译时，生成工具会先尝试搜索ID为 `<前缀>.<ID>.<后缀>` 形式的条目，随后尝试搜索所有满足 `<前缀>.<含有ID的字符串>.<后缀>` 条件的条目。

如果通过以上流程均无法找到翻译，则置空。

## 格式

- 字面量。例如 `僵尸`。
    - 可在前面加上冒号，用于与下方用法相区分。例如 `:ST: zombie` 表示 `ST: zombie`。
- 直接引用。格式为 `<引用来源ID>: <引用ID>`。目前支持以下引用来源：
    - 内部引用，引用来源 ID 为 `this`，等效于拼接模板的内部引用。例如 `this: a` 会引用当前翻译表中 ID 为 `a` 的翻译。
    - 标准化译名表，引用 ID 为表中条目对应的英语。引用来源 ID 为 `ST`，例如 `ST: zombie` 可以表示 `僵尸`。
    - Java版语言文件，引用 ID 为条目 ID。引用来源 ID 为 `JE`，例如 `JE: entity.minecraft.zombie` 也可表示 `僵尸`。
    - 基岩版语言文件，引用 ID 为条目 ID，如非必要请勿使用此项。引用来源 ID 为 `BE`，例如 `BE: entity.zombie.name` 也可表示 `僵尸`。
    - 其他翻译。例如 `entity: zombie` 会引用实体翻译中僵尸的翻译。
        - 注意，翻译条目只能引用在此之前翻译完成的列表中的条目。
    - 暂定翻译。用于标记某个条目为暂定翻译。引用来源 ID 为 `Missing`，例如 `Missing: BE: tile.sculk.name` 会展示警告，表示这是个暂定翻译，暂时使用 `BE: tile.sculk.name` 的结果代替。
- 拼接模板。在字面量中穿插 `{{模板表达式}}`，生成工具会自动解释模板表达式并将模板表达式与字面量拼接起来。模板表达式支持以下格式：
    - 内部引用。格式为 `{{<ID>}}`，通过此方法可直接引用已有的翻译。例如 `{{zombie}}{{villager}}` 可以表示为 `僵尸村民`（并不推荐这么做）。
    - 外部引用。格式为 `{{<引用来源ID>!<引用ID>}}`。例如 `{{ST!zombie}}` 可以表示 `僵尸`。
    - 内置函数。格式为 `{{<函数名>|参数1|参数2|...}}`。例如 `{{pick|entity!firefly|'萤火虫}}` 可以在实体引用中不包含 `firefly` 时回退到表示 `萤火虫`。
        - 目前仅有 `{{pick|翻译1|翻译2|...}}` 内置函数，用于在部分翻译不可用时回退至其他翻译。
    - 模板引用。格式为 `{{模板|参数1|参数2|...}}`。例如：
        - `{{JE!record.nowPlaying|JE!item.minecraft.music_disc_strad.desc}}` 表示 `正在播放：C418 - strad`。
        - `{{JE!record.nowPlaying|'My Music}}` 表示 `正在播放：My Music`。
        - 若内置函数与模板 ID 冲突，可在模板前加 `|`，即 `{{|模板|参数1|参数2|...}}`。

## 引用

只有顺序在后的可以引用顺序在前的ID。

|顺序|枚举名|ID|枚举来源|
|---|---|---|---|
|1|术语表|glossary|自定义|
|2|方块|block|`/testforblock ~ ~ ~ <Tab>`|
|3|物品|item|`/clear @s <Tab>`|
|4|实体|entity|`/testfor @e[type=<Tab>`|
|5|状态效果|effect|`/effect @s <Tab>`|
|6|魔咒|enchant|`/enchant @s <Tab>`|
|7|迷雾|fog|/assets/resource_packs/?/fogs/\*.json|
|8|结构|location|`/locate structure <Tab>`|
|9|生物群系|biome|`/locate biome <Tab>`|
|10|实体事件|entityEvent|/assets/behavior_packs/?/entities/\*.json|
|11|实体族|entityFamily|/assets/behavior_packs/?/entities/\*.json|
|12|动画|animation|/assets/resource_packs/?/animations/\*.json|
|13|动画控制器|animationController|/assets/resource_packs/?/animation_controllers/\*.json|
|14|粒子发射器|particleEmitter|/assets/resource_packs/?/particles/\*.json|
|15|声音|sound|/assets/resource_packs/?/sounds/sound_definitions.json|
|16|游戏规则|gamerule|`/gamerule <Tab>`|
|17|实体槽位类型|entitySlot|`/replaceitem entity @s <Tab>`|
|18|命令|command|`/help <page>` 的返回内容|
|19|战利品表|lootTable|/assets/behavior_packs/?/loot_tables/\*.json|
|20|伤害类型|damageCause|`/damage @s 0 <Tab>`|
|21|地物与地物规则|featureAndRule|`/placefeature <Tab>`|
|22|操作输入权限|inputPermission|`/inputpermission query @s <Tab>`|
|23|摄像机预设|cameraPreset|`/camera @s set <Tab>`|
|24|配方|recipe|`/recipe take @s <Tab>`|
|25|HUD界面元素|hudElement|`/hud @s hide <Tab>`|
|26|音乐|music|sound 中以 `record` 或 `music` 开头的条目|
|27|可生成的实体|summonableEntity|`/summon <Tab>`|
|28|战利品使用工具|lootTool|`/loot spawn ~ ~ ~ loot empty <Tab>`|

## 标准译名表未收录条目

有部分条目由于一些原因标准译名表不便收录，故在此处列出。

*斜体文本*表示引用存在于标准译名表中的条目。

方块：

|ID|译名|
|---|---|
|stonecutter|*切石机*（MATTIS）|

物品：

|ID|译名|
|---|---|
|bordure_indented_banner_pattern|波纹边*旗帜图案*|
|field_masoned_banner_pattern|砖纹*旗帜图案*|

<!--
实体：

|ID|译名|
|---|---|

-->