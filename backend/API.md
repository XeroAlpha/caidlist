# MCBEID表 在线搜索API

API：`https://idlist.projectxero.top/`

## 搜索

```
GET /search
```

[Apifox 文档](https://caidlist.apifox.cn/)

### 请求参数

|参数名|类型|描述|
|---|---|---|
|`q`|字符串|必填，搜索的内容|
|`version`|字符串|版本ID，不填则自动根据搜索内容判断，详见下文|
|`branch`|字符串|分支ID，不填则自动根据搜索内容判断|
|`enum`|字符串|枚举ID，不填则自动根据搜索内容判断|
|`scope`|字符串|可为 `all`（默认）、`key`、`value`。表示搜索的范围|
|`match`|字符串|可为 `keyword`（默认，关键词匹配，忽略大小写）、`contains`（包含即匹配）、`startswith`（以之开头即匹配）、`equals`（相等才匹配）。表示匹配的算法|
|`limit`|数字|搜索返回结果数量的上限，介于 1 到 1000 的整数，默认为 1|
|`format`|字符串|可为 `json`（默认，以JSON形式返回）或者 `text`（以可读形式返回）。表示返回的格式|

### 返回内容

|JSON路径|类型|描述|
|---|---|---|
|`data.count`|数字|结果数量|
|`data.hash`|字符串|搜索对应MCBEID表的URL Hash|
|`data.result[*].enumId`|字符串|枚举ID|
|`data.result[*].enumName`|字符串|枚举名称|
|`data.result[*].key`|字符串|条目名称|
|`data.result[*].value`|字符串|条目描述|
|`error`|字符串|错误描述|

注：MCBEID表的URL Hash是附加于URL上用于快速定位的片段标识符。例如 `https://idlist.projectxero.top/#beta-vanilla/command/damage` 中的 `#beta-vanilla/command/damage`。

### 关键词匹配

关键词匹配是默认的搜索方式。

关键词匹配会自动从给定的关键词中提取部分搜索参数，例如当请求“命令 damage”或者其ID形式“command damage”时，会自动切换到命令枚举并只在其中搜索。可被提取的关键词包括版本与分支的名称及ID（可通过MCBEID表的 `/use` 命令查看）、枚举的名称及ID（可通过MCBEID表的 `/switch` 命令查看）。可被提取的关键词必须放置在用于搜索的关键词之前，其中版本关键词必须放在分支关键词与枚举关键词之前，分支关键词必须放在枚举关键词之前。顺序最后的关键词永远不会被提取。

如果没有通过关键词或者请求参数指定版本、分支或枚举，则会默认使用列表中的第一项。

### 例子

GET `/search?q=apple`
```json
{
    "data": {
        "count": 1,
        "hash": "#beta-vanilla/#global/apple",
        "result": [
            {
                "enumId": "item",
                "enumName": "物品",
                "key": "apple",
                "value": "苹果"
            }
        ]
    }
}
```

GET `/search?q=sculk&branch=translator`
```json
{
    "data": {
        "count": 1,
        "hash": "#beta-translator/#global/sculk",
        "result": [
            {
                "enumId": "BlockSprite",
                "enumName": "方块",
                "key": "sculk",
                "value": "幽匿块"
            }
        ]
    }
}
```

GET `/search?q=command%20damage&limit=5`
```json
{
    "data": {
        "count": 2,
        "hash": "#beta-vanilla/command/damage",
        "result": [
            {
                "enumId": "command",
                "enumName": "命令",
                "key": "damage <target: target> <amount: int> <cause: DamageCause> entity <damager: target>",
                "value": "对实体造成来源于特定实体的伤害。"
            },
            {
                "enumId": "command",
                "enumName": "命令",
                "key": "damage <target: target> <amount: int> [cause: DamageCause]",
                "value": "对实体造成伤害。"
            }
        ]
    }
}
```