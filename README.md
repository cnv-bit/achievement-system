# Achievement System

可复用的 SillyTavern 成就系统、角色卡内容作者编辑器与纸质旅行手账，使用 TypeScript、CSS 和 SVG。包含七栏目界面、树与地图画布、节点依赖与成就判定、任务领取、日记编辑、API 设置、提示词装配、账号隔离后端、不可变卡带版本与显式迁移。

公开仓库使用独立技术样例。人物插画、角色卡、世界书、真实剧情/羁绊/职业/技能/知识树、地图布局、聊天存档和本机部署历史保存在私有开发目录，不在此仓库及其 Git 历史中。

## 运行

需要 Node.js 22.18+（或 Node.js 24）。

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run preview
```

预览地址为 `http://127.0.0.1:4178/`；运行时仅使用演示数据。构建文件为 `dist/goblin-achievements.js`，其中已内联 CSS 和通用 SVG，可以作为酒馆助手脚本安装到角色卡。

## 代码位置

| 目录 | 内容 |
| --- | --- |
| `src/frontend/` | 手账组件、七栏目渲染、卡片收纳、树/地图、缩放平移、编辑器 |
| `src/frontend/journal.css` | 配色、纸质样式、边框、悬停、按压、选中与动画 |
| `src/frontend/assets/` | 通用 SVG 纸纹、线稿、边框 |
| `src/domain/` | 数据类型、校验、任务五态和玩家命令 |
| `src/runtime/` | 请求范围、结果应用、聊天存档、调度和请求去重 |
| `src/settings/`、`src/prompting/` | API/世界书配置、提示词、正文过滤和预览 |
| `src/tavern-helper/` | SillyTavern/酒馆助手适配、设置入口与脚本启动 |
| `src/server/` | 账号隔离密钥、模型转发、作者草稿、资产及不可变发布包 |
| `src/content/` | 通用技术样例及图片注册入口 |
| `scripts/`、`tests/` | 构建、参数化部署和公开回归测试 |

普通滚轮滚动页面，Ctrl+滚轮缩放，鼠标中键拖动树。方向键平移、加减键缩放、Home 复位；人物/职业卡点击进入独立树，返回时恢复焦点。交互与文字保留在 DOM 中。

## 接入自己的内容

字段约定见 [数据契约](docs/contracts/README.md)、[作者契约](docs/contracts/authoring.md) 与 [模型接口](docs/contracts/child-api.md)。部署前后端后，点击酒馆助手脚本按钮“成就卡带编辑器”，新建卡带、编辑并发布版本。具体步骤见[作者编辑器使用说明](docs/guides/author-editor.md)。

剧情编辑按阶段卡片 → 剧情树卡片 → 树画布进入。建树自动建立隐藏入口，关键词只保存于整棵树；入口不参与成就判定。版本 3 剧情命中关键词后整树发送，结果写入仍审核前置；阶段和树可删除、撤销、重做。旅行与日记作者页面暂缓。

角色卡可通过 `data.extensions.goblin_achievements.contentPack` 绑定已发布版本，也可由宿主提供：

```js
window.GOBLIN_ACHIEVEMENTS_PACK = { packId: 'my-pack', packVersion: '0001' };
```

已绑定聊天继续使用自己的版本，修改角色卡默认值不会自动升级旧聊天。版本切换和遗留记录在玩家手账中明确确认。目录版本 2 保留兼容；版本 3 使用本地定义与进度作为基础准入，可选外部白名单继续收紧权限。

图片按编辑器显示的稳定 ID 路径放进账号草稿 assets 目录，点击刷新资产后登记。发布会检查资源和结构，并拒绝覆盖已有版本。私有离线包可放在 `content-private/`，不要将真实角色资产覆盖公开技术样例后提交。

美术分层、素材命名、格式和验收规则见 [前端美术指南](FRONTEND-ART-TASK-GUIDE.md)。公开仓库没有人物插画，人物卡展示纸色文字回退；完整边框与悬停逻辑仍可复用。

## 部署

```sh
node scripts/deploy-model-side.mjs /path/to/character.png /path/to/SillyTavern
node scripts/deploy-server.mjs /path/to/SillyTavern
```

角色卡脚本部署会先备份，再仅覆盖固定脚本 ID 的代码并回读校验；后端部署后需要重启 SillyTavern。启用酒馆服务端插件后再测试 API 配置。部署前先接入自己的内容包；公开演示包不包含角色卡专属内容。

## 版本范围

2026-10-11 同步作者编辑器、剧情层级导航、整树选材、内容包版本管理及端口边界。生产组件采用同一实现，公开差异集中在独立内容样例、示例名称、测试夹具与参数化部署脚本。角色内容耦合测试保留在私有仓库；公开仓库的 83 项测试、类型检查及构建通过。
