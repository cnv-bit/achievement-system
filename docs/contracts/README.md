# 用户与数据库侧：数据与本地交互

七模块需求与阶段顺序见 [专属计划](./PLAN.md)，字段规范见 [命名与显示契约](./naming-and-display.md)，模型响应协议见 [child-api.md](./child-api.md)。

2026-10-04：目录版本 2、存档版本 6 的三类成长任务五态生命周期已写入源码；模型判定后进入可领取，玩家点击节点才正式完成。测试由用户执行。章节完成计算和地点计数仍待后续阶段实现。

2026-10-03 用户新决定：模型返回仅含 `schemaVersion/judgementSummary/updates`，由程序从发送快照补上 `requestId/chatId/baseRevision` 后交接。取消 `sourceMessageIds`，新结果的 `sourceRefs` 留空；旧存档来源及迁移仍兼容，不清理历史。请求防重复、在途版本保护和手动依赖撤回保留；不再按被否定的正文证据阻止新提案，原定逐结果来源自动撤回不适用于新记录。详见 [最新交接约定](./child-api.md)。

本侧只管理内容定义、达成状态、玩家查询、编辑和聊天存档，不调用模型，不另建运行框架。提示词配置属于模型侧，统一使用 `taskPrompt`、`reasoningPrompt` 和 `modulePrompts`；本侧只接收已校验的更新提案与状态上下文。状态应用、玩家操作共用原来的聊天元数据保存链路。

## 静态目录与玩家归属速查

### 2026-10-03：任务、关键词与章节字段

- 职业、技能、知识采用五状态任务；只有 `active` 节点进入模型材料，不读树关键词。人物与羁绊、战斗成就继续按归属 `keywords` 匹配。剧情发送显式 `currentChapterId` 对应大阶段的全部剧情树，不做关键词筛选。完整边界见 [模型侧约定](./child-api.md)。
- 存档版本 6 保留可选 `currentChapterId`；`nodeTasks` 保存接取、待领取和一次性提醒事实，五状态由统一函数计算。版本 5 加载时只提升版本号，不改已有进度。
- 剧情节点可选 `chapterId`，缺失沿用所属树章节。其他阶段已完成前置用布尔完成标记传递，不暴露节点 ID，原目录完整前置仍由落库入口检查。旅行与日记不采用本次任务筛选。
- 目录仍兼容已有可选关键词字段，但当前发送流程只用人物和战斗树关键词。技能拥有者可选 `revealNodeId`；未达成该节点时，其入口与技能任务不进入玩家视图。

### 现有目录（版本 2）

目录没有手填的 `nodeIds` 名单；按节点明确的父级 ID 查询成员。日记不是树节点。

| 模块 | 目录入口与名称 | 节点父级 | 玩家节点另外携带 |
| --- | --- | --- | --- |
| 冒险与故事 | `adventure.chapters: chapterId/chapterName/chapterNumber` → `storyTrees: storyTreeId/storyTreeName/chapterId/rootNodeId` | `storyTreeId` | `chapterId`、`storyTreeId` |
| 人物与羁绊 | `bonds.people: personId/personName` | `personId` | `personId` |
| 职业与成长 | `careers.trees: careerTreeId/careerTreeName` | `careerTreeId` | `careerTreeId` |
| 技能 | `abilities.owners: skillOwnerId/skillOwnerName` → `skillTrees: skillTreeId/skillTreeName/skillOwnerId` | `nodeKind: skill`、`skillTreeId` | `nodeKind`、`skillTreeId`、`skillOwnerId` |
| 战斗成就 | `abilities.combatTrees: combatTreeId/combatTreeName` | `nodeKind: combat`、`combatTreeId` | `nodeKind`、`combatTreeId` |
| 知识体系 | `knowledge.domains: knowledgeDomainId/knowledgeDomainName` → `topics: knowledgeTopicId/knowledgeTopicName/knowledgeDomainId` | `knowledgeTopicId` | `knowledgeTopicId`、`knowledgeDomainId` |
| 旅行与探索 | `travel.maps: mapId/mapName` → `regions: travelRegionId/travelRegionName/mapId` | `travelRegionId` | `travelRegionId`、`mapId` |
| 随手日记 | `journalEntries` | 无 | `journalId/origin/text/createdAt` |

每个节点统一使用 `nodeId/nodeName/condition`，可选 `prerequisiteNodeIds/choiceGroupId/imageName/imageAlt`。人物节点另有 `allowsMemento`，地点另有 `inputKeywords`。栏目定义含 `moduleName`，本轮前端栏目仍使用固定展示文案。

`choiceGroups` 用 `choiceGroupId/choiceGroupName/module`，并声明 `storyTreeId` 或 `personId`。仅分歧处的选择节点加入同组，普通后续用前置链承接。`adventure.storyLines` 用 `storyLineId/storyLineName/storyTreeId/endingNodeIds`；结局计数暂未执行。

## 名称与附言卡

一个节点只有一个原名和一个玩家改名：

```text
catalog node.nodeName
    ↓ 被 nodeProgress[nodeId].nodeNameOverride 覆盖
PlayerNodeView.nodeName → 节点文字、详情卡标题、编辑框名字
```

卡片不再保存标题。卡片统一为 `cardId/nodeId/style/text/textOverride/sourceRefs`，可选 `imageName/imageAlt`。图片与附文共用详情窗口，卡片正文采用 `textOverride ?? text`；自动文案仍独立存于 `generatedCopy`，日记原文仍为 `generatedText`。

## 存档版本 6

数据仍放在 `chatMetadata.goblin_achievements`，合并更新专用字段并调用 `saveMetadata()`，不改其他元数据。

| 字段 | 当前含义 |
| --- | --- |
| `schemaVersion/revision` | 存档版本固定 6；每次成功写入递增修订号 |
| `currentChapterId` | 可选，显式当前阶段；不按最高开放章推导，不自动解锁或开放章节 |
| `nodeProgress` | 当前达成记录：状态、时间、`cardId`、`nodeNameOverride`、生成文案；新记录的 `sourceRefs` 为空 |
| `nodeTasks` | 保存 `acceptedAt/claimableAt`、两类提醒标记和待领取文案；`blocked/available/active/claimable/completed` 统一推导 |
| `retractedNodeProgress` | 撤回后的暂存记录，保留玩家改名；不提供达成权限，不进入玩家或模型查询 |
| `annotationCards` | 达成卡及撤回后保留的卡；仅通过可见达成节点输出 |
| `journalEntries` | 生成／玩家日记，统一 `journalId`，可保存玩家改写 |
| `manualCorrections` | 兼容旧版否定来源记录；新结果不提供正文依据，不再用它拦截模型提案 |
| `chapterProgress` | `opened/completed`；目前只负责保存和查询开放状态，完成规则尚未计算 |
| `processedThrough/appliedRequestIds` | 各模块处理位置与请求防重复 |
| `migrationBackup` | 旧存档完整 JSON，仅迁移后保存；不进入展示或模型请求 |

新聊天从空存档开始。成就存档不保存 API Key、提示词、图片字节、布局副本或聊天正文；迁移备份保存的仅是原有成就专用字段。

旧版本 1—5 只在内存中迁移，经校验且下一次合法操作后才写回。节点 ID 不改；版本 4 补空 `nodeTasks`，版本 5 只提升版本号。旧玩家改名收敛为 `nodeNameOverride`，附文收敛为 `textOverride`。不同旧改名冲突、卡片归属损坏或新目录前置缺失时拒绝迁移并保留原数据；不自动补亮前置。

## 玩家操作

`PlayerCommand` 不提供手动解锁：

- `editNodeCard { nodeId, patch: { nodeName?, text? } }`：修改已达成节点名称和附文。
- `lockNode { nodeId }`：撤回目标与后续前置依赖，暂存改名并保留卡片；旧记录若有来源仍保留其否定记录，新记录不产生正文来源。
- `acceptNodeTask { nodeId, acceptedAt }`：仅可接取当前 `available` 的职业、技能或知识任务。
- `claimNodeTask { nodeId, claimedAt }`：直接点击当前 `claimable` 节点领取，写入完成记录与火漆卡片。
- `markAvailableTasksNotified { nodeIds }`：在提醒成功后记录本轮已提醒；纠错撤回依赖时清除，重新可接取会再次提醒。
- `markClaimableTasksNotified { nodeIds }`：记录本轮待领取提醒；不改变红点数量或领取状态。
- `addPlayerJournal { journalId, text, createdAt }`、`editJournalEntry { journalId, text }`、`deleteJournalEntry { journalId }`。

重新达成时复用暂存卡片 ID、玩家改名、附文改写和已解析的图片文件名。不再判断是否为相同正文证据；不同请求仍可能重新解锁玩家锁回的节点。保存失败时不报告成功。

## 玩家视图与场景

`buildPlayerView(catalog, save)` 另输出 `availableTaskCount/claimableTaskCount/actionableTaskCount` 及两类新提醒 ID；入口红点使用 `actionableTaskCount`。

- 开放大章组成连续前缀；第一章默认开放。每个已开放大章的所有地区根可见，但 `unlocked: false` 的根不生成卡、图片、连线或完成计数。
- 三类成长任务输出 `nodeState: blocked | available | active | claimable | completed`；其他普通节点仍只输出已达成内容。未遇人物或被 `revealNodeId` 隐藏的技能拥有者入口不输出。
- 任务同树两端可见即可输出浅线；其他连线仍要求两端达成。跨模块任务前置只参与状态计算，不输出跨页线。
- `groups` 是可见成员的归属与正式名称，不暴露空技能树、未来章节或关闭分支。

`buildJournalScene(view, layouts, module, resolveImage?)` 把查询转换为前端 `JournalScene`。只累计开放章节宽度；黑雾在已开放画布边缘内装饰，不增加未来滚动空间。其他树各用自己的坐标；战斗树不冒充技能角色卡，知识按领域／主题展示。缺坐标时展示列表，不造临时位置。

插件句柄提供 `getPlayerView()`、`getPlayerScene(module)`、`dispatchPlayerCommand(command)`。前端只消费这些入口，不读取原始存档或复制解锁规则。悬停查看、点击固定、右键编辑仍沿用已有前端交互。

## 内容与图片加载入口

已建立 `src/content/catalog.json`、`layouts.json`、`images/`；少量技术样例不代表正式剧情。入口 `src/content/index.ts` 加载并校验 JSON，现阶段随既有脚本打包；默认技术骨架及独立前端预览共用这些数据。

正式宿主可在启动前提供：

```text
GOBLIN_ACHIEVEMENTS_CATALOG = 已整理的目录版本 2
GOBLIN_ACHIEVEMENTS_LAYOUTS = 布局版本 1
GOBLIN_ACHIEVEMENTS_IMAGES = { "示例地区地图.webp": "宿主确认存在的可加载地址" }
start(catalog, readModelContext?, layouts?)
```

`imageName` 是文件名（含扩展名），不是 URL。只有宿主确认文件存在且能解析地址，适配器才输出图片；缺图留白。所属者入口图必须来自所属者字段，不借用技能节点图片。

运行端目录仍约定为登录账号下的 `goblin-achievements/catalog.json、layouts.json、images/`。账号文件读取路由、图片路由、部署同步和生图尚未接入；仅把文件放进开发目录不会让已安装旧脚本自动更新。

## 校验与职责边界

- `validateContentCatalog`：检查完整五章、七模块、正式名称、全局唯一 ID、父级引用、树根、前置无环和具名互斥。
- `validateContentLayouts`：检查树／地图归属、有限坐标、尺寸和图片文件名；允许尚未配置的布局。
- `loadAchievementSave`／`validateAchievementSave`：迁移旧存档／校验当前存档，不用空存档覆盖错误数据。
- `validateChildApiResponse`：模型交接协议仍为版本 1，`CandidateNode.prerequisiteIds` 暂作协议字段，由请求适配器从目录 `prerequisiteNodeIds` 转换，不能反用于内容文件。

返回格式仍为 `{ok:true,value}` 或 `{ok:false,issues}`。纯数据层不弹通知；UI 在保存成功或失败后复用项目通知入口。

原计划的来源自动撤回须结合 2026-10-03 取消逐结果来源的新决定重新评估，不在本轮实现；不得把 `message-7` 等楼层号当成跨删楼稳定 ID。
