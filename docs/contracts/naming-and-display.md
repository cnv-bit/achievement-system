# 命名与显示契约

ID 是稳定引用，Name 是展示文字；玩家改名保存在存档覆盖字段中，不修改目录 ID。节点统一使用 `nodeId/nodeName/condition`，明确声明父级，并通过 `prerequisiteNodeIds` 建立关系。数组顺序不代表依赖关系。

| 实体 | ID / 名称 | 父级或说明 |
| --- | --- | --- |
| 章节 | `chapterId/chapterName` | `chapterNumber` 为 1—5 |
| 剧情树 | `storyTreeId/storyTreeName` | `chapterId/rootNodeId` |
| 人物 | `personId/personName` | `keywords`；可选图片与世界书条目 |
| 职业树 | `careerTreeId/careerTreeName` | 职业节点声明 `careerTreeId` |
| 技能持有者 | `skillOwnerId/skillOwnerName` | 可选 `revealNodeId` 与图片 |
| 技能树 | `skillTreeId/skillTreeName` | `skillOwnerId` |
| 战斗树 | `combatTreeId/combatTreeName` | `keywords` |
| 知识领域/主题 | `knowledgeDomainId/knowledgeDomainName`、`knowledgeTopicId/knowledgeTopicName` | 主题声明 `knowledgeDomainId` |
| 地图/地区 | `mapId/mapName`、`travelRegionId/travelRegionName` | 地区声明 `mapId` |

图片字段为 `imageName/imageAlt`；必须同时提供，imageName 是完整文件名，不是路径或 URL。人物入口图片放在 `bonds.people[]`，技能持有者入口放在 `abilities.owners[]`，节点详情图片放在节点或存档卡片，地图背景放在 `layouts.maps[mapId]`。图片 URL 由宿主验证后解析。

`layouts.json` 只保存展示尺寸与节点中心坐标，不能新增解锁关系。公开样例为独立技术数据，生产坐标与树定义属于私有内容包。

完整 TypeScript 字段定义以 `src/domain/types.ts` 为准，运行视图字段以 `src/domain/player-state.ts` 为准。
