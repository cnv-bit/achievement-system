# Achievement System 开发说明

`src/` 是开发真源。界面组件在 `src/frontend/`，CSS 和效果在 `src/frontend/journal.css`，通用 SVG 在 `src/frontend/assets/`。

开始前阅读 `README.md`；美术任务阅读 `FRONTEND-ART-TASK-GUIDE.md`；接口任务阅读 `docs/contracts/`。遵循已有端口、数据校验和账号隔离密钥机制，不另建状态库、通知系统或网络栈。

公开内容文件只是通用技术演示。禁止提交真实人物图片、角色卡、树内容、真实地图布局、聊天、密钥、设置或部署备份。私有包放在被忽略的 `content-private/`，由宿主提供目录、布局和图片 URL。

验证使用 `npm test`、`npm run build`；本地预览 `npm run preview`。有浏览器交互改动时检查真实页面、控制台与返回焦点。提交前检查 `git diff --staged`。

部署脚本接收明确的角色卡路径和 SillyTavern 根目录。没有部署请求时不操作运行角色卡；部署时先备份并回读校验。
