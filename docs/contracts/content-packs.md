# 内容包身份、加载与版本迁移

网页作者草稿、完整保存、资源刷新、预检和发布接口见[作者契约](authoring.md)，操作见[使用说明](../guides/author-editor.md)。网页编辑真源是当前账号 packs 下的 draft；开发仓库草稿继续作为离线创作来源，不自动同步。命令行与网页复用 `src/server/publish-content-pack.mjs`，已发布版本保持不可覆盖。

运行时代码依赖 `ContentPackPort.load(binding)` 获取已校验的发布内容；`src/tavern-helper/content-pack-adapter.ts` 通过现有后端加载并生成带版本与指纹的资产 URL。首次加载、升级／恢复预览及确认复查均使用同一个端口；存档绑定、迁移与提交规则继续由应用／领域处理。

2026-10-10 使魔 B 图部署：版本 `0023` 采用用户选定的 B 原稿，归档于 `references/art-source/combatTree.familiar/`；运行封面为 512×512 WebP、27,350 字节。新增 `combatTree.familiar` 与唯一初见节点 `combat.familiar.seen`，排在自然守卫之后、食尸魔之前，沿用魔法生物分组，不新增分类或评级。角色卡默认绑定与示例地区存档均备份切换至 0023，并按用户要求只激活该节点；原 240 个完成记录、9 个任务、1 条日记和聊天正文完整保留，总完成数 241。构建、完整发布、迁移预演与部署回读通过，账号后端与当前构建完全一致。相关 24 条检查中 22 条通过，两条旧图鉴测试固定要求 74 个入口，已在部署前的 0022 复现为 110≠74；未修改测试或放宽校验。压缩沿用与迁移指纹一致的作者历史清单副本，账号旧 0015 清单未改。刷新目标聊天后由用户验收实际界面。

2026-10-09 图鉴独立分行：版本 `0022` 仅在 16 类的首个入口布局上增加可选布尔 `startNewRow`，通过 `JournalScene.groups[].startNewRow` 传给索引，将各类渲染为独立网格组；类内仍可按屏宽自然换行。不增加分类字段、类别文字或物种硬编码，不改变顺序、图片、节点及玩家进度。旧布局省略标记时兼容原显示方式。共享校验、前端和后端同步部署，酒馆需重启以载入新布局校验。补充 `tests/bestiary-rows.test.ts`，自动测试及实际界面交给用户；构建和发布／迁移回读用于部署核对。

2026-10-09 图鉴标签与顺序：版本 `0021` 保留最新 `0020` 内容，移除 29 个非神明条目的展示标签，仅保留七位神的现有标签。复用 `references/art-source/combatTree.grand-guignol/portrait-v01.png`，登记为 512px WebP 的古兰大剧院入口及一个初见节点，紧邻七位神排列；不填写讨伐等级、神明标签或世界观隐藏真相。110 个图鉴条目仅调整 `combatTrees` 数组顺序，按哥布林、史莱姆、野兽、龙、亚人、巨人、魔法生物、食尸与女巫、亡灵、吸血鬼、亡灵舰队、魔神、构造体、血肉触手、克苏鲁、神祇与古兰排列。不增加分类数据或前端排序逻辑；关键词、前置与现有进度不变。角色卡和示例地区存档通过既有发布／显式迁移流程切换，并只新增古兰初见解锁记录；旧版本与其他线程改动保留，实际界面由用户验收。


2026-10-09 克苏鲁素材与文案合并部署：版本 `0018` 新增九个独立图鉴条目，各暂设一个实际遭遇的初见根节点；仅黑山羊幼崽填金等级，其余省略评级。古老者改为统一灰蓝色，九图均为低细节二维插画、羊皮纸底与黑雾染边。原图和提示词保存在实体源目录，总览为 `references/art-source/cthulhu-gallery.html`；九张 512px WebP 合计 407,300 字节。保留另一线程已改的怪物介绍和未提交的评级贴图实现，复用既有组件与资源入口。构建及发布完整校验通过，实际角色卡和目标示例地区聊天已备份切换至 0018；204 个完成记录、9 个任务、1 条日记及聊天正文保持不变，新节点未自动解锁。迁移前发现该聊天的版本写为 0017、指纹仍指向本机 0015；逐节点核对结构与私人字段后，仅在迁移工作副本纠正指纹，保留原始备份与可回退的 0017 快照。旧 release 未覆盖，界面验收交给用户。

2026-10-09 三巫婆、动物与神祇素材：内置 imagegen 生成 13 张独立原图及提示词，保存在 `references/art-source/combatTree.<实体>/`，作者总览为 `references/art-source/crones-animals-deities-gallery.html`。新版本 `0017` 注册 12 个图鉴条目、17 个节点：示例地区三巫婆为黄金评级，只有初见与交易；四种动物为初见与击杀；七种神祇各设一个认识公开信仰的节点，图片明确是信仰象征，不表示亲见本体、不设讨伐等级。大剧院内部图仅作作者源图，未加入玩家运行包。12 张 512px WebP 合计 360,176 字节，复用原有 manifest、图片入口和关键词／前置规则，无运行代码变更。构建及完整发布校验通过，已备份并部署实际角色卡，示例地区存档从 0016 显式迁移至 0017；204 个完成记录、9 个任务、1 条日记及正文保持不变，新增节点未自动解锁。旧 release 未覆盖，刷新目标聊天后由用户验收。

2026-10-08 讨伐评级部署：新只读版本 `0015` 增加 `combatTrees[].recommendedRank`，74 种怪物中 71 种有等级，鸟人／暗人／蜥蜴人省略。同步更新前后端、角色默认绑定与示例地区存档；204 个完成记录、9 个任务、1 条日记及正文保留。草稿已对齐 0014 的眷属哥布林删除，未恢复入口；旧发布版本未覆盖。字段只进入遇见后的档案视图，不写存档或模型请求。已安装后端离线载入 0015 返回成功；用户须完整重启酒馆并刷新聊天。

2026-10-08 新素材补充：血肉／特殊生物及哥布林的 23 张源图已登记为独立图鉴入口，各暂配一个“初见”根节点和简短静态介绍，后续成就条件由作者另行设定。最终部署版本为 `0013`，共 75 种怪物、77 张登记 WebP，图片合计 2,450,320 字节；角色卡和示例地区存档已备份切换，182 个完成记录、9 个任务、1 条日记及正文保留，新增入口未自动解锁。0012 的新图迁移来源错误被提交前检查拦截，聊天未绑定该版；0012 保留但不作为默认版本。压缩脚本已修正：新增图片不写为旧图片迁移来源，并留下 `python scripts/check-image-optimization.py` 回归检查。

2026-10-08 图片优化已构建并部署：新 release `demo-pack/0011` 共 54 张登记图，合计 1,784,404 字节（原 103,789,101 字节）。角色卡默认及目标示例地区聊天已切换至 0011，保留 182 个完成记录、9 个任务、1 条日记和完整聊天正文；旧 release、卡片／后端／聊天备份保留。后端与角色卡脚本完成部署回读，完整重启酒馆后刷新聊天才能使用新后端。构建及单项读取／哈希／缓存／错误诊断检查通过，真实界面耗时由用户验收。


作者部署脚本的 `--replace-default-pack` 明确更新角色默认绑定并保留 `legacyContentPack`。`scripts/attach-bestiary-sample.mjs` 仅用于此次已核对的示例地区开发样例，拒绝有旧怪物记录或私有字段变化的聊天，不是运行时自动升级机制。

2026-10-07：阶段 A／B／C 完整版本已构建并部署到目标角色卡和酒馆后端，111 项单测及构建（含类型检查）通过。静态内容仍使用已发布的 `demo-pack/0001`，未创建或覆盖 release。目标示例地区聊天已是格式 7、绑定 `0001`，22 个完成记录和 9 个任务通过兼容检查；本次仅备份聊天，不改写进度。部署后须重启酒馆服务并刷新聊天，实际验收由用户执行。

## 数据真源与目录

角色创作稿可以放在被忽略的 `content-private/<packId>/draft/`，或由作者编辑器保存于当前酒馆账号的 packs 目录。草稿包含 `manifest.json`、`catalog.json`、`layouts.json`、`theme.json` 和 `assets/`。公开 `src/content/` 保留独立技术样例，只供预览和公开集成测试，正式脚本没有内置内容回退。

正式运行目录由当前登录账号的 `directories.root` 决定：

```text
账号数据目录/goblin-achievements/packs/<packId>/
├─ draft/                    作者草稿，玩家运行时不读取
└─ releases/
   ├─ 0001/                 manifest/catalog/layouts/theme.json + assets/
   └─ 0002/                 新发布版本；不得覆盖 0001
```

开发草稿与账号目录中的草稿可以任选其一作为发布输入，不自动双向同步。发布工具只创建新的 release，不改输入草稿。不要同时在两份草稿里编辑。

资源结构沿用重构指南：`assets/adventure/<storyTreeId>/`、`bonds/<personId>/`、`careers/<careerTreeId>/`、`abilities/owners/<skillOwnerId>/`、`abilities/skills/<skillTreeId>/`、`abilities/combat/<combatTreeId>/`、`knowledge/domains/<knowledgeDomainId>/`、`knowledge/topics/<knowledgeTopicId>/`、`travel/<mapId>/`、`ui/`。每个实体目录使用 `card.jpg`、`cover.webp` 或 `nodes/<nodeId>.webp` 等明确用途。

## manifest 与图片

2026-10-09 评级贴图：主题增加可选 `rankBadges`，键只允许 `porcelain/obsidian/steel/jade/ruby/bronze/silver/gold/platinum`，值为 manifest 已登记的 `assetRef`。例如 `"rankBadges": {"silver":"assets/ui/rank-badges/silver.webp"}`，与 `assets` 同级，不写入怪物或聊天存档。静态类型、后端共享校验和前端场景同步支持；旧主题不填也可用。九张 WebP 为 384×96、共 69,122 字节，原图及提示词保存在 `references/art-source/ui.rank-badges/`。版本 0016 已发布到实际账号目录，提供从 0015 的身份迁移；仅装饰变化，无节点、布局或进度变化。后端、角色卡默认绑定和示例地区存档均已备份部署并回读，204 个完成记录、9 个任务、1 条日记与正文保留。须完整重启酒馆后端并刷新聊天。运行时只在对应档案请求该等级图片，失败回退文字 CSS 徽记；不另建路由或缓存层。独立测试夹具修复后，完整测试 124/124、构建及四屏宽检查通过。

草稿清单示例：

```json
{
  "schemaVersion": 1,
  "packId": "demo-pack",
  "packVersion": "0001",
  "packName": "四方世界",
  "assets": {
    "person.demo.card": { "assetRef": "assets/bonds/person.demo/card.jpg" }
  },
  "legacyImageNames": {
    "person.demo--card--v01.jpg": "assets/bonds/person.demo/card.jpg"
  }
}
```

发布工具自动给每个资源补 `sha256`，给清单补 `files.catalog/layouts/theme` 的 SHA-256。运行时要求这些校验值齐全，不能直接拿草稿清单充当 release。

- 资源逻辑标识为 `person.demo.card`；真正的插入位置由目录、节点或地图中的 `assetRef` 指定。资源须登记在清单且文件存在。不按人物名、数组顺序或相似文件名猜图。
- 新图片字段为 `{ "assetRef": "assets/bonds/person.demo/card.jpg", "imageAlt": "示例人物的人物卡面" }`。人物、技能拥有者、各树／知识领域／主题／地图／地区、节点与地图底图都支持相同引用格式；前端继续通过统一场景适配器读取。
- 知识主题封面优先用主题自身引用，缺失时可使用同领域的封面；不借其他领域或人物图片。知识页当前仍是纵向树页，封面已传到场景及树视图，不在本阶段新增卡片式页面。技能所属者入口仍只用所属者的卡面，不能拿技能图冒充。
- `assetRef` 只允许包内的正斜杠相对路径；拒绝绝对路径、网址、`..`、编码路径和 Windows 保留文件名。仅支持 PNG/JPG/WebP/GIF/AVIF，不接受任意 CSS、HTML、脚本或 SVG。
- 旧 `imageName` 通过显式 `legacyImageNames` 转换，不删除原文件。静态内容缺少映射时拒绝加载；旧存档卡片的未知私有图片名保留，但没有可解析地址时留白，不冒用公有图片。备份里的旧数据不改。
- `theme.json` 为版本 1，可选 `colors.paper/ink/accent`（六位十六进制）和 `assets.paper/seal/corner`（已登记的图片引用）。加载后可通过实例 `getContentTheme()` 查询；按本阶段边界，暂不改变现有纸纹 CSS 或自动替换火漆外观。
- 当前登记由作者填写清单；自动扫目录登记、可视化编辑和生图管理尚未实现。自动扫目录即使以后实现，也只负责发现资源并更新 manifest，不是热加载：新树仍须写入 `catalog.json/layouts.json`，通过整包校验、发布新版本并显式切换内容实例后才会进入前端。

## 角色卡、存档与版本

角色卡只填写小段绑定配置，放在 `data.extensions.goblin_achievements`：

```json
{
  "contentPack": { "packId": "demo-pack", "packVersion": "0001" },
  "legacyContentPack": { "packId": "demo-pack", "packVersion": "0001" }
}
```

`contentPack` 用于新聊天；`legacyContentPack` 是作者明确确认的旧存档原内容包，不能随便填最新版本。脚本宿主也可通过 `GOBLIN_ACHIEVEMENTS_PACK`、`GOBLIN_ACHIEVEMENTS_LEGACY_PACK` 提供相同配置，不需要写人物专用代码。

存档版本为 7，包含 `packId/packVersion/packHash`。版本号始终是字符串，保留 `0001` 的前导零。旧版本 1—6 先在内存迁移，保留备份；只有整包验证和绑定保存成功后才写回，并激活新实例。不认识的旧节点、非法前置／任务或章节不会被删除或补亮，而是拒绝自动绑定。阶段 C 只处理已经合法绑定原包的存档；不能用迁移表猜测无绑定历史属于哪个包。

已有绑定永远优先于角色卡默认版本：角色卡改为 `0002` 后，新聊天可用 `0002`，旧聊天仍读取自己的 `0001`。读取失败不退回内置样例，也不自动升级。聊天复制自然继承绑定及进度；新聊天从指定默认包开始。角色卡删除不会删除账号内容包；聊天删除只影响该聊天进度，不删除公有资源。内容包仍需要单独备份。

`packHash` 是发布清单原始字节的 SHA-256，用于检测同版本清单被改写；JSON 与每张图片另有文件校验值。图片 URL 绑定该指纹，用于区分缓存版本，不能代替后端核对清单和实际文件哈希。发布版本只读指插件运行链路没有写接口；不等于操作系统禁止作者手动改文件。手动改 release 后，内容 JSON 在加载时、图片在实际请求时报告校验失败；浏览器已缓存的图片仍可展示原内容。修改资源应发布新版本，避免与强缓存冲突。

回滚代码不等于恢复内容版本：旧版脚本不能直接读取版本 7 的新增字段。回滚旧代码前先备份当前聊天，在副本中恢复 `migrationBackup` 或升级前的聊天备份；该备份不包含升级后新增的进度。阶段 C 的“恢复”只切换内容版本和记录快照，仍使用当前插件代码。

## 发布、加载与用户验收

在仓库目录运行以下命令。`0001` 已发布；今后须改为新版本，目标为已确认的账号 `packs` 目录：

```powershell
```

工具先在临时目录校验完整副本，再一次性改名为正式版本；同版本并发发布使用排他目录占位，失败只清理本次临时目录，不删除草稿或已有 release。不建立 `latest` 别名，不原地升级旧版本。

宿主新增两个按账号隔离的只读入口：`POST /api/plugins/goblin-achievements/packs/load` 接收 `{packId, packVersion}`；`GET /api/plugins/goblin-achievements/packs/asset` 接收绑定身份、指纹和 `assetRef`。服务端检查真实路径及符号链接边界、文件大小与校验值，并复用共享内容校验器；没有草稿读取、上传、编辑或删除接口。

### 图片压缩与加载

- 发布／作者部署使用 `readReleaseDirectory` 完整校验所有文件。
- 运行 `/packs/load` 使用 `readReleaseMetadata`，只读取 manifest、catalog、layouts、theme 并检查资源引用，不读取图片字节。
- `/packs/asset` 只读取 manifest 和目标登记图片，核对包指纹及该图 SHA-256；不逐图重读或校验整包。
- 成功图片使用 `Cache-Control: private, max-age=31536000, immutable` 和 `Vary: Cookie`；内容加载与所有失败响应使用 `no-store`。失败返回具体原因并记录后端异常，不能吞掉诊断信息。

作者压缩入口为 `python scripts/optimize-content-images.py <draft目录> --version <新版本> --source-manifest <来源release/manifest.json>`，使用本机已有 Pillow。静态头像／图标最长边 512px，人物卡 1280px，地图底图 2048px，保持比例和透明通道；运行图导出 WebP，动画图片保留原格式。原图备份至 `references/art-source/<实体ID>/`，未登记旧源图不进入发布包。脚本同步目录、布局、主题、旧名称映射和版本迁移中的图片引用；压缩发生在创作／发布前，运行时直接读取成品。

浏览器端的统一图片入口、按需加载、尺寸占位及离线预览规则见[前端指南：浏览器加载约束](../guides/frontend-art.md#浏览器加载约束)。

### 加载与部署入口

前端自动读取角色绑定，也提供 `window.GoblinAchievementsPlugin.loadPack()` 手动重载。加载、绑定、激活按顺序完成；替换期间沿用阶段 A 的共享提交队列。失败保留原实例；若已经切换到别的聊天，入口禁用以防显示旧聊天进度，修正配置后重载即可。

用户可运行 `npm test`、`npm run typecheck`、`npm run build`。公开验收使用 `tests/content-packs.test.ts`、`tests/pack-migration.test.ts` 与 `tests/author-storage.test.mjs` 等独立夹具：重点检查显式旧存档绑定、备份保留、保存失败、同版本修改拒绝、旧聊天固定版本、资源越界／缺失、账号隔离及发布拒绝覆盖。

部署时须同时更新角色卡前端和后端：`npm run build` 输出前端和 `dist/goblin-achievements-server.mjs`；`scripts/deploy-server.mjs` 安装完整后端，部署后须重启酒馆。角色卡脚本沿用原部署脚本；指定 `--content-pack-release <release目录>` 时还会校验并填入绑定，已有不同绑定则拒绝隐式换包。内容包发布、脚本部署、聊天升级是三件独立操作。

## 阶段 C：显式版本迁移

在新版本草稿的 `manifest.json` 增加 `migrations`，再按原发布流程创建 release。下面仅展示新增字段；旧 ID 确有对应改动时才能填写。示例中的指纹是本机已发布 `0001/manifest.json` 的 SHA-256，其他内容包须使用自己的来源指纹。

```json
{
  "packVersion": "0002",
  "migrations": [{
    "fromVersion": "0001",
    "fromHash": "3f9be35ce7d05cdd084ce8b66cd9be0423c58fd479379de26190277878b85aa0",
    "nodeIds": {
      "bond.demo.reunion": "bond.demo.meeting",
      "bond.demo.midnight-letter": null
    },
    "chapterIds": {},
    "assetRefs": {}
  }]
}
```

- `nodeIds` 必填，可以为空；`chapterIds/assetRefs` 可省略。映射同时应用，不按条目顺序连续改名；省略某个 ID 表示身份不变，`null` 表示明确删除。
- 同一个新节点只能对应一个旧节点；`A → B` 与未改名的旧 `B` 也算冲突。跨模块或技能任务变成战斗成就不按改名处理，须删除旧节点并新增。换显示名称不必改 ID。
- 作者仍须同步修改新稿中的树根、节点前置、章节归属和布局位置；发布工具验证新稿的结构、DAG 和资产引用。迁移表处理的是存档引用，不代替创作稿编辑，也不改旧 release。
- 卡片的 `nodeId` 跟随节点迁移，但 `cardId` 保持独立身份，不按字符串替换。完成时间、生成文案、玩家改名和改写、接取／待领取文案、纠错记录一并保留。日记和自动处理游标原样保留。
- 删除或新依赖／互斥导致失效的进度进入 `orphanedProgress`，失效任务的接取和待领取记录退出当前树。遗留记录保留 `source` 包身份、原节点 ID／名称、归档时间、原因及全部私人记录；不参加当前解锁、红点或模型候选。
- `orphanedChapters` 保存被删除的章节记录和是否曾为当前阶段；被删当前阶段退回新目录第一章。现有完成标记按本章剧情公共节点和所选分支复核，失效时只撤回该标记，不自动开关章节。
- 卡片公有图引用消失时必须提供图片映射或 `null`；图片删除只清除当前图片引用，保留成就和文字，原卡片图引用另存遗留区。实际资源文件不删除，旧版备份仍可恢复。
- 存档版本仍为 7，新增可选 `orphanedProgress/orphanedChapters/packRollback`。恢复快照不包含树、布局或图片字节，也不嵌套另一个恢复快照。只支持一步往返；多版本历史使用外部聊天备份。

玩家入口为手账管理栏“内容版本与遗留记录”。先复制聊天，在工作副本输入已发布版本并预览；确认后复核来源和目标文件、聊天身份以及预览对应的完整存档，再进入唯一提交队列保存一次。预览后改日记、接任务或收到模型更新，都须重新预览。保存失败不激活目标实例；旧包和记录继续可用。

“预览恢复”读取 `packRollback` 指定的旧 release，恢复升级前记录，同时把离开的版本保存为下一次可恢复快照。恢复不是合并两个版本的后续进度；必须保留旧 release。遗留区提供只读原始记录，包含旧图引用，但不自动展示旧包图片或混入当前树。

脚本接口为 `window.GoblinAchievementsPlugin.versions`：`getVersionState()`、`previewUpgrade("0002")`、`previewRestore()`、`applyPreview(preview.token)`。预览令牌只用于版本变更，不改变模型响应的后来居上规则。新增测试为 `tests/pack-migration.test.ts`；本阶段没有生图、后台编辑或自动升级。
