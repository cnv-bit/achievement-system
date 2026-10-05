# Achievement System

可复用的 SillyTavern 成就系统与纸质旅行手账界面，使用 TypeScript、CSS 和 SVG。包含七栏目界面、树与地图画布、可收纳人物/职业/技能卡、节点详情、任务领取、日记编辑、API 设置、提示词装配、账号隔离密钥后端和酒馆助手接入。

公开仓库使用独立技术样例。人物插画、角色卡、世界书、真实剧情/羁绊/职业/技能/知识树、地图布局、聊天存档和本机部署历史保存在私有开发目录，不在此仓库及其 Git 历史中。

## 运行

需要 Node.js 22.18+（或 Node.js 24）。

```sh
npm ci
npm test
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
| `src/server/` | 账号隔离的密钥服务、原生模型列表与生成转发 |
| `src/content/` | 通用技术样例及图片注册入口 |
| `scripts/`、`tests/` | 构建、参数化部署和公开回归测试 |

普通滚轮滚动页面，Ctrl+滚轮缩放，鼠标中键拖动树。方向键平移、加减键缩放、Home 复位；人物/职业卡点击进入独立树，返回时恢复焦点。交互与文字保留在 DOM 中。

## 接入自己的内容

字段约定见 [数据契约](docs/contracts/README.md) 与 [模型接口](docs/contracts/child-api.md)。生产内容可以由宿主提供：

```js
window.GOBLIN_ACHIEVEMENTS_CATALOG = catalog;
window.GOBLIN_ACHIEVEMENTS_LAYOUTS = layouts;
window.GOBLIN_ACHIEVEMENTS_IMAGES = {
  'person.my-character--card--v01.webp': '/host-confirmed/image.webp'
};
```

在脚本启动前设置这些值；启动后更新目录时发出 `goblin-achievements:catalog-ready` 事件。也可以调用当前脚本 iframe 的 `window.GoblinAchievementsPlugin.start(catalog, readModelContext, layouts)`。严格模式的准入和变量读取由 `readModelContext` 提供。

人物入口图片声明在 `catalog.modules.bonds.people[]` 的 `imageName/imageAlt`；技能持有者入口声明在 `abilities.owners[]`。宿主确认图片存在后提供 URL。可选静态内置图片通过 `src/content/images.ts` 注册，私有图片文件默认被 Git 忽略。私有目录包可放在 `content-private/`，不要将运行目录中的真实角色资产覆盖公开技术样例后提交。

美术分层、素材命名、格式和验收规则见 [前端美术指南](FRONTEND-ART-TASK-GUIDE.md)。公开仓库没有人物插画，人物卡展示纸色文字回退；完整边框与悬停逻辑仍可复用。

## 部署

```sh
node scripts/deploy-model-side.mjs /path/to/character.png /path/to/SillyTavern
node scripts/deploy-server.mjs /path/to/SillyTavern
```

角色卡脚本部署会先备份，再仅覆盖固定脚本 ID 的代码并回读校验；后端部署后需要重启 SillyTavern。启用酒馆服务端插件后再测试 API 配置。部署前先接入自己的内容包；公开演示包不包含角色卡专属内容。

## 版本范围

此公开快照对应本地完整版本 `e0c8731fbd74bdb25efa60517007eb21896f8a8c`，于 2026-10-05 整理。生产组件保持同一实现，公开差异集中在内容样例、示例名称、测试夹具、部署参数和说明文档。角色内容耦合测试留在私有仓库，公开仓库保留独立通用回归测试并增加技术样例集成测试。
