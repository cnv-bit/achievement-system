# 数据与玩家交互契约

目录版本 3 的作者编辑、带类型依赖与通用五态见[作者契约](authoring.md)。版本 2 继续按原行为读取；下文仅限职业、技能、知识的任务描述适用于旧目录。新目录各节点复用同一五态流程，作者后台只管理静态定义。

玩家查询与命令的应用接口为 `src/runtime/player-port.ts` 的 `PlayerUseCases`；命令及返回视图沿用现有领域类型。前端 `JournalPort` 组合此接口与布局／页面挂载，DOM 不进入业务契约；版本操作继续使用 `PackVersionsPort`。

本文说明当前已实现的数据、玩家操作和视图接口。[本地侧计划](./PLAN.md)保留尚未落地的需求与待办；其中历史记录和字段草案不作为当前存档格式。

## 职责与参考入口

Domain 接收静态目录、当前存档、玩家命令及模型更新，统一判断前置、互斥和任务流程，并产出玩家视图。宿主负责保存，前端负责呈现。

- [命名与显示契约](./naming-and-display.md)：目录层级、节点归属、名称、坐标和图片字段。
- [模型侧契约](./child-api.md)：材料筛选、请求权限、响应协议和更新数量。
- [内容包契约](./content-packs.md)：公有资源、版本绑定、发布、迁移和加载。
- [架构重构指南](../refactoring-guide.md)：Runtime、Domain、存储、提交队列和通知边界。
- [前端美术指南](../guides/frontend-art.md)：页面收纳、详情窗口和图片呈现。

代码类型见 [types.ts](../../src/domain/types.ts)；玩家命令和查询见 [player-state.ts](../../src/domain/player-state.ts)。本文不重复完整目录字段表、关键词匹配算法或部署流程。

## 存档版本 7（兼容 1—6）

成就数据保存在 `chatMetadata.goblin_achievements`，合并更新专用字段并调用 `saveMetadata()`。存档只保存进度与私人记录；完整树、布局和公有图片保存在内容包。

| 字段 | 当前含义 |
| --- | --- |
| `schemaVersion/revision` | 格式版本 7；每次成功写入递增修订号 |
| `packId/packVersion/packHash` | 内容包身份；旧内联存档可以暂缺，正式绑定后三者完整保存 |
| `currentChapterId` | 显式当前剧情阶段，与章节开放状态分开；不按最高开放章推导 |
| `nodeProgress` | 按节点 ID 保存完成时间、卡片引用、玩家改名和生成文案 |
| `nodeTasks` | 接取／待领取时间、两类提醒标记和待领取文案；五态由这些事实和前置统一推导 |
| `retractedNodeProgress` | 上锁后暂存的进度和玩家改名；不授予完成资格 |
| `annotationCards` | 附言卡与撤回后保留的卡片；只随可见已达成节点输出 |
| `journalEntries` | 生成／玩家日记，含独立 ID、可选标题、时间和正文 |
| `manualCorrections` | 旧纠错记录的兼容字段；不作为证据黑名单 |
| `chapterProgress` | 章节的 `opened/completed`；当前保存和查询状态，尚未自动计算完成门槛 |
| `processedThrough` | 各模块自动处理位置；手动历史判定不改变该游标 |
| `appliedRequestIds/requestOutcomes` | 请求去重、已接受项与拒绝原因；拒绝项不在重复回调中补执行 |
| `migrationBackup` | 旧成就存档的完整备份，不进入展示或模型材料 |
| `orphanedProgress/orphanedChapters` | 内容版本迁移后的遗留记录，不参与当前节点前置或章节计数 |
| `packRollback` | 一步内容版本恢复所需的记录快照；具体规则见内容包契约 |

新聊天从空进度开始，复制聊天继承包绑定和进度。存档不保存 API Key、提示词、图片字节、布局副本或聊天正文。

新达成、附言卡和日记的 `sourceRefs` 留空；旧来源字段兼容保留。当前不根据删楼或正文重生成自动撤回新记录。旧正文可以补审，是否接受仍由当前前置、互斥、任务状态和请求权限决定。

旧版本先在内存中迁移，原始成就数据保留于 `migrationBackup`。内联模式在下一次合法保存时写回；正式内容包模式在内容校验、绑定和保存成功后写回。坏归属、冲突改名或缺失前置拒绝迁移，保留原记录。存档格式迁移与内容包版本升级是两个流程，后者见[内容包契约](./content-packs.md#阶段-c显式版本迁移)。

`choiceSelections/sharedFacts/locationObservations/completedEndingCount` 等计划字段尚未进入当前 `AchievementSave`，不能按计划草案直接写入存档。

## 名称与附言卡

节点显示名为 `nodeNameOverride ?? nodeName`，节点文字、详情标题和编辑框共用这一结果。卡片只保存 `cardId/nodeId/style/text/textOverride/sourceRefs` 与图片引用，不另存节点标题。

正文显示采用 `textOverride ?? text`。玩家改写与生成文案分开保存；同一字段以后提交的合法修改为准，模型更新该附文字段时可替换旧玩家改写，未涉及字段保留。

撤回后卡片与玩家改名暂存；重新达成复用原卡片 ID 和图片引用。combat 的介绍来自目录 `description`，不创建生成附言卡，也不允许玩家改写怪物介绍。

## 玩家操作

前端通过 `dispatchPlayerCommand(command)` 提交操作；`PlayerCommand` 不提供手动解锁。

| 命令 | 参数与行为 |
| --- | --- |
| `editNodeCard` | `nodeId, patch: { nodeName?, text? }`；编辑已达成节点名称与附文，combat 不允许 |
| `lockNode` | `nodeId`；撤回目标及全部后续前置依赖，保留卡片与玩家改写 |
| `acceptNodeTask` | `nodeId, acceptedAt`；接取当前 available 的职业、技能或知识任务 |
| `claimNodeTask` | `nodeId, claimedAt`；领取当前 claimable 任务并写入完成记录 |
| `markAvailableTasksNotified` | `nodeIds`；记录可接取提醒已发出 |
| `markClaimableTasksNotified` | `nodeIds`；记录可领取提醒已发出 |
| `addPlayerJournal` | `journalId, text, createdAt, title?`；创建玩家日记 |
| `editJournalEntry` | `journalId, text, title?`；编辑日记 |
| `deleteJournalEntry` | `journalId`；删除指定日记 |

日记标题最多 200 字；编辑时省略标题保留原值，空白标题清除原值，未命名显示“无题日记”。生成正文为 `generatedText`，玩家正文或改写为 `playerText`。

上锁完成任务后，前置满足则回到 available，须重新接取；受影响的后续任务清除接取与提醒事实。重新满足条件时可再次提醒。上锁怪物根节点同时撤回本树后续，使入口恢复未遇见。

## 玩家视图与场景

`buildPlayerView(catalog, save)` 输出可见节点、分组、连线、大章、日记及任务计数。前端入口为 `getPlayerView()`、`getPlayerScene(module)` 和 `dispatchPlayerCommand(command)`。

| 内容 | 当前可见性与状态 |
| --- | --- |
| 剧情 | 第一章默认开放；开放大章组成连续前缀，全部地区树根可见，普通节点达成后才输出 |
| 人物 | 未遇见人物隐藏入口；已遇见人物输出自己的已达成关系节点，被关闭的互斥分支隐藏 |
| 职业、skill 技能、知识 | 输出 blocked／available／active／claimable／completed；技能拥有者受 `revealNodeId` 限制 |
| combat 怪物 | 所有入口可输出；根未达成时名称为“？？？”，隐藏内部树；根达成后输出全部预设节点，未完成节点不开放详情 |
| 旅行、日记 | 地点只输出已达成内容；日记按独立条目展示 |

任务状态统一推导，模型达成进入 claimable，玩家领取后才成为 completed 并满足后续前置。红点为 `actionableTaskCount = availableTaskCount + claimableTaskCount`；两类新提醒 ID 分别由视图输出，已提醒标记不影响红点数量。

combat 的入口状态由根节点进度推导，不另存 seen；树内保持未完成／已完成两态。每种怪物独立，所有节点沿本树 DAG 连接无前置的 `rootNodeId`。

连线两端必须可见：任务和已遇见怪物的树内可输出浅线，其他节点连线两端须达成。跨模块任务前置仅参与规则计算，不输出跨页线。未达成剧情根不生成卡片、图片或连线。

`buildJournalScene(view, layouts, module, resolveImage?)` 将投影转换为 `JournalScene`。场景只累计开放大章宽度；黑雾在已开放画布内装饰，不增加未来滚动范围。坐标与图片来源见[命名与显示契约](./naming-and-display.md)；图片只使用宿主解析出的有效 URL，缺图使用占位，缺坐标展示列表。

## 校验与提交入口

- `validateContentCatalog`：目录结构、唯一 ID、父级引用、树根、DAG 和互斥组。
- `validateContentLayouts`：布局归属、坐标、尺寸和图片引用。
- `loadAchievementSave/validateAchievementSave`：存档迁移与当前格式校验，错误数据不以空存档覆盖。
- `validateChildApiResponse`：响应字段和本次请求权限；协议由模型侧契约维护。
- `applyPlayerCommand` 与 `applyChildApiResponseWithOutcome`：玩家操作和模型结果的本地规则与状态落位。

模型普通节点更新写入 `nodeProgress`，任务更新写入 `nodeTasks` 的待领取事实，日记更新追加 `journalEntries`。只有 combat 可使用本批明确返回并接受的同树前置；其他节点按批次开始前的最新状态检查，均不自动补亮未返回的前置。

所有写入经统一提交队列读取最新存档、应用规则并保存；成功后才发布视图并通知。队列、失败恢复、聊天身份与请求去重见[架构重构指南](../refactoring-guide.md#三统一提交手动修改冲突与请求去重)。

纯数据层返回结果或校验问题；校验格式为 `{ok:true,value}` 或 `{ok:false,issues}`，通知由 UI／调度入口负责。
