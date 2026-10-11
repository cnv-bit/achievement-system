# 字段命名、剧情层级与显示资料

目录版本 3 的强依赖、额外前置、通用介绍和阶段数见[作者契约](authoring.md)。本页关于固定五章、无类型 prerequisiteNodeIds 和仅怪物静态介绍的描述适用于版本 2；版本 3 用 dependencies 单独记录两类关系，阶段从 1 连续排列，数量由卡带定义。

本文维护当前目录的命名、归属和前端映射。存档、任务与可见性见[数据契约](./README.md)，发送与模型字段见[模型契约](./child-api.md)，目录、资源登记和发布见[内容包契约](./content-packs.md)，样式与生图见[前端美术指南](../guides/frontend-art.md)。本文不重复这些文件的操作流程。

## 命名与实体归属

字段使用小驼峰，同一实体的 ID 与名字保持相同前缀，如 `nodeId/nodeName`。ID 稳定，展示名可变；通过明确的归属字段关联实体，不拆 ID、不按数组位置猜归属。

新 ID 使用“类型.内容”的可读形式，如 `storyTree.demo-region`、`node.demo-region.arrival`。已有 ID 不为统一前缀而改值。目录内的实体、节点、互斥组和剧情线 ID 全局唯一；数字编号只用于有明确顺序的对象。文件与布局用稳定 ID 定位，不用中文展示名定位。

| 定义位置（均位于 `catalog`） | ID／名字字段 | 归属或引用 |
| --- | --- | --- |
| `modules[module]` | `module/moduleName` | 七个固定模块键 |
| `modules.adventure.chapters[]` | `chapterId/chapterName` | `chapterNumber` 完整覆盖 1—5 |
| `modules.adventure.storyTrees[]` | `storyTreeId/storyTreeName` | `chapterId/rootNodeId` |
| 六个节点模块的 `nodes[]`；旅行为 `locations[]` | `nodeId/nodeName` | 按下表指定所属树、人物或地区 |
| `modules.bonds.people[]` | `personId/personName` | 每个人独立成树 |
| `modules.careers.trees[]` | `careerTreeId/careerTreeName` | 旅行家与冒险者、魔法师并列 |
| `modules.abilities.owners[]` | `skillOwnerId/skillOwnerName` | 人物或扫帚等对象；可用 `revealNodeId` 限制入口可见性 |
| `modules.abilities.skillTrees[]` | `skillTreeId/skillTreeName` | `skillOwnerId` |
| `modules.abilities.combatTrees[]` | `combatTreeId/combatTreeName` | 一种怪物一棵独立树；`rootNodeId` |
| `modules.knowledge.domains[]` | `knowledgeDomainId/knowledgeDomainName` | 知识领域 |
| `modules.knowledge.topics[]` | `knowledgeTopicId/knowledgeTopicName` | `knowledgeDomainId` |
| `modules.travel.maps[]` | `mapId/mapName` | 地图，与剧情树分别定义 |
| `modules.travel.regions[]` | `travelRegionId/travelRegionName` | `mapId` |
| `choiceGroups[]` | `choiceGroupId/choiceGroupName` | `module` 及 `storyTreeId` 或 `personId` |
| `modules.adventure.storyLines[]` | `storyLineId/storyLineName` | `storyTreeId/endingNodeIds` |

七个模块键为 `adventure/bonds/careers/abilities/knowledge/travel/journal`。目录提供 `moduleName`，玩家查询输出 `moduleNames`；当前栏目标题仍使用 `journal-port.ts` 的固定文案，不能宣称已由目录驱动。

## 节点定义到玩家视图

每个节点定义含 `nodeId/nodeName/condition`，可选 `prerequisiteNodeIds/choiceGroupId` 和图片引用。连线来自前置关系，位置来自布局；两者不能互相推导。

| 模块／类型 | 节点定义的直接归属 | `PlayerNodeView` 的归属 |
| --- | --- | --- |
| 剧情 `adventure` | `storyTreeId`；可选 `chapterId` | `storyTreeId/chapterId`，当前视图的章节取所属树 |
| 羁绊 `bonds` | `personId` | `personId` |
| 职业 `careers` | `careerTreeId` | `careerTreeId` |
| 技能 `abilities` + `nodeKind: 'skill'` | `skillTreeId` | `skillTreeId/skillOwnerId`，所属者由技能树查询 |
| 怪物 `abilities` + `nodeKind: 'combat'` | `combatTreeId` | `combatTreeId` |
| 知识 `knowledge` | `knowledgeTopicId` | `knowledgeTopicId/knowledgeDomainId`，领域由主题查询 |
| 地点 `travel` | `travelRegionId` | `travelRegionId/mapId`，地图由地区查询 |
| 日记 `journal` | 不属于节点树 | 独立的 `journalEntries` |

`PlayerNodeView` 共用 `nodeId/module/nodeName/unlocked`，任务节点另有计算出的 `nodeState`。视图里的祖先归属是查询结果，不在内容定义中重复维护。技能节点不能混入怪物树，也不能把不同所属者的技能混成一张人物入口卡。

`buildPlayerView` 产生扁平节点、分组和已过滤连线；`buildJournalScene` 补布局和可加载图片地址。分组映射为 `groupId/groupName` → `JournalScene.groups[].id/title`，成员 `nodeIds` 从直接归属计算，不另维护可编辑副本。技能人物入口使用 `JournalScene.abilityOwners`；知识主题标题为“领域名 · 主题名”。

同树、同模块且两端可见才输出连线。任务和已遇见怪物可显示未完成节点之间的浅线；其他连线两端须达成。跨树／跨模块任务前置仅参与规则计算，不画跨页线。模型候选的 `prerequisiteIds` 是发送协议字段，不用它替代目录的 `prerequisiteNodeIds`。

## 节点名称、卡片与日记

节点按钮、详情标题和编辑框共用最终 `nodeName`，不再另存卡片标题。普通节点按以下优先级取名：

```text
nodeProgress[nodeId].nodeNameOverride
  ?? retractedNodeProgress[nodeId].nodeNameOverride
  ?? 内容定义.nodeName
```

`nodeNameOverride` 只保存玩家改名；撤回暂存不授予解锁，但其改名仍可供查询。编辑命令中的 `patch.nodeName` 是操作参数，不是另一份持久化名称。模型不能另起节点名；人物名、树名不随节点改名变化。

节点卡以 `cardId/nodeId` 关联，文字显示 `textOverride ?? text`，图片沿用共用引用。combat 节点直接使用目录的 `nodeName/description`，不接受玩家改名、文案编辑或模型附文，仍保留纠错上锁入口。

日记不是成就节点：以 `journalId` 定位，可选 `title`，未命名显示“无题日记”。不要把日记标题改成 `nodeName`。标题编辑、长度和保存规则见数据契约。

## 剧情层级、根与互斥组

```text
大章 chapterId/chapterName
├─ 地区树 storyTreeId/storyTreeName
│  └─ rootNodeId → 根成就 nodeId/nodeName → 后续节点
└─ 另一棵独立地区树 → 自己的根与节点
```

“示例地区”是 `storyTreeName`，“抵达示例地区”是根的 `nodeName`，它们是不同对象。地区树不是大章，不再用 `route/act/stage` 另建同义层级。

剧情树和怪物树必须显式指定 `rootNodeId`：根属于本树、无前置、不是互斥选择节点；其他节点沿前置链连到根，整图无环。不用数组首项或名字猜根。仅技能、知识和职业任务允许跨树前置；其他节点的前置限定本树／人物／地区。

剧情展示保留以下约束：

- 第一章默认揭示；后续开放章必须组成连续前缀。目录仍须定义完整五章，暂未填写剧情的章可以只有名称。
- 已开放章的地区树根可见，不等于已达成；未达成根不创建完成记录、图片卡或连线。普通剧情节点达成后才显示。
- 未开放章的名称、节点、布局不进入玩家场景，不扩大滑块或拖动范围。装饰黑雾位于已开放宽度内，不透露未来节点和连线。
- 章进度用 `chapterProgress[chapterId].opened/completed`；发送当前章用 `currentChapterId`。两者不同，不能由当前发送章推断界面开放章。

剧情节点的可选 `chapterId` 已用于模型选材：`节点.chapterId ?? 树.chapterId`。当前 `buildPlayerView` 和树布局仍按 `树.chapterId` 归章，并未按节点拆分跨章显示；填写跨章剧情时不能把发送切片能力当成已完成的显示能力。

互斥组示例：

```json
{
  "choiceGroupId": "choiceGroup.demo-region.tree-heart",
  "choiceGroupName": "树心的抉择",
  "module": "adventure",
  "storyTreeId": "storyTree.demo-region"
}
```

选择节点引用同一 `choiceGroupId`，后续沿前置链跟随选择。不要把同一路线的全部后继塞进互斥组，否则它们会互相排斥。组只归属剧情树或人物；节点与组必须同属一个对象。组名用于作者维护，不用它匹配 ID 或向玩家暴露未选路线。

`storyLines[].endingNodeIds` 必须引用本剧情树的结局；剧情线是结局计数的分组，不增加树层级。自动章节门槛及未实现存档字段由数据契约和计划维护，不在这里另定一套结构。

## 图片与布局字段

公有资源通过 `assetRef/imageAlt` 引用。`assetRef` 是 manifest 登记的包内相对路径，不是 URL、资源登记 ID 或展示名；目录分层、文件命名、压缩与发布只按内容包契约执行。旧 `imageName` 通过 `legacyImageNames` 显式兼容，不猜路径。

| 显示位置 | 实际读取字段 |
| --- | --- |
| 节点详情图 | 节点卡有图片引用时使用卡片，否则使用节点 `assetRef/imageAlt` |
| 人物入口 | `bonds.people[]` 的图片引用 |
| 技能人物／对象入口 | `abilities.owners[]` 的图片引用，不借用技能图 |
| 职业入口 | `careers.trees[]` 的图片引用 |
| 怪物圆形入口与档案 | `abilities.combatTrees[]` 的图片引用 |
| 知识主题图 | 优先 `knowledge.topics[]`，缺少可解析图片时回退所属 `domains[]` |
| 地图底图 | `layouts.maps[mapId].assetRef/imageAlt` |
| 图鉴书本封面 | `theme.assets.bestiaryBookCover` |
| 等级贴图 | `theme.rankBadges[rankKey]` |

宿主解析图片引用后才输出 `JournalScene.images[nodeId]`、分组 `image`、地图 `backgrounds` 等 `{url,alt}`。不能把 `assetRef` 直接当浏览器地址；缺图保留占位，不借其他人物或技能的图片。卡片已指定图片但无法解析时不会再自动回退节点图。

| `layouts` 字段 | 索引键及用途 |
| --- | --- |
| `chapters` | `chapterId` → `width/height` |
| `storyTrees` | `storyTreeId` → `chapterId/x/y/width/height/positions` |
| `bondTrees` | `personId` → 树布局 |
| `careerTrees` | `careerTreeId` → 树布局 |
| `skillTrees` | `skillTreeId` → 树布局 |
| `combatTrees` | `combatTreeId` → 树布局，可选 `startNewRow` |
| `knowledgeTrees` | `knowledgeTopicId` → 树布局，不以领域 ID 索引 |
| `maps` | `mapId` → 树布局及底图引用；包含该地图各地区的地点坐标 |

树布局为 `width/height/positions[nodeId]: {x,y}`。坐标以本树／地图左上角为原点，单位为像素；地图底图和地点标记一起缩放。剧情树 `x/y` 是其在所属大章内的偏移，布局 `chapterId` 必须与树一致，整树不能超出章画布。坐标只能引用所属节点，必须有限、非负且位于画布内；缺坐标显示列表，不自动猜排布。

## 怪物图鉴的展示资料

| 字段／数据 | 显示用途 |
| --- | --- |
| `rootNodeId` | 根达成决定入口可打开；档案文字取该根的静态 `description` |
| 可选 `aliases: string[]` | 别名，仅展示，不替代 `keywords` |
| 可选 `tags: string[]` | 展示标签，不参与检索或解锁；填写范围遵循前端美术指南 |
| 可选 `recommendedRank: string` | 建议讨伐等级，非空、最多 40 字；不另设数值等级或存档副本 |
| `layouts.combatTrees[id].startNewRow: true` | 该入口另起一组；省略或 false 沿用前组，组内按屏宽换行 |
| 节点 `unlocked` | 已达成数／全树节点数，动态计算档案进度，不存第二份计数 |

未知入口的 `groupName` 为“？？？”，`nodeIds` 为空，不输出 `rootNodeId/aliases/tags/recommendedRank`；可保留模糊封面，其替代文字为“尚未遇见的怪物”。遇见后才输出整树及档案资料。入口沿目录数组顺序展示，不按等级排序，不硬编码物种名单。

等级文字读取 `recommendedRank`；前端识别为 `porcelain/obsidian/steel/jade/ruby/bronze/silver/gold/platinum` 九个主题键。白金先于金匹配，未识别用中性样式。等级贴图只作装饰、对读屏隐藏，缺图回退 CSS 文字徽记。

怪物连线在 `JournalScene.edges` 使用 `routing: 'orthogonal'`，两端完成才标记 `completed: true`。横向规整效果仍由作者的节点坐标决定，换线型不自动生成布局。

## 代码对照与兼容边界

- [types.ts](../../src/domain/types.ts)：目录、布局、卡片、主题字段。
- [validation.ts](../../src/domain/validation.ts)：唯一 ID、归属、根、DAG 与布局校验。
- [player-state.ts](../../src/domain/player-state.ts)：名字、分组、可见性和连线投影。
- [view-scene.ts](../../src/frontend/view-scene.ts)：布局、图片优先级与场景映射。
- [journal-port.ts](../../src/frontend/journal-port.ts)、[bestiary-dossier.ts](../../src/frontend/bestiary-dossier.ts)：场景字段、固定栏目名与怪物档案。

旧字段只由既有加载与迁移入口兼容，不再作为新内容模板。迁移中的冲突保护见数据／内容包契约；不要直接删旧存档进度。地点见闻、独立选择记录和章节自动计数的草案字段不能写入当前类型。
